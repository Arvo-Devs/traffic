/**
 * Sign-ups from Google Ads, sent back to Google Ads as offline click
 * conversions, so a campaign can bid for sign-ups instead of clicks. No
 * Google tag and no cookie: the click id Google adds to an ad's link is kept
 * with the visit (intake.ts) and copied to the sign-up row (signup.ts).
 *
 * Google Ads fetches GET <basePath>/google-ads.csv on a schedule over HTTPS
 * with a username and password (HTTP Basic), and reads it as a file of
 * conversions from clicks: a header row, then one row per sign-up. Google
 * reads the last 90 days on every run and skips a conversion it already has
 * (the same click id, name and time), so the file always lists all 90 days.
 *
 * Each row carries one click id, as Google Ads asks: the gclid when the click
 * has one, otherwise its gbraid or wbraid (an iOS click that came without a
 * gclid). Google counts a conversion sent with a gbraid or wbraid only when
 * the conversion action counts Every conversion, not One.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { GOOGLE_ADS_CONVERSION_NAME, type GoogleAdsLogin, type TrafficAccount, type TrafficSql } from '../config';
import { clickId } from '../shared/note';

export { GOOGLE_ADS_CONVERSION_NAME, GOOGLE_ADS_PASSWORD_MIN, googleAdsLogin } from '../config';

const DAY = 24 * 60 * 60 * 1000;

/** Google Ads takes conversions from clicks up to 90 days old. */
export const GOOGLE_ADS_IMPORT_DAYS = 90;

/** Compares digests, so neither the length nor the first difference shows in the time taken. */
function same(given: string, expected: string): boolean {
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
}

/** True when the request carries this login as HTTP Basic credentials. */
export function hasImportLogin(headers: Headers, login: GoogleAdsLogin): boolean {
  const encoded = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(headers.get('authorization') ?? '')?.[1];
  if (!encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  const userMatches = same(decoded.slice(0, colon), login.user);
  const passwordMatches = same(decoded.slice(colon + 1), login.password);
  return userMatches && passwordMatches;
}

/** Which click id a conversion is sent with. */
export type AdClickKind = 'gclid' | 'gbraid' | 'wbraid';

export type AdConversion = Readonly<{ kind: AdClickKind; id: string; occurredAt: string }>;

type SignupRow = { gclid: string | null; gbraid: string | null; wbraid: string | null; occurred_at: Date | string; user_id: string | null };

/** The one click id a sign-up is sent with: its gclid, else its gbraid, else its wbraid. */
function sentClick(row: SignupRow): { kind: AdClickKind; id: string } | null {
  for (const kind of ['gclid', 'gbraid', 'wbraid'] as const) {
    const id = clickId(row[kind]);
    if (id) return { kind, id };
  }
  return null;
}

/**
 * Sign-ups of the last 90 days that came from a Google ad, oldest first. One
 * per gclid, so a second sign-up from the same click is not sent again. A
 * sign-up with only a gbraid or wbraid is always its own row: Google gives
 * one of those to many clicks, so it cannot tell two people apart.
 * Excluded sign-ups (a test tag, a bot) are left out, and so are
 * the team's own: the accounts whose email, as `accounts` gives it now, is
 * one of `staff`. When `accounts` cannot answer (null), the team cannot be
 * told apart and `onUnchecked` is called; the file still goes out.
 */
export async function googleAdsSignups(
  sql: TrafficSql,
  options: Readonly<{
    now?: Date;
    staff?: ReadonlySet<string>;
    accounts?: ((ids: readonly string[]) => Promise<readonly TrafficAccount[] | null>) | null;
    onUnchecked?: () => void;
  }> = {},
): Promise<AdConversion[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - GOOGLE_ADS_IMPORT_DAYS * DAY).toISOString();
  const rows = await sql<SignupRow[]>`
    select gclid, gbraid, wbraid, occurred_at, user_id from traffic_visits
    where kind = 'signup' and (gclid is not null or gbraid is not null or wbraid is not null) and excluded is null
      and occurred_at > ${since}::timestamptz and occurred_at <= ${now.toISOString()}::timestamptz
    order by occurred_at asc
  `;
  const listed = rows.flatMap((row) => {
    const click = sentClick(row);
    return click ? [{ row, click }] : [];
  });

  const staffIds = new Set<string>();
  const staff = options.staff ?? new Set<string>();
  if (staff.size && options.accounts) {
    const ids = [...new Set(listed.map(({ row }) => row.user_id).filter((id): id is string => Boolean(id)))];
    const found = ids.length ? await options.accounts(ids) : [];
    if (found === null) options.onUnchecked?.();
    else for (const account of found) if (account.email && staff.has(account.email.trim().toLowerCase())) staffIds.add(account.id);
  }

  const seenGclids = new Set<string>();
  const conversions: AdConversion[] = [];
  for (const { row, click } of listed) {
    if (row.user_id && staffIds.has(row.user_id)) continue;
    if (click.kind === 'gclid') {
      if (seenGclids.has(click.id)) continue;
      seenGclids.add(click.id);
    }
    const occurredAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString();
    conversions.push({ ...click, occurredAt });
  }
  return conversions;
}

/** "2026-10-26 18:04:05+0000": Google's yyyy-MM-dd HH:mm:ss+z, in UTC, so the file needs no time zone row. */
export function conversionTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')}+0000`;
}

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The file Google Ads reads: its column names in the first row, then one row
 * per sign-up, its one click id in the column for its kind and the other two
 * empty. GBRAID and WBRAID come last, so a mapping made when the file had
 * only the first three columns still reads them. No value or currency: a
 * sign-up has no price, so Google uses the conversion action's own value.
 * Never a name or an email.
 */
export function conversionsCsv(conversions: readonly AdConversion[], conversionName = GOOGLE_ADS_CONVERSION_NAME): string {
  const rows = [
    ['Google Click ID', 'Conversion Name', 'Conversion Time', 'GBRAID', 'WBRAID'],
    ...conversions.map((conversion) => {
      const id = (kind: AdClickKind) => (conversion.kind === kind ? conversion.id : '');
      return [id('gclid'), conversionName, conversionTime(conversion.occurredAt), id('gbraid'), id('wbraid')];
    }),
  ];
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}
