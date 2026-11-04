/**
 * Where a new account came from. Taken from BetterFans Link's
 * lib/traffic/signup.server.ts.
 *
 * Right after someone signs up, the app says so: the browser's noteSignup()
 * (POST <basePath>/signup), or recordSignup from the app's own account code
 * on the server. Both run recordSignupOutcome: it confirms the account is
 * new, then looks up the views of the same browser on the same connection
 * (visitor key) in the 30 days before and takes the first one that arrived
 * from somewhere: its source, its tag and its page. When the person switched
 * browsers on the way (an in-app browser, then "Open in Safari"), the same
 * address in the last two hours stands in. The answer is written as one
 * sign-up row per account, so the Traffic page counts sign-ups by source.
 *
 * The sign-up row also keeps the click id of the last Google ad that visitor
 * arrived from in that time, so Google Ads can be told which ad click became
 * a sign-up (google-ads.ts). The source stays the first arrival.
 *
 * The row keeps no address, user agent or visitor key (a check in the table
 * holds it), and no name or email: the page reads those live from the app.
 */
import { randomUUID } from 'node:crypto';
import type { ResolvedTrafficConfig, TrafficSql, TrafficUser } from '../config';
import { browserName, deviceClass, isBotUserAgent, systemName } from '../shared/device';
import { DIRECT_SOURCE, isTestTag } from '../shared/origin';
import { requestFacts, visitorKey, type RequestFacts } from './request';

const HOUR = 60 * 60 * 1000;
const LOOKBACK_MS = 30 * 24 * HOUR;
const SAME_ADDRESS_MS = 2 * HOUR;
/** An account this new is one the sign-up form just made; an older one signing in is not a sign-up. */
export const NEW_ACCOUNT_MS = 30 * 60 * 1000;

/** The click ids Google added to an ad's link: a gclid, or gbraid or wbraid from iOS. */
export type AdClick = Readonly<{ gclid: string | null; gbraid: string | null; wbraid: string | null }>;

export type SignupOrigin = Readonly<{
  source: string;
  campaign: string | null;
  landingPath: string;
  firstSeenAt: string;
  viewsBefore: number;
  /** The last Google ad this visitor arrived from before signing up, or null. */
  adClick: AdClick | null;
}>;

type ArrivalRow = {
  source: string;
  campaign: string | null;
  path: string;
  occurred_at: Date | string;
  views: number | string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
};

function toOrigin(row: ArrivalRow): SignupOrigin {
  const firstSeenAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString();
  const adClick = row.gclid || row.gbraid || row.wbraid ? { gclid: row.gclid, gbraid: row.gbraid, wbraid: row.wbraid } : null;
  return { source: row.source, campaign: row.campaign, landingPath: row.path, firstSeenAt, viewsBefore: Number(row.views) || 0, adClick };
}

/** The first arrival of this visitor before signing up, or null when the site never saw them. */
export async function findSignupOrigin(sql: TrafficSql, facts: RequestFacts, now = new Date()): Promise<SignupOrigin | null> {
  const key = visitorKey(facts.ip, facts.userAgent);
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const [byBrowser] = await sql<ArrivalRow[]>`
    with mine as (
      select source, campaign, path, occurred_at, gclid, gbraid, wbraid from traffic_visits
      where kind = 'view' and visitor_key = ${key} and occurred_at > ${since}::timestamptz and excluded is distinct from 'bot'
    ), ad as (
      select gclid, gbraid, wbraid from mine
      where gclid is not null or gbraid is not null or wbraid is not null
      order by occurred_at desc limit 1
    )
    select mine.source, mine.campaign, mine.path, mine.occurred_at, (select count(*)::int from mine) as views, ad.gclid, ad.gbraid, ad.wbraid
    from mine left join ad on true
    where mine.source is not null order by mine.occurred_at asc limit 1
  `;
  if (byBrowser) return toOrigin(byBrowser);
  if (!facts.ip) return null;
  const recent = new Date(now.getTime() - SAME_ADDRESS_MS).toISOString();
  const [byAddress] = await sql<ArrivalRow[]>`
    with mine as (
      select source, campaign, path, occurred_at, gclid, gbraid, wbraid from traffic_visits
      where kind = 'view' and ip = ${facts.ip}::inet and occurred_at > ${recent}::timestamptz and excluded is distinct from 'bot'
    ), ad as (
      select gclid, gbraid, wbraid from mine
      where gclid is not null or gbraid is not null or wbraid is not null
      order by occurred_at desc limit 1
    )
    select mine.source, mine.campaign, mine.path, mine.occurred_at, (select count(*)::int from mine) as views, ad.gclid, ad.gbraid, ad.wbraid
    from mine left join ad on true
    where mine.source is not null order by mine.occurred_at asc limit 1
  `;
  return byAddress ? toOrigin(byAddress) : null;
}

