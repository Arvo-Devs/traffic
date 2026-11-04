// Clears what could name a visitor from rows older than the retention
// period: the address, the user agent, the visitor key (an unsalted hash of
// those two, so it names them as well) and the ad click ids. The rest of the
// row stays, so old totals still add up.
//
// It works through the whole backlog a batch at a time, so a table that
// went months without a run catches up, and stops after about 100 batches
// so one run never holds the database for long. The intake starts it about
// once an hour; an app with a job runner can also call clearOldVisits.
import type { TrafficSql } from '../config';
import { TRAFFIC_ADDRESS_RETENTION_DAYS } from '../paths';

const DAY = 24 * 60 * 60 * 1000;

/** Rows cleared in one statement. */
export const TRAFFIC_CLEAR_BATCH = 5000;
/** Statements in one run: 500,000 rows. A longer backlog is finished by the next run. */
export const TRAFFIC_CLEAR_MAX_BATCHES = 100;

/** How many rows it cleared. */
export async function clearOldVisitorAddresses(
  sql: TrafficSql,
  options: Readonly<{ now?: Date; batch?: number; maxBatches?: number }> = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const batch = options.batch ?? TRAFFIC_CLEAR_BATCH;
  const maxBatches = options.maxBatches ?? TRAFFIC_CLEAR_MAX_BATCHES;
  const cutoff = new Date(now.getTime() - TRAFFIC_ADDRESS_RETENTION_DAYS * DAY).toISOString();
  let cleared = 0;
  for (let round = 0; round < maxBatches; round += 1) {
    // skip locked: a second run at the same time (another machine, a job
    // and the intake) takes other rows instead of waiting on these.
    const result = await sql`
      update traffic_visits set ip = null, user_agent = null, visitor_key = null, gclid = null, gbraid = null, wbraid = null
      where id in (
        select id from traffic_visits
        where occurred_at < ${cutoff}::timestamptz
          and (ip is not null or user_agent is not null or visitor_key is not null
            or gclid is not null or gbraid is not null or wbraid is not null)
        limit ${batch}
        for update skip locked
      )
    `;
    cleared += result.count;
    if (result.count < batch) break;
  }
  return cleared;
}
