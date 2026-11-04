/**
 * The counter's intake: the app's POST /api/site-note. Taken from
 * BetterFans Link's lib/traffic/intake.server.ts.
 *
 * Every counted page sends one small note when it is shown and one when it
 * is hidden or closed (src/counter.tsx). This file turns a note into a row of
 * traffic_visits in the app's own database: where the visit came from
 * (shared/origin.ts), the device (shared/device.ts), the country and the
 * visitor's address from the app's own hooks, the user agent, and a visitor
 * key (a hash of those two) that groups one browser on one connection.
 *
 * Anyone can send a note, so nothing in one is trusted beyond counting, and
 * three bounds hold: notes per address and in total per ten minutes (abuse
 * friction, per process), a fixed body size, and a page path the app counts.
 * The body is read as text whatever its content type: the counter sends
 * text/plain, a request a browser never refuses or preflights. A browser
 * carrying the app's session cookie is not stored (the team and customers
 * must not inflate the numbers), except a test tag, which is stored and never
 * counted.
 *
 * A view from a Google ad also keeps the click id Google added to the link,
 * so a sign-up can be sent back to Google Ads (google-ads.ts).
 *
 * The address, user agent, visitor key and click ids are cleared after 180
 * days (retention.ts); the intake starts that about once an hour.
 */
import type { ResolvedTrafficConfig, TrafficSql, TrafficUser } from '../config';
import { TRAFFIC_NOTE_MAX_BYTES } from '../paths';
import { browserName, deviceClass, isBotUserAgent, systemName } from '../shared/device';
import { parseTrafficNote, type TrafficNote } from '../shared/note';
import { isTestTag, normalizeLinkName, visitOrigin, type ExtraSources } from '../shared/origin';
import { noContent } from './http';
import { createPublicLimiter } from './limiter';
import { fromOwnPage, readTextUpTo, requestFacts, visitorKey, type RequestFacts } from './request';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** A person reading every page several times over sends far fewer; a flood from one address sends far more. */
export const TRAFFIC_NOTES_PER_VISITOR = 240;
/** Everyone together, per process: a busy launch is a few thousand. */
export const TRAFFIC_NOTES_TOTAL = 30_000;
export const TRAFFIC_WINDOW_MS = 10 * MINUTE;
/** A leave note can only add time to a view this recent. */
const LEAVE_WINDOW_MS = 12 * HOUR;
/** The intake starts the clearing of old addresses at most this often, per process. */
export const TRAFFIC_CLEAR_EVERY_MS = HOUR;

/** What a note is filed against: the site's own hosts, its test tag and its own source names. */
export type NoteSite = Readonly<{ siteHosts: readonly string[]; testTag: string; sources?: ExtraSources }>;

async function savedLinkPlatform(sql: TrafficSql, ref: string | null): Promise<ReadonlyMap<string, string> | undefined> {
  const name = ref ? normalizeLinkName(ref) : null;
  if (!name) return undefined;
  const [link] = await sql<{ platform: string }[]>`select platform from traffic_links where name = ${name} limit 1`;
  return link ? new Map([[name, link.platform]]) : undefined;
}

export type StoreResult = 'stored' | 'updated' | 'dropped';