/**
 * The sign-up's own row, once per account: counted under where the person
 * first came from (or Direct or unknown). Marked excluded for a test tag,
 * else for a bot's user agent, so neither is ever counted.
 */
export async function recordSignupVisit(
  sql: TrafficSql,
  input: Readonly<{ userId: string; origin: SignupOrigin | null; facts: RequestFacts; path: string; testTag: string; now?: Date }>,
): Promise<boolean> {
  const { facts, origin } = input;
  const agent = facts.userAgent ?? '';
  const excluded = isTestTag(origin?.campaign, input.testTag) ? 'test' : isBotUserAgent(facts.userAgent) ? 'bot' : null;
  const inserted = await sql`
    insert into traffic_visits (
      id, kind, occurred_at, path, source, campaign, landing_path, first_seen_at, views_before, gclid, gbraid, wbraid,
      country, device, browser, os, excluded, user_id
    ) values (
      ${randomUUID()}, 'signup', ${(input.now ?? new Date()).toISOString()}::timestamptz, ${input.path},
      ${origin?.source ?? DIRECT_SOURCE}, ${origin?.campaign ?? null}, ${origin?.landingPath ?? null},
      ${origin?.firstSeenAt ?? null}::timestamptz, ${origin?.viewsBefore ?? 0},
      ${origin?.adClick?.gclid ?? null}, ${origin?.adClick?.gbraid ?? null}, ${origin?.adClick?.wbraid ?? null},
      ${facts.country}, ${agent ? deviceClass(agent) : null}, ${agent ? browserName(agent) : null}, ${agent ? systemName(agent) : null},
      ${excluded}, ${input.userId}
    )
    on conflict (user_id) where kind = 'signup' do nothing
    returning id
  `;
  return inserted.length > 0;
}

/** True for an account made in the last 30 minutes. One with no creation time is never new. */
export function isNewAccount(user: TrafficUser, now = Date.now()): boolean {
  const createdAt = user.createdAt ? Date.parse(user.createdAt) : Number.NaN;
  return Number.isFinite(createdAt) && now - createdAt <= NEW_ACCOUNT_MS;
}

/**
 * recorded: this call wrote the account's sign-up row. counted-before: an
 * earlier call did. not-new: an older account, or a view-as session (someone
 * else is looking). no-database: Traffic has no database.
 */
export type SignupOutcome = 'recorded' | 'counted-before' | 'not-new' | 'no-database';

/** What POST /signup and recordSignup both do once they know who it is. Throws when the database fails. */
export async function recordSignupOutcome<User extends TrafficUser>(
  config: ResolvedTrafficConfig<User>,
  input: Readonly<{ request: Request; user: TrafficUser; facts?: RequestFacts; now?: Date }>,
): Promise<SignupOutcome> {
  const now = input.now ?? new Date();
  if (input.user.viewedAs || !isNewAccount(input.user, now.getTime())) return 'not-new';
  const sql = await config.db();
  if (!sql) return 'no-database';
  const facts = input.facts ?? requestFacts(input.request, config);
  const origin = await findSignupOrigin(sql, facts, now);
  const recorded = await recordSignupVisit(sql, { userId: input.user.id, origin, facts, path: config.signupPath, testTag: config.testTag, now });
  return recorded ? 'recorded' : 'counted-before';
}
