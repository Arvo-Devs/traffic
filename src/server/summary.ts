/**
 * What the Traffic page shows, read from traffic_visits, traffic_links and
 * traffic_found_via (the answers to "How did you find us?") in the app's own
 * database. Taken from BetterFans Link's lib/traffic/summary.server.ts. Rows
 * marked excluded (bots that ran the page, test-tag checks) are never
 * counted. Days and hours are the viewer's own time zone.
 *
 * A visitor is one browser on one connection (the visitor key). A source
 * counts the visitors who arrived from it; a page counts everyone who saw it.
 * A sign-up is counted under where that person first came from. Names and
 * emails are never stored: the latest sign-ups get them from the app's
 * `accounts` hook, once per summary.
 */
import type { TrafficAccount, TrafficSql } from '../config';
import { foundViaLabel, type FoundViaChoice } from '../shared/found-via';
import {
  joinRate,
  rangeBucket,
  rangeDaysBack,
  safeTimeZone,
  timeZoneNames,
  type TrafficLink,
  type TrafficRange,
  type TrafficSite,
  type TrafficSummary,
} from '../shared/summary';

type Row = Record<string, unknown>;

/** Tags that arrived without being made in the link maker, most visited first. Every saved link is listed besides. */
export const TRAFFIC_UNSAVED_TAGS_MAX = 100;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const count = (value: unknown) => Number(value) || 0;
const textOrNull = (value: unknown) => (value === null || value === undefined ? null : String(value));

const zonesKnown = new Map<string, string>();

/** The viewer's zone by a name the database knows, or UTC. Kept per process: the database's zones do not change while it runs. */
async function databaseTimeZone(sql: TrafficSql, zone: string): Promise<string> {
  if (zone === 'UTC') return zone;
  const hit = zonesKnown.get(zone);
  if (hit) return hit;
  const names = timeZoneNames(zone);
  const rows = await sql<{ name: string }[]>`select name from pg_timezone_names where name in ${sql(names)}`;
  const known = names.find((name) => rows.some((row) => row.name === name)) ?? 'UTC';
  if (zonesKnown.size >= 500) zonesKnown.clear();
  zonesKnown.set(zone, known);
  return known;
}

type Accounts = (ids: readonly string[]) => Promise<readonly TrafficAccount[] | null>;

/** The accounts behind these ids as the app knows them now; null when there is no hook or it cannot say. */
async function liveAccounts(accounts: Accounts | null | undefined, rows: readonly Row[]): Promise<ReadonlyMap<string, TrafficAccount> | null> {
  const ids = [...new Set(rows.map((row) => textOrNull(row.user_id)).filter((id): id is string => Boolean(id)))];
  if (!accounts || !ids.length) return null;
  const found = await accounts(ids);
  if (!found) return null;
  const byId = new Map<string, TrafficAccount>();
  for (const account of found) if (!byId.has(account.id)) byId.set(account.id, account);
  return byId;
}

export type SummaryInput = Readonly<{
  range: TrafficRange;
  timeZone?: string | null;
  /** The app's address, link pages and test tag, as the page shows them. */
  site: TrafficSite;
  /** The answers to "How did you find us?", for their labels. */
  answers: readonly FoundViaChoice[];
  accounts?: Accounts | null;
  /** The moment the report is for. The database's clock when left out; a test stands on a given moment. */
  now?: Date;
}>;

