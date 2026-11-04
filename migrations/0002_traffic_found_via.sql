-- @arvo/traffic 0002: "How did you find us?", the same table as BetterFans
-- Link's 0007_traffic_found_via. The answer a new account gave on the first
-- screen it saw, or `skipped` when the question was left blank. One row per
-- account, and the first answer stays. The Traffic page joins it to the
-- sign-up row by the account's id. The list of answers is the app's config,
-- so a new one needs no migration. Never edit this file once applied.
create table if not exists traffic_found_via (
  user_id text primary key,
  answer text not null,
  other text,
  answered_at timestamptz not null default now(),
  constraint traffic_found_via_answer_check check (answer ~ '^[a-z][a-z-]{0,29}$'),
  constraint traffic_found_via_other_check check (other is null or char_length(other) between 1 and 120)
);
create index if not exists traffic_found_via_answered_idx on traffic_found_via (answered_at);
