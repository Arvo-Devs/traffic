// Whether Traffic is doing its job, for the place the app shows its other
// checks (never the load balancer's health check: a database problem must
// not take the site down). Two things can go wrong without anyone seeing:
// the clearing of old addresses stops, so the Privacy page is no longer
// true, or the counter stops sending, so the page shows a quiet week.
import type { TrafficSql } from '../config';
import { TRAFFIC_ADDRESS_RETENTION_DAYS } from '../paths';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Past retention plus this, a row that still holds an address means the clearing has stopped. */
export const TRAFFIC_CLEAR_GRACE_DAYS = 2;
/** No counted view in this long, and the counter has probably stopped. */
export const TRAFFIC_QUIET_HOURS = 72;

export type TrafficHealth = Readonly<{
  /** down: an old row still holds an address (or there is no database); quiet: no counted view in 72 hours. */
  status: 'ok' | 'quiet' | 'down';
  /** The newest counted view (excluded is null), or null when there is none. */
  lastViewAt: string | null;
  /** The oldest row that still holds an address, user agent or visitor key, or null when none does. */
  oldestUnclearedAt: string | null;
}>;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function trafficHealth(sql: TrafficSql | null, now = new Date()): Promise<TrafficHealth> {
  if (!sql) return { status: 'down', lastViewAt: null, oldestUnclearedAt: null };
  const [row] = await sql<{ last_view_at: unknown; oldest_uncleared_at: unknown }[]>`
    select
      (select max(occurred_at) from traffic_visits where kind = 'view' and excluded is null) as last_view_at,
      (select min(occurred_at) from traffic_visits
        where ip is not null or user_agent is not null or visitor_key is not null) as oldest_uncleared_at
  `;
  const lastViewAt = iso(row?.last_view_at);
  const oldestUnclearedAt = iso(row?.oldest_uncleared_at);
  const clearBy = now.getTime() - (TRAFFIC_ADDRESS_RETENTION_DAYS + TRAFFIC_CLEAR_GRACE_DAYS) * DAY;
  const status =
    oldestUnclearedAt && Date.parse(oldestUnclearedAt) < clearBy
      ? 'down'
      : !lastViewAt || Date.parse(lastViewAt) < now.getTime() - TRAFFIC_QUIET_HOURS * HOUR
        ? 'quiet'
        : 'ok';
  return { status, lastViewAt, oldestUnclearedAt };
}
