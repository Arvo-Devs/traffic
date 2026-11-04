-- @arvo/traffic 0001: the visit counter's tables, for a new install. The
-- same tables as BetterFans Link's 0001_traffic and 0002_traffic_ad_clicks,
-- except that a row keeps no name or email (the page reads them live from
-- the app) and a sign-up row keeps no address, user agent or visitor key.
--
-- traffic_visits has one row per page view of a counted page, sent by the
-- page itself, and one row per sign-up carrying where that person first came
-- from. The address, user agent, visitor key and ad click ids (gclid, or
-- gbraid and wbraid from iOS) are cleared after 180 days; the rest stays so
-- old totals still add up. Never edit this file once applied: a later
-- version of the package adds a new one.
create table if not exists traffic_visits (
  id uuid primary key,
  kind text not null,
  occurred_at timestamptz not null default now(),
  path text not null,
  source text,
  campaign text,
  ref text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_host text,
  referrer_path text,
  landing_path text,
  first_seen_at timestamptz,
  views_before integer,
  country text,
  device text,
  browser text,
  os text,
  screen_width integer,
  language text,
  ip inet,
  user_agent text,
  visitor_key text,
  engaged_seconds integer not null default 0,
  excluded text,
  user_id text,
  gclid text,
  gbraid text,
  wbraid text,
  constraint traffic_visits_kind_check check (kind in ('view', 'signup')),
  constraint traffic_visits_device_check check (device is null or device in ('phone', 'tablet', 'computer')),
  constraint traffic_visits_excluded_check check (excluded is null or excluded in ('bot', 'test')),
  constraint traffic_visits_engaged_check check (engaged_seconds between 0 and 3600),
  constraint traffic_visits_conversion_no_address_check check (kind = 'view' or (ip is null and user_agent is null and visitor_key is null))
);
create index if not exists traffic_visits_occurred_idx on traffic_visits (occurred_at);
create index if not exists traffic_visits_visitor_idx on traffic_visits (visitor_key, occurred_at);
create unique index if not exists traffic_visits_signup_user_idx on traffic_visits (user_id) where kind = 'signup';

-- The link maker: a short tag for one post (<site>/?ref=<name>) and where it
-- was posted, so a click with no referrer is filed under the right place.
create table if not exists traffic_links (
  name text primary key,
  platform text not null,
  path text not null default '/',
  created_by text,
  created_at timestamptz not null default now(),
  constraint traffic_links_name_check check (name ~ '^[a-z0-9][a-z0-9._-]{0,59}$')
);