export async function trafficSummary(sql: TrafficSql, input: SummaryInput): Promise<TrafficSummary> {
  const { range } = input;
  const now = input.now ? sql`${input.now.toISOString()}::timestamptz` : sql`now()`;
  const timeZone = await databaseTimeZone(sql, safeTimeZone(input.timeZone));
  const back = rangeDaysBack(range);
  const bucket = rangeBucket(range);
  const span = back + 1;
  // The window starts at local midnight `back` days ago and runs to now; the
  // previous window is the same stretch one span earlier (today against
  // yesterday until the same time, a week against the week before).
  // Days are counted on the viewer's clock (a local time), then turned back
  // into a moment, so a day when the clocks change keeps its 23 or 25 hours.
  const local = sql`(${now} at time zone ${timeZone}::text)`;
  const start = sql`((date_trunc('day', ${local}) - make_interval(days => ${back}::int)) at time zone ${timeZone}::text)`;
  const previousStart = sql`((date_trunc('day', ${local}) - make_interval(days => ${back + span}::int)) at time zone ${timeZone}::text)`;
  const previousEnd = sql`((${local} - make_interval(days => ${span}::int)) at time zone ${timeZone}::text)`;

  const [totalsRows, seriesRows, sourceRows, savedRows, unsavedRows, pageRows, countryRows, deviceRows, browserRows, signups, foundViaRows] = await Promise.all([
    sql<Row[]>`
      select
        ${start} as window_start,
        count(distinct visitor_key) filter (where kind = 'view' and occurred_at >= ${start}) as visitors,
        count(*) filter (where kind = 'view' and occurred_at >= ${start}) as views,
        count(*) filter (where kind = 'signup' and occurred_at >= ${start}) as signups,
        count(distinct visitor_key) filter (where kind = 'view' and occurred_at < ${previousEnd}) as previous_visitors,
        count(*) filter (where kind = 'view' and occurred_at < ${previousEnd}) as previous_views,
        count(*) filter (where kind = 'signup' and occurred_at < ${previousEnd}) as previous_signups,
        (select count(distinct visitor_key) from traffic_visits
          where kind = 'view' and excluded is null and occurred_at > ${now} - interval '5 minutes') as live
      from traffic_visits
      where excluded is null and occurred_at >= ${previousStart}
    `,
    sql<Row[]>`
      with buckets as (
        select generate_series(
          date_trunc(${bucket}::text, ${start} at time zone ${timeZone}::text),
          date_trunc(${bucket}::text, ${now} at time zone ${timeZone}::text),
          make_interval(hours => ${bucket === 'hour' ? 1 : 0}::int, days => ${bucket === 'day' ? 1 : 0}::int)
        ) as bucket
      ), counted as (
        select date_trunc(${bucket}::text, occurred_at at time zone ${timeZone}::text) as bucket,
          count(distinct visitor_key) filter (where kind = 'view') as visitors,
          count(*) filter (where kind = 'view') as views,
          count(*) filter (where kind = 'signup') as signups
        from traffic_visits
        where excluded is null and occurred_at >= ${start}
        group by 1
      )
      select to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI') as bucket, c.visitors, c.views, c.signups
      from buckets b left join counted c on c.bucket = b.bucket
      order by b.bucket
    `,
    sql<Row[]>`
      select source,
        count(distinct visitor_key) filter (where kind = 'view') as visitors,
        count(*) filter (where kind = 'signup') as signups
      from traffic_visits
      where excluded is null and occurred_at >= ${start} and source is not null
      group by source
      order by 2 desc, 3 desc, source
      limit 50
    `,
    // Every saved link with its own counts in the range, however few: a link
    // made for one post is the one someone opens the page to check.
    sql<Row[]>`
      select l.name, l.platform, l.path, l.created_at,
        count(distinct v.visitor_key) filter (where v.kind = 'view') as visitors,
        count(*) filter (where v.kind = 'signup') as signups
      from traffic_links l
      left join traffic_visits v on v.campaign = l.name and v.excluded is null and v.occurred_at >= ${start}
      group by l.name
    `,
    // Tags that arrived without being made in the link maker (utm_campaign, a typed ?ref=).
    sql<Row[]>`
      select v.campaign,
        mode() within group (order by v.source) as source,
        count(distinct v.visitor_key) filter (where v.kind = 'view') as visitors,
        count(*) filter (where v.kind = 'signup') as signups
      from traffic_visits v
      where v.excluded is null and v.occurred_at >= ${start} and v.campaign is not null
        and not exists (select 1 from traffic_links l where l.name = v.campaign)
      group by v.campaign
      order by 3 desc, 4 desc, v.campaign
      limit ${TRAFFIC_UNSAVED_TAGS_MAX}
    `,
    sql<Row[]>`
      select path, count(distinct visitor_key) as visitors, count(*) as views,
        avg(engaged_seconds) filter (where engaged_seconds > 0) as avg_seconds
      from traffic_visits
      where kind = 'view' and excluded is null and occurred_at >= ${start}
      group by path
      order by 2 desc, 3 desc, path
      limit 30
    `,
    sql<Row[]>`
      select country, count(distinct visitor_key) as visitors
      from traffic_visits
      where kind = 'view' and excluded is null and occurred_at >= ${start}
      group by country order by 2 desc, country limit 12
    `,
    sql<Row[]>`
      select device, count(distinct visitor_key) as visitors
      from traffic_visits
      where kind = 'view' and excluded is null and occurred_at >= ${start}
      group by device order by 2 desc, device
    `,
    sql<Row[]>`
      select browser, count(distinct visitor_key) as visitors
      from traffic_visits
      where kind = 'view' and excluded is null and occurred_at >= ${start}
      group by browser order by 2 desc, browser limit 8
    `,
    // The names come from the app as they are now, asked while the other reads run.
    sql<Row[]>`
      select v.occurred_at, v.user_id, v.source, v.campaign, v.landing_path, v.first_seen_at, v.views_before, v.country,
        f.answer as found_via, f.other as found_via_other
      from traffic_visits v
      left join traffic_found_via f on f.user_id = v.user_id
      where v.kind = 'signup' and v.excluded is null
      order by v.occurred_at desc
      limit 10
    `.then(async (rows) => ({ rows, accounts: await liveAccounts(input.accounts, rows) })),
    // An answer counts unless its account's sign-up is excluded (a test tag, a bot).
    sql<Row[]>`
      select f.answer, count(*) as signups
      from traffic_found_via f
      left join traffic_visits v on v.kind = 'signup' and v.user_id = f.user_id
      where f.answered_at >= ${start} and v.excluded is null
      group by f.answer
      order by 2 desc, f.answer
    `,
  ]);

  const totals = totalsRows[0] ?? {};
  const visitors = count(totals.visitors);
  const signupCount = count(totals.signups);

  const links: TrafficLink[] = [
    ...savedRows.map((row) => ({
      name: String(row.name),
      platform: textOrNull(row.platform),
      path: textOrNull(row.path),
      saved: true,
      createdAt: iso(row.created_at),
      visitors: count(row.visitors),
      signups: count(row.signups),
    })),
    ...unsavedRows.map((row) => ({
      name: String(row.campaign),
      platform: textOrNull(row.source),
      path: null,
      saved: false,
      createdAt: null,
      visitors: count(row.visitors),
      signups: count(row.signups),
    })),
  ];
  links.sort((a, b) => b.visitors - a.visitors || b.signups - a.signups || (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.name.localeCompare(b.name));

  return {
    range,
    timeZone,
    bucket,
    windowStart: iso(totals.window_start) ?? new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    site: { url: input.site.url, linkPages: input.site.linkPages.map((page) => ({ value: page.value, label: page.label })), testTag: input.site.testTag },
    totals: { visitors, views: count(totals.views), signups: signupCount, joinRate: joinRate(signupCount, visitors) },
    previous: { visitors: count(totals.previous_visitors), views: count(totals.previous_views), signups: count(totals.previous_signups) },
    liveVisitors: count(totals.live),
    series: seriesRows.map((row) => ({ bucket: String(row.bucket), visitors: count(row.visitors), views: count(row.views), signups: count(row.signups) })),
    sources: sourceRows.map((row) => ({ source: String(row.source), visitors: count(row.visitors), signups: count(row.signups) })),
    foundVia: foundViaRows.map((row) => {
      const answer = String(row.answer);
      return { answer, label: foundViaLabel(answer, input.answers) ?? answer, signups: count(row.signups) };
    }),
    links,
    pages: pageRows.map((row) => ({
      path: String(row.path),
      visitors: count(row.visitors),
      views: count(row.views),
      avgSeconds: row.avg_seconds === null || row.avg_seconds === undefined ? null : Math.round(Number(row.avg_seconds)),
    })),
    countries: countryRows.map((row) => ({ country: textOrNull(row.country), visitors: count(row.visitors) })),
    devices: deviceRows.map((row) => ({ device: textOrNull(row.device), visitors: count(row.visitors) })),
    browsers: browserRows.map((row) => ({ browser: textOrNull(row.browser), visitors: count(row.visitors) })),
    latestSignups: signups.rows.map((row) => {
      const userId = textOrNull(row.user_id);
      // No hook, or one that cannot say right now: unknown, which is not removed.
      const account = userId && signups.accounts ? signups.accounts.get(userId) : undefined;
      const foundVia = textOrNull(row.found_via);
      return {
        at: iso(row.occurred_at) ?? '',
        userId,
        name: account?.name ?? null,
        email: account?.email ?? null,
        removed: Boolean(userId && signups.accounts && !account),
        source: textOrNull(row.source),
        campaign: textOrNull(row.campaign),
        landingPath: textOrNull(row.landing_path),
        firstSeenAt: iso(row.first_seen_at),
        viewsBefore: row.views_before === null || row.views_before === undefined ? null : count(row.views_before),
        country: textOrNull(row.country),
        foundVia,
        foundViaLabel: foundViaLabel(foundVia, input.answers),
        foundViaOther: textOrNull(row.found_via_other),
      };
    }),
  };
}
