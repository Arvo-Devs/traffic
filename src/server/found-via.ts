/**
 * Keeps a new account's answer to "How did you find us?" (shared/found-via.ts)
 * in traffic_found_via. One row per account and the first answer stays: the
 * question shows once, on the first screen a new account sees, so a second
 * note is a retry, never a change of mind.
 */
import type { TrafficSql } from '../config';
import type { FoundViaNote } from '../shared/found-via';

/** True when this was the account's first answer and it was kept. */
export async function recordFoundVia(sql: TrafficSql, input: Readonly<{ userId: string; note: FoundViaNote; now?: Date }>): Promise<boolean> {
  const { note } = input;
  const inserted = await sql`
    insert into traffic_found_via (user_id, answer, other, answered_at)
    values (${input.userId}, ${note.answer}, ${note.other}, ${(input.now ?? new Date()).toISOString()}::timestamptz)
    on conflict (user_id) do nothing
    returning user_id
  `;
  return inserted.length > 0;
}