/** Writes one note. A view from a signed-in browser is dropped unless it carries a test tag. */
export async function storeTrafficNote(
  sql: TrafficSql,
  note: TrafficNote,
  facts: RequestFacts,
  site: NoteSite,
  options: Readonly<{ signedIn?: boolean; now?: Date }> = {},
): Promise<StoreResult> {
  const now = options.now ?? new Date();
  const key = visitorKey(facts.ip, facts.userAgent);
  if (note.kind === 'leave') {
    const since = new Date(now.getTime() - LEAVE_WINDOW_MS).toISOString();
    const updated = await sql`
      update traffic_visits set engaged_seconds = greatest(engaged_seconds, ${note.seconds})
      where id = ${note.id} and kind = 'view' and visitor_key = ${key} and occurred_at > ${since}::timestamptz
      returning id
    `;
    return updated.length ? 'updated' : 'dropped';
  }

  const origin = visitOrigin({
    referrer: note.referrer,
    ref: note.ref,
    utmSource: note.utmSource,
    utmCampaign: note.utmCampaign,
    userAgent: facts.userAgent,
    siteHosts: site.siteHosts,
    savedLinks: await savedLinkPlatform(sql, note.ref),
    sources: site.sources,
  });
  const test = isTestTag(origin.campaign, site.testTag);
  if (options.signedIn && !test) return 'dropped';
  const agent = facts.userAgent ?? '';
  const inserted = await sql`
    insert into traffic_visits (
      id, kind, occurred_at, path, source, campaign, ref, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, gbraid, wbraid,
      referrer_host, referrer_path, country, device, browser, os, screen_width, language, ip, user_agent, visitor_key, excluded
    ) values (
      ${note.id}, 'view', ${now.toISOString()}::timestamptz, ${note.path}, ${origin.source}, ${origin.campaign}, ${note.ref},
      ${note.utmSource}, ${note.utmMedium}, ${note.utmCampaign}, ${note.utmContent}, ${note.utmTerm},
      ${note.gclid}, ${note.gbraid}, ${note.wbraid},
      ${origin.referrerHost}, ${origin.referrerPath}, ${facts.country},
      ${agent ? deviceClass(agent, note.touchPoints) : null}, ${agent ? browserName(agent) : null}, ${agent ? systemName(agent, note.touchPoints) : null},
      ${note.width}, ${note.language}, ${facts.ip}::inet, ${facts.userAgent}, ${key},
      ${test ? 'test' : isBotUserAgent(facts.userAgent) ? 'bot' : null}
    )
    on conflict (id) do nothing
    returning id
  `;
  return inserted.length ? 'stored' : 'dropped';
}

export type IntakeStatus = 204 | 400 | 403 | 413 | 429 | 503;

/**
 * The function the app's note route calls. One per process (createTraffic
 * makes it once): its counts are what bound an address and the route, and it
 * remembers when it last started the clearing.
 */
export function createIntake<User extends TrafficUser>(
  config: ResolvedTrafficConfig<User>,
  clearOld: (sql: TrafficSql) => Promise<number>,
): (request: Request) => Promise<Response> {
  const admit = createPublicLimiter({ perSubject: TRAFFIC_NOTES_PER_VISITOR, total: TRAFFIC_NOTES_TOTAL, windowMs: TRAFFIC_WINDOW_MS });
  let lastClear = 0;

  // Started, never awaited: the visitor's note is answered at once, and a
  // failure is logged for the next run to retry.
  function startClearing(sql: TrafficSql) {
    if (Date.now() - lastClear < TRAFFIC_CLEAR_EVERY_MS) return;
    lastClear = Date.now();
    void clearOld(sql).catch((error: unknown) => config.log('[Traffic] old visitor addresses were not cleared', error));
  }

  async function receive(request: Request): Promise<IntakeStatus> {
    if (!fromOwnPage(request.headers, config.siteHosts)) return 403;
    const facts = requestFacts(request, config);
    if (!admit(facts.ip ?? 'unknown')) return 429;
    const text = await readTextUpTo(request, TRAFFIC_NOTE_MAX_BYTES);
    if (text === null) return 413;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return 400;
    }
    const note = parseTrafficNote(raw, config.isCounted);
    if (!note) return 400;
    try {
      // After the counted check, so the app's own page check only ever sees a path it counts.
      if (note.kind === 'view' && config.isPage && !(await config.isPage(note.path))) return 400;
      const sql = await config.db();
      if (!sql) return 503;
      await storeTrafficNote(sql, note, facts, config, { signedIn: note.kind === 'view' && config.hasSessionCookie(request) });
      startClearing(sql);
      return 204;
    } catch (error) {
      config.log('[Traffic] a site note was not stored', error);
      return 503;
    }
  }

  return async (request: Request) => {
    try {
      return noContent(await receive(request));
    } catch (error) {
      // An app hook (clientIp, country) threw: still a plain answer, never a crash.
      config.log('[Traffic] a site note was not stored', error);
      return noContent(503);
    }
  };
}
