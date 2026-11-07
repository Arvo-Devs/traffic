/**
 * Traffic against a real Postgres, through createTraffic and a pretend app
 * (fake-app.ts): the note door, what the page counts, who may see it, the
 * link maker, sign-ups, "How did you find us?", the Google Ads file, the
 * 180-day clearing and the health read. Ported from BetterFans Link's
 * tests/app/traffic.pg.test.ts. Runs only with TRAFFIC_TEST_PG_URL (a
 * Postgres the test may create databases on): each run makes its own
 * database from migrations/*.sql and drops it at the end.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import type { TrafficAccount, TrafficConfig } from '../src/config';
import { createTraffic, type Traffic } from '../src/index';
import { conversionTime } from '../src/server/google-ads';
import { trafficSummary } from '../src/server/summary';
import { visitorKey } from '../src/server/request';
import { TRAFFIC_CLEAR_BATCH, TRAFFIC_CLEAR_MAX_BATCHES, clearOldVisitorAddresses } from '../src/server/retention';
import type { TrafficSummary } from '../src/shared/summary';
import { CHROME, GOOGLEBOT, PEOPLE, SAFARI, cookieFor, fakeConfig, request, view, type Person } from './fake-app';

const ROOT_URL = process.env.TRAFFIC_TEST_PG_URL ?? '';
const MIGRATIONS = join(import.meta.dir, '..', 'migrations');
const DAY = 24 * 60 * 60 * 1000;
const GCLID = 'Cj0KCQjw8--2BhCHARIsAF_w1gzT9xQ_aZ-cLmv1ZbD8eQ3hR5uUrK0TqWbN1s6YyX4pL2mVxPaEaAgQvEALw_wcB';
const IMPORT_PASSWORD = 'k3Vq9xT2mP7wR4zL8nB5cY1d';

async function migrate(sql: postgres.Sql) {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) await sql.unsafe(readFileSync(join(MIGRATIONS, file), 'utf8'));
}

const plain = (rows: readonly Record<string, unknown>[]) => rows.map((row) => ({ ...row }));

describe.skipIf(!ROOT_URL)('traffic (pg)', () => {
  const database = `traffic_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let traffic: Traffic;
  const logs: string[] = [];

  // The accounts the pretend app knows now: everyone who can sign in, plus these.
  const extraAccounts = new Map<string, TrafficAccount>();
  const accountsHook = { unknown: false, calls: [] as string[][] };
  async function accounts(ids: readonly string[]): Promise<readonly TrafficAccount[] | null> {
    accountsHook.calls.push([...ids]);
    if (accountsHook.unknown) return null;
    const known = new Map<string, TrafficAccount>();
    for (const person of Object.values(PEOPLE)) known.set(person.id, { id: person.id, name: person.name ?? null, email: person.email });
    for (const [id, account] of extraAccounts) known.set(id, account);
    return ids.flatMap((id) => {
      const account = known.get(id);
      return account ? [account] : [];
    });
  }

  function pgConfig(overrides: Partial<TrafficConfig<Person>> = {}): TrafficConfig<Person> {
    return fakeConfig({
      db: () => sql,
      accounts,
      staffEmails: () => ['Admin@Example.com'],
      googleAds: { user: 'google-ads', password: IMPORT_PASSWORD },
      log: (line, error) => logs.push(error === undefined ? line : `${line}: ${String(error)}`),
      ...overrides,
    });
  }

  async function summaryOf(range = '7d', timeZone = 'UTC', instance: Traffic = traffic): Promise<TrafficSummary> {
    const response = await instance.routeHandlers.GET(request(`/api/traffic?range=${range}&tz=${encodeURIComponent(timeZone)}`, { method: 'GET', cookie: cookieFor('admin') }));
    expect(response.status).toBe(200);
    return (await response.json()) as TrafficSummary;
  }

  const note = (instance: Traffic, body: unknown, init: Parameters<typeof request>[1] = {}) => instance.intake(request('/api/site-note', { body, ...init }));
  const newPerson = (who: string, extra: Partial<Person> = {}) => {
    PEOPLE[who] = { id: `usr_${who}`, name: `${who[0]!.toUpperCase()}${who.slice(1)} Person`, email: `${who}@example.test`, emailVerified: false, createdAt: new Date().toISOString(), ...extra };
    return PEOPLE[who]!;
  };

  beforeAll(async () => {
    admin = postgres(ROOT_URL, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`create database ${database}`);
    const url = new URL(ROOT_URL);
    url.pathname = `/${database}`;
    sql = postgres(url.toString(), { max: 4, onnotice: () => undefined });
    await migrate(sql);
    traffic = createTraffic(pgConfig());
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin?.unsafe(`drop database if exists ${database} with (force)`);
    await admin?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`delete from traffic_visits`;
    await sql`delete from traffic_links`;
    await sql`delete from traffic_found_via`;
    extraAccounts.clear();
    accountsHook.unknown = false;
    accountsHook.calls = [];
    logs.length = 0;
  });

  test('the migrations make the tables, and applying them again changes nothing', async () => {
    const columns = () => sql`
      select table_name, column_name, is_nullable, data_type from information_schema.columns
      where table_schema = current_schema() and table_name like 'traffic%' order by table_name, ordinal_position
    `;
    const constraints = () => sql`
      select conname as name, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid::regclass::text like 'traffic%' order by conname
    `;
    const indexes = () => sql`select indexname as name, indexdef from pg_indexes where tablename like 'traffic%' order by indexname`;
    const before = [plain(await columns()), plain(await constraints()), plain(await indexes())] as const;

    expect([...new Set(before[0].map((column) => column.table_name))].sort()).toEqual(['traffic_found_via', 'traffic_links', 'traffic_visits']);
    const visits = before[0].filter((column) => column.table_name === 'traffic_visits');
    expect(visits.map((column) => column.column_name)).not.toContain('user_name');
    expect(visits.map((column) => column.column_name)).not.toContain('user_email');
    expect(visits.find((column) => column.column_name === 'visitor_key')?.is_nullable).toBe('YES');
    expect(before[1].map((constraint) => constraint.name)).toEqual([
      'traffic_found_via_answer_check',
      'traffic_found_via_other_check',
      'traffic_found_via_pkey',
      'traffic_links_name_check',
      'traffic_links_pkey',
      'traffic_visits_conversion_no_address_check',
      'traffic_visits_device_check',
      'traffic_visits_engaged_check',
      'traffic_visits_excluded_check',
      'traffic_visits_kind_check',
      'traffic_visits_pkey',
    ]);
    expect(before[2].map((index) => index.name)).toEqual([
      'traffic_found_via_answered_idx',
      'traffic_found_via_pkey',
      'traffic_links_pkey',
      'traffic_visits_occurred_idx',
      'traffic_visits_pkey',
      'traffic_visits_signup_user_idx',
      'traffic_visits_visitor_idx',
    ]);

    await migrate(sql);
    expect([plain(await columns()), plain(await constraints()), plain(await indexes())]).toEqual([...before]);
  });

  describe('the site-note door', () => {
    test('a view is stored with where it came from, the device, the country and the visitor', async () => {
      const visit = view('/docs/quickstart', { referrer: 'https://www.reddit.com/r/agency/comments/x/?share=secret', width: 390, touch: 5, language: 'en-US' });
      expect((await note(traffic, visit, { country: 'pt', ip: '198.51.100.4' })).status).toBe(204);
      const [row] = await sql`select * from traffic_visits where id = ${visit.id}`;
      expect(row).toMatchObject({
        kind: 'view', path: '/docs/quickstart', source: 'Reddit', referrer_host: 'reddit.com', referrer_path: '/r/agency/comments/x/',
        country: 'PT', device: 'phone', browser: 'Safari', os: 'iOS', screen_width: 390, ip: '198.51.100.4', user_agent: SAFARI,
        visitor_key: visitorKey('198.51.100.4', SAFARI), excluded: null,
      });
      // The same note again is the same view.
      await note(traffic, visit, { ip: '198.51.100.4' });
      expect((await sql`select count(*)::int as n from traffic_visits`)[0]!.n).toBe(1);
    });

    test('a note is read as text whatever its content type: the counter sends text/plain', async () => {
      expect((await note(traffic, view('/'), { contentType: 'text/plain;charset=UTF-8' })).status).toBe(204);
      expect((await note(traffic, view('/features'), { contentType: 'application/json' })).status).toBe(204);
      expect((await note(traffic, view('/pricing'), { contentType: null })).status).toBe(204);
      expect((await sql`select path from traffic_visits order by path`).map((row) => row.path)).toEqual(['/', '/features', '/pricing']);
    });

    test("the address is the one the app's proxy names, never X-Forwarded-For, and ::ffff: is dropped", async () => {
      const named = view('/');
      await note(traffic, named, { ip: '198.51.100.9', forwardedFor: '192.0.2.1' });
      const mapped = view('/');
      await note(traffic, mapped, { ip: '::ffff:198.51.100.10' });
      const unknown = view('/');
      await note(traffic, unknown, { ip: null, forwardedFor: '192.0.2.1' });
      const rows = new Map((await sql`select id, ip, visitor_key from traffic_visits`).map((row) => [row.id as string, { ip: row.ip, key: row.visitor_key }]));
      expect(rows.get(named.id)).toEqual({ ip: '198.51.100.9', key: visitorKey('198.51.100.9', SAFARI) });
      expect(rows.get(mapped.id)).toEqual({ ip: '198.51.100.10', key: visitorKey('198.51.100.10', SAFARI) });
      expect(rows.get(unknown.id)).toEqual({ ip: null, key: visitorKey(null, SAFARI) });
    });

    test('a link with a NUL character in its tags is still counted', async () => {
      // ?utm_source=%00 reaches the note as a real NUL, which Postgres refuses in text.
      const visit = view('/', { ref: 'launch\u0000', utm_source: 'tele\u0000gram', utm_campaign: 'oct\u0000ober', language: 'en\u0000US' });
      expect((await note(traffic, visit)).status).toBe(204);
      expect((await sql`select source, ref, utm_campaign from traffic_visits where id = ${visit.id}`)[0]).toEqual({ source: 'Telegram', ref: 'launch', utm_campaign: 'october' });
    });

    test('a leave note adds the time on the page, only from the same visitor', async () => {
      const visit = view('/features');
      await note(traffic, visit);
      expect((await note(traffic, { kind: 'leave', id: visit.id, seconds: 48 })).status).toBe(204);
      await note(traffic, { kind: 'leave', id: visit.id, seconds: 12 });
      await note(traffic, { kind: 'leave', id: visit.id, seconds: 900 }, { ip: '192.0.2.99' });
      expect((await sql`select engaged_seconds from traffic_visits where id = ${visit.id}`)[0]!.engaged_seconds).toBe(48);
    });

    test("another site's page, a page that is not counted and a broken note are refused", async () => {
      expect((await note(traffic, view('/'), { origin: 'https://evil.example' })).status).toBe(403);
      expect((await note(traffic, view('/'), { origin: null, site: 'cross-site' })).status).toBe(403);
      expect((await note(traffic, view('/link/tok_secret'))).status).toBe(400);
      expect((await note(traffic, view('/dashboard'))).status).toBe(400);
      expect((await note(traffic, view('/docs/../link/tok_secret'))).status).toBe(400);
      expect((await note(traffic, view('/docs/%2e%2E/link/tok_secret'))).status).toBe(400);
      expect((await note(traffic, view('/docs//quickstart'))).status).toBe(400);
      expect((await note(traffic, '{not json')).status).toBe(400);
      expect((await note(traffic, { ...view('/'), referrer: 'x'.repeat(5000) })).status).toBe(413);
      expect((await sql`select count(*)::int as n from traffic_visits`)[0]!.n).toBe(0);
      // No Origin from our own page (some browsers' beacons) still counts.
      expect((await note(traffic, view('/'), { origin: null, site: 'same-origin' })).status).toBe(204);
    });

    test('a page the app says does not exist is not stored', async () => {
      const checked = createTraffic(pgConfig({ isPage: (path) => path !== '/docs/missing' }));
      expect((await note(checked, view('/docs/missing'))).status).toBe(400);
      expect((await note(checked, view('/docs/quickstart'))).status).toBe(204);
      expect((await sql`select path from traffic_visits`).map((row) => row.path)).toEqual(['/docs/quickstart']);
    });

    test('a signed-in browser is left out unless the visit is a test, and a bot is marked', async () => {
      const signedIn = view('/');
      await note(traffic, signedIn, { cookie: cookieFor('owner') });
      expect(await sql`select id from traffic_visits where id = ${signedIn.id}`).toHaveLength(0);
      const check = view('/', { ref: 'ex-test-after-deploy' });
      await note(traffic, check, { cookie: cookieFor('admin') });
      expect((await sql`select excluded from traffic_visits where id = ${check.id}`)[0]!.excluded).toBe('test');
      const bot = view('/');
      await note(traffic, bot, { agent: GOOGLEBOT });
      expect((await sql`select excluded from traffic_visits where id = ${bot.id}`)[0]!.excluded).toBe('bot');
    });

    test('a tagged link files a click with no referrer under where it was posted', async () => {
      await sql`insert into traffic_links (name, platform) values ('launch-thread', 'Telegram')`;
      const visit = view('/', { ref: 'Launch Thread' });
      await note(traffic, visit);
      expect((await sql`select source, campaign, ref from traffic_visits where id = ${visit.id}`)[0]).toEqual({ source: 'Telegram', campaign: 'launch-thread', ref: 'Launch Thread' });
    });

    test("the app's own source names reach the intake, and link-in-bio pages are one source", async () => {
      const own = createTraffic(pgConfig({ sources: { hosts: { 'partner.example': 'Partner' } } }));
      await note(own, view('/', { referrer: 'https://blog.partner.example/review' }));
      await note(traffic, view('/', { referrer: 'https://beacons.ai/someone' }));
      await note(traffic, view('/', { referrer: 'https://partner.example/' }));
      expect((await sql`select source from traffic_visits order by source`).map((row) => row.source)).toEqual(['Link in bio', 'Partner', 'partner.example']);
    });
  });

  describe('what the page counts', () => {
    test('totals, sources, pages, devices, countries, links and sign-ups add up', async () => {
      const now = Date.now();
      const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
      const rows: Record<string, unknown>[] = [
        { visitor_key: 'a', source: 'Google', occurred_at: at(30), engaged_seconds: 40 },
        { visitor_key: 'a', source: null, path: '/docs', occurred_at: at(29), engaged_seconds: 20 },
        { visitor_key: 'b', source: 'Reddit', campaign: 'reddit-launch', country: 'PT', device: 'computer', browser: 'Chrome', occurred_at: at(2) },
        { visitor_key: 'c', source: 'X', campaign: 'october', occurred_at: at(60) },
        { visitor_key: 'bot', source: 'Google', excluded: 'bot', occurred_at: at(5) },
        { visitor_key: 't', source: 'Direct or unknown', excluded: 'test', occurred_at: at(5) },
        { visitor_key: 'old', source: 'Google', occurred_at: new Date(now - 8 * DAY).toISOString() },
        { kind: 'signup', path: '/sign-up', visitor_key: null, source: 'Reddit', campaign: 'reddit-launch', landing_path: '/', views_before: 1, user_id: 'usr_b', occurred_at: at(1) },
      ];
      for (const row of rows) {
        const full = { id: crypto.randomUUID(), kind: 'view', path: '/', country: 'US', device: 'phone', browser: 'Safari', os: 'iOS', engaged_seconds: 0, ...row };
        await sql`insert into traffic_visits ${sql(full)}`;
      }
      await sql`insert into traffic_links (name, platform) values ('reddit-launch', 'Reddit'), ('unused-link', 'X')`;
      extraAccounts.set('usr_b', { id: 'usr_b', name: 'Dana Ruiz', email: 'dana@example.test' });

      const s = await summaryOf('7d', 'America/Los_Angeles');
      expect(s.site).toEqual({ url: 'https://example.com', linkPages: [{ value: '/', label: 'Home' }], testTag: 'ex-test' });
      expect(s.totals).toEqual({ visitors: 3, views: 4, signups: 1, joinRate: 33.3 });
      expect(s.previous).toEqual({ visitors: 1, views: 1, signups: 0 });
      expect(s.liveVisitors).toBe(1);
      expect(s.series.length).toBe(7);
      expect(s.series.reduce((sum, b) => sum + b.views, 0)).toBe(4);
      expect(s.sources).toEqual([
        { source: 'Reddit', visitors: 1, signups: 1 },
        { source: 'Google', visitors: 1, signups: 0 },
        { source: 'X', visitors: 1, signups: 0 },
      ]);
      expect(s.pages).toEqual([
        { path: '/', visitors: 3, views: 3, avgSeconds: 40 },
        { path: '/docs', visitors: 1, views: 1, avgSeconds: 20 },
      ]);
      expect(s.countries).toEqual([{ country: 'US', visitors: 2 }, { country: 'PT', visitors: 1 }]);
      expect(s.devices).toEqual([{ device: 'phone', visitors: 2 }, { device: 'computer', visitors: 1 }]);
      expect(s.links.map((l) => [l.name, l.platform, l.saved, l.visitors, l.signups])).toEqual([
        ['reddit-launch', 'Reddit', true, 1, 1],
        ['october', 'X', false, 1, 0],
        ['unused-link', 'X', true, 0, 0],
      ]);
      expect(s.latestSignups).toEqual([
        expect.objectContaining({ userId: 'usr_b', name: 'Dana Ruiz', email: 'dana@example.test', removed: false, source: 'Reddit', campaign: 'reddit-launch', landingPath: '/', viewsBefore: 1, foundVia: null, foundViaLabel: null }),
      ]);
      // One call to the app for the names, with every id at once.
      expect(accountsHook.calls).toEqual([['usr_b']]);

      const today = await summaryOf('today', 'Not/AZone');
      expect(today.timeZone).toBe('UTC');
      expect(today.bucket).toBe('hour');
    });

    test('a saved link shows its own visits far outside the top 100 tags, and stays saved', async () => {
      const at = new Date(Date.now() - 60 * 60_000).toISOString();
      const row = (campaign: string, key: string | null, extra: Record<string, unknown> = {}) => ({
        id: crypto.randomUUID(), kind: 'view', path: '/', source: 'X', campaign, visitor_key: key, user_id: null, occurred_at: at, ...extra,
      });
      // 101 tags nobody saved, two visitors each, and a saved link with one visitor and one sign-up.
      const visits = Array.from({ length: 101 }, (_, i) => [row(`tag-${String(i).padStart(3, '0')}`, `x${i}`), row(`tag-${String(i).padStart(3, '0')}`, `y${i}`)]).flat();
      visits.push(row('quiet-post', 'q', { source: 'Telegram' }), row('quiet-post', null, { kind: 'signup', path: '/sign-up', source: 'Telegram', user_id: 'usr_quiet' }));
      await sql`insert into traffic_visits ${sql(visits)}`;
      // 210 saved links made since, so the quiet one is also past the 200 newest.
      const links = Array.from({ length: 210 }, (_, i) => ({ name: `saved-${String(i).padStart(3, '0')}`, platform: 'Reddit', path: '/', created_at: new Date(Date.now() - (i + 1) * 60_000).toISOString() }));
      links.push({ name: 'quiet-post', platform: 'Telegram', path: '/docs', created_at: new Date(Date.now() - 400 * DAY).toISOString() });
      await sql`insert into traffic_links ${sql(links)}`;

      const s = await summaryOf();
      expect(s.links.filter((l) => l.name === 'quiet-post')).toEqual([
        { name: 'quiet-post', platform: 'Telegram', path: '/docs', saved: true, createdAt: links[210]!.created_at, visitors: 1, signups: 1 },
      ]);
      expect(s.links.filter((l) => l.saved)).toHaveLength(211);
      const unsaved = s.links.filter((l) => !l.saved);
      expect(unsaved).toHaveLength(100);
      expect(unsaved.every((l) => l.visitors === 2 && l.platform === 'X' && l.path === null)).toBe(true);
      // The 101st tag by visitors (ties by name) is the one left out.
      expect(unsaved.map((l) => l.name)).not.toContain('tag-100');
    });

    test('"yesterday by this time" and "the 7 days before" keep the clock of the viewer across a time change', async () => {
      // Los Angeles went from PDT (UTC-7) to PST (UTC-8) at 2 AM on Nov 1, 2026.
      // The earlier window was worked out in the database's own zone (UTC), so
      // around the change it started or ended an hour away from the viewer's clock.
      const zone = 'America/Los_Angeles';
      const views = (...times: string[]) =>
        Promise.all(times.map((at) => sql`insert into traffic_visits ${sql({ id: crypto.randomUUID(), kind: 'view', path: '/', visitor_key: at, source: 'Google', occurred_at: at })}`));
      await views(
        '2026-10-25T07:30:00Z', // Oct 25, 12:30 AM PDT: the first hour of "the 7 days before" Nov 2
        '2026-10-31T07:30:00Z', // Oct 31, 12:30 AM PDT
        '2026-10-31T17:30:00Z', // Oct 31, 10:30 AM PDT: after 10 AM, so not "by this time" on Nov 1
        '2026-11-01T07:30:00Z', // Nov 1, 12:30 AM PDT: the first hour of "yesterday" on Nov 2
        '2026-11-01T17:30:00Z', // Nov 1, 9:30 AM PST
      );
      const at = (range: 'today' | '7d', now: string) =>
        trafficSummary(sql, { range, timeZone: zone, site: { url: 'https://example.com', linkPages: [], testTag: 'ex-test' }, answers: [], now: new Date(now) });

      // Nov 2, 10 AM PST: yesterday is Nov 1 from 12 AM PDT to 10 AM PST.
      expect((await at('today', '2026-11-02T18:00:00Z')).previous.views).toBe(2);
      // Nov 1, 10 AM PST: yesterday is Oct 31 from 12 AM to 10 AM PDT.
      const nov1 = await at('today', '2026-11-01T18:00:00Z');
      expect(nov1.windowStart).toBe('2026-11-01T07:00:00.000Z');
      expect(nov1.previous.views).toBe(1);
      // 7 days on Nov 7, 10 AM PST: Oct 25 from 12 AM PDT to Oct 31 at 10 AM PDT.
      const week = await at('7d', '2026-11-07T18:00:00Z');
      expect(week.windowStart).toBe('2026-11-01T07:00:00.000Z');
      expect(week.previous.views).toBe(2);
    });

    test('a zone Chrome names by its old name loads in that zone', async () => {
      // Chrome and Node say Asia/Calcutta for India and Europe/Kiev for Ukraine.
      // A database without tzdata's old names refused them, and the page
      // showed "Traffic is not answering right now."
      for (const [old, current] of [
        ['Asia/Calcutta', 'Asia/Kolkata'],
        ['Europe/Kiev', 'Europe/Kyiv'],
        ['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
        ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
      ] as [string, string][]) {
        const s = await summaryOf('7d', old);
        expect([old, current]).toContain(s.timeZone);
        expect(s.windowStart).toBe((await summaryOf('7d', current)).windowStart);
      }
    });

    test('the latest sign-ups read names live: a deleted account shows as removed, an app that cannot say shows none', async () => {
      for (const [userId, minutesAgo] of [['usr_kept', 3], ['usr_gone', 2]] as const) {
        await sql`insert into traffic_visits ${sql({ id: crypto.randomUUID(), kind: 'signup', path: '/sign-up', source: 'Google', user_id: userId, occurred_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() })}`;
      }
      extraAccounts.set('usr_kept', { id: 'usr_kept', name: 'Kept Person', email: 'kept@example.test' });
      const live = await summaryOf();
      expect(live.latestSignups.map((r) => [r.userId, r.name, r.email, r.removed])).toEqual([
        ['usr_gone', null, null, true],
        ['usr_kept', 'Kept Person', 'kept@example.test', false],
      ]);
      // A name changed in the app shows changed: nothing was stored.
      extraAccounts.set('usr_kept', { id: 'usr_kept', name: 'Renamed Person', email: 'kept@example.test' });
      expect((await summaryOf()).latestSignups[1]?.name).toBe('Renamed Person');
      // The app cannot look accounts up right now: unknown, which is not removed.
      accountsHook.unknown = true;
      expect((await summaryOf()).latestSignups.map((r) => [r.name, r.email, r.removed])).toEqual([[null, null, false], [null, null, false]]);
      // One call per summary, every id at once.
      expect(accountsHook.calls).toEqual([['usr_gone', 'usr_kept'], ['usr_gone', 'usr_kept'], ['usr_gone', 'usr_kept']]);
      // An app with no accounts hook at all.
      const noHook = createTraffic(pgConfig({ accounts: undefined }));
      expect((await summaryOf('7d', 'UTC', noHook)).latestSignups.map((r) => [r.userId, r.name, r.email, r.removed])).toEqual([
        ['usr_gone', null, null, false],
        ['usr_kept', null, null, false],
      ]);
    });
  });

  describe('who may see the page', () => {
    test('only someone the app lets see the page reads it; everyone else gets not found', async () => {
      const read = (who?: string) => traffic.routeHandlers.GET(request('/api/traffic?range=30d&tz=Europe/Lisbon', { method: 'GET', cookie: who ? cookieFor(who) : undefined }));
      expect((await read()).status).toBe(401);
      expect((await read('owner')).status).toBe(404);
      expect((await read('unconfirmed')).status).toBe(404);
      expect((await read('viewedas')).status).toBe(404);
      expect((await read('broken')).status).toBe(503);
      const ok = await read('admin');
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toBe('no-store');
      expect(await ok.json()).toMatchObject({ range: '30d', timeZone: 'Europe/Lisbon' });
      expect((await traffic.routeHandlers.GET(request('/api/traffic?range=1y', { method: 'GET', cookie: cookieFor('admin') }))).status).toBe(400);
    });

    test('the link maker names, checks and removes links', async () => {
      const make = (body: unknown, who = 'admin', origin?: string) => traffic.routeHandlers.POST(request('/api/traffic/links', { body, cookie: cookieFor(who), origin }));
      const made = await make({ name: '  Launch Video ', platform: 'X', path: '/features' });
      expect(made.status).toBe(201);
      expect(await made.json()).toMatchObject({ name: 'launch-video', platform: 'X', path: '/features', saved: true, visitors: 0 });
      const again = await make({ name: 'launch video', platform: 'Reddit', path: '/' });
      expect(again.status).toBe(409);
      expect(((await again.json()) as { error: { message: string } }).error.message).toBe('There is already a link called launch-video. Pick another name.');
      expect((await make({ name: 'ok', platform: 'X', path: '/dashboard' })).status).toBe(400);
      expect((await make({ name: 'ok', platform: 'X', path: '/docs/../link/x' })).status).toBe(400);
      expect((await make({ name: '!!!', platform: 'X', path: '/' })).status).toBe(400);
      expect((await make({ name: 'ok', platform: 'Myspace', path: '/' })).status).toBe(400);
      expect((await make(null)).status).toBe(400);
      expect((await make('not json')).status).toBe(400);
      // A staff member viewing as the admin account cannot make links as them.
      expect((await make({ name: 'viewed', platform: 'X', path: '/' }, 'viewedas')).status).toBe(404);
      expect((await make({ name: 'nope', platform: 'X', path: '/' }, 'owner')).status).toBe(404);
      expect((await make({ name: 'nope', platform: 'X', path: '/' }, 'admin', 'https://evil.example')).status).toBe(403);
      expect((await summaryOf()).links).toEqual([expect.objectContaining({ name: 'launch-video', saved: true, visitors: 0 })]);

      const remove = (name: string) => traffic.routeHandlers.DELETE(request(`/api/traffic/links?name=${name}`, { method: 'DELETE', cookie: cookieFor('admin') }));
      expect((await remove('launch-video')).status).toBe(204);
      expect((await remove('launch-video')).status).toBe(404);
    });

    test('a link to a page the app says does not exist is refused', async () => {
      const checked = createTraffic(pgConfig({ isPage: (path) => path !== '/docs/missing' }));
      const make = (path: string) => checked.routeHandlers.POST(request('/api/traffic/links', { body: { name: 'docs-link', platform: 'X', path }, cookie: cookieFor('admin') }));
      expect((await make('/docs/missing')).status).toBe(400);
      expect((await make('/docs/quickstart')).status).toBe(201);
    });
  });

  describe('where a sign-up came from', () => {
    test('the first arrival of the same browser is the source, counted once per account, with no address kept', async () => {
      const ip = '198.51.100.23';
      await note(traffic, view('/pricing', { referrer: 'https://www.google.com/' }), { ip, agent: CHROME });
      await note(traffic, view('/docs', { referrer: 'https://example.com/pricing' }), { ip, agent: CHROME });
      await note(traffic, view('/sign-up', { referrer: 'https://example.com/docs' }), { ip, agent: CHROME });

      newPerson('fresh');
      const signup = () => traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('fresh'), ip, agent: CHROME, country: 'GB' }));
      expect((await signup()).status).toBe(204);
      expect((await signup()).status).toBe(204);
      const rows = await sql`select * from traffic_visits where kind = 'signup'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: 'usr_fresh', path: '/sign-up', source: 'Google', landing_path: '/pricing', views_before: 3, country: 'GB',
        device: 'computer', browser: 'Chrome', os: 'macOS', excluded: null, ip: null, user_agent: null, visitor_key: null,
      });
      // Names and emails are not even columns: the page reads them live.
      expect(Object.keys(rows[0]!)).not.toContain('user_name');
      expect(Object.keys(rows[0]!)).not.toContain('user_email');

      // An account made long ago, nobody signed in, and another site's page are not sign-ups.
      expect((await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('owner'), ip }))).status).toBe(204);
      expect((await traffic.routeHandlers.POST(request('/api/traffic/signup', { ip }))).status).toBe(401);
      expect((await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('fresh'), origin: 'https://evil.example' }))).status).toBe(403);
      expect(await sql`select id from traffic_visits where kind = 'signup'`).toHaveLength(1);
    });

    test('a switch of browser on the same connection within two hours still finds the source', async () => {
      const ip = '198.51.100.42';
      await note(traffic, view('/', { referrer: 'https://t.co/abc' }), { ip, agent: SAFARI });
      newPerson('switched');
      await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('switched'), ip, agent: CHROME }));
      expect((await sql`select source, landing_path from traffic_visits where user_id = 'usr_switched'`)[0]).toEqual({ source: 'X', landing_path: '/' });
    });

    test('a sign-up from a bot is kept as excluded, one from a test link as a test, and neither counts', async () => {
      newPerson('robot');
      expect((await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('robot'), ip: '198.51.100.51', agent: GOOGLEBOT }))).status).toBe(204);
      const ip = '198.51.100.52';
      await note(traffic, view('/', { ref: 'ex-test-signup-check' }), { ip, agent: CHROME });
      newPerson('tester');
      await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('tester'), ip, agent: CHROME }));
      expect(plain(await sql`select user_id, excluded from traffic_visits where kind = 'signup' order by user_id`)).toEqual([
        { user_id: 'usr_robot', excluded: 'bot' },
        { user_id: 'usr_tester', excluded: 'test' },
      ]);
      const s = await summaryOf();
      expect(s.totals.signups).toBe(0);
      expect(s.latestSignups).toEqual([]);
    });

    test("the app's own account code can count the sign-up, and the browser's call then counts nothing", async () => {
      const ip = '198.51.100.71';
      await note(traffic, view('/', { referrer: 'https://t.co/abc' }), { ip, agent: CHROME });
      const person = newPerson('server');
      const own = request('/api/auth/sign-up', { ip, agent: CHROME, country: 'DE' });
      expect(await traffic.recordSignup({ request: own, user: person })).toBe(true);
      expect(await traffic.recordSignup({ request: own, user: person })).toBe(false);
      // An account made long ago, one with no creation time, and a view-as session are not sign-ups.
      expect(await traffic.recordSignup({ request: own, user: { ...person, id: 'usr_old', createdAt: '2026-01-01T00:00:00.000Z' } })).toBe(false);
      expect(await traffic.recordSignup({ request: own, user: { ...person, id: 'usr_undated', createdAt: null } })).toBe(false);
      expect(await traffic.recordSignup({ request: own, user: { ...person, id: 'usr_viewed', viewedAs: true } })).toBe(false);
      // The browser's call for the same account is the fallback: it counts nothing more.
      expect((await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('server'), ip, agent: CHROME }))).status).toBe(204);
      expect(plain(await sql`select user_id, source, country, ip from traffic_visits where kind = 'signup'`)).toEqual([{ user_id: 'usr_server', source: 'X', country: 'DE', ip: null }]);
      // An app that files sign-ups under its own path.
      const joins = createTraffic(pgConfig({ signupPath: '/join' }));
      expect(await joins.recordSignup({ request: own, user: { ...person, id: 'usr_join' } })).toBe(true);
      expect((await sql`select path from traffic_visits where user_id = 'usr_join'`)[0]?.path).toBe('/join');
    });

    test('recordSignup never throws: a database failure is logged and answers false', async () => {
      const failing = createTraffic(pgConfig({ db: () => Promise.reject(new Error('database is down')) }));
      expect(await failing.recordSignup({ request: request('/api/auth/sign-up'), user: newPerson('unlucky') })).toBe(false);
      expect(logs.some((line) => line.startsWith('[Traffic] a sign-up was not noted'))).toBe(true);
      // And the route answers 503, as before.
      expect((await failing.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('unlucky'), ip: '198.51.100.72' }))).status).toBe(503);
    });

    test('the table refuses a sign-up row that holds an address, a user agent or a visitor key', async () => {
      for (const extra of [{ ip: '203.0.113.9' }, { user_agent: SAFARI }, { visitor_key: 'key' }]) {
        const row = { id: crypto.randomUUID(), kind: 'signup', path: '/sign-up', user_id: `usr_${crypto.randomUUID()}`, ...extra };
        await expect(sql`insert into traffic_visits ${sql(row)}`.then(() => 'stored')).rejects.toThrow('traffic_visits_conversion_no_address_check');
      }
      // A view keeps all three, until the clearing.
      await sql`insert into traffic_visits ${sql({ id: crypto.randomUUID(), kind: 'view', path: '/', ip: '203.0.113.9', user_agent: SAFARI, visitor_key: 'key' })}`;
      expect((await sql`select count(*)::int as n from traffic_visits`)[0]!.n).toBe(1);
    });
  });

  describe('how they found us', () => {
    test('the answer is kept once per account and shows beside where Traffic saw them come from', async () => {
      const ip = '198.51.100.61';
      await note(traffic, view('/'), { ip, agent: CHROME });
      newPerson('asked', { emailVerified: true });
      await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('asked'), ip, agent: CHROME }));
      const answer = (body: unknown) => traffic.routeHandlers.POST(request('/api/traffic/found-via', { body, cookie: cookieFor('asked'), ip, agent: CHROME }));

      expect((await answer({ answer: 'other', other: '  A podcast about agencies  ' })).status).toBe(204);
      // A second note is a retry, never a change of mind.
      expect((await answer({ answer: 'google' })).status).toBe(204);
      expect(plain(await sql`select user_id, answer, other from traffic_found_via`)).toEqual([{ user_id: 'usr_asked', answer: 'other', other: 'A podcast about agencies' }]);

      const s = await summaryOf();
      expect(s.latestSignups).toEqual([
        expect.objectContaining({ name: 'Asked Person', email: 'asked@example.test', source: 'Direct or unknown', foundVia: 'other', foundViaLabel: 'Something else', foundViaOther: 'A podcast about agencies' }),
      ]);
      expect(s.foundVia).toEqual([{ answer: 'other', label: 'Something else', signups: 1 }]);
    });

    test('a skip counts as a skip; a test sign-up and an answer outside the range do not count', async () => {
      await sql`
        insert into traffic_found_via (user_id, answer, answered_at) values
          ('usr_skip', 'skipped', now()), ('usr_test', 'friend', now()), ('usr_norow', 'friend', now()),
          ('usr_old', 'google', now() - interval '10 days')
      `;
      // A sign-up made with a test tag, and one from before the question existed.
      for (const row of [
        { user_id: 'usr_test', excluded: 'test', source: 'Direct or unknown' },
        { user_id: 'usr_never', source: 'Google' },
      ]) {
        await sql`insert into traffic_visits ${sql({ id: crypto.randomUUID(), kind: 'signup', path: '/sign-up', ...row })}`;
      }

      const s = await summaryOf();
      expect(s.foundVia).toEqual([
        { answer: 'friend', label: 'A friend or colleague', signups: 1 },
        { answer: 'skipped', label: 'Skipped', signups: 1 },
      ]);
      expect(s.latestSignups).toEqual([expect.objectContaining({ source: 'Google', foundVia: null, foundViaLabel: null, foundViaOther: null })]);
    });

    test('nobody signed in, another site, a view-as session and a note that is not one are refused', async () => {
      const send = (body: unknown, extra: { cookie?: string; origin?: string } = {}) => traffic.routeHandlers.POST(request('/api/traffic/found-via', { body, ...extra }));
      expect((await send({ answer: 'friend' })).status).toBe(401);
      expect((await send({ answer: 'friend' }, { cookie: cookieFor('owner'), origin: 'https://evil.example' })).status).toBe(403);
      // A staff member viewing as someone does not answer for them.
      expect((await send({ answer: 'friend' }, { cookie: cookieFor('viewedas') })).status).toBe(403);
      expect((await send({ answer: 'tiktok' }, { cookie: cookieFor('owner') })).status).toBe(400);
      expect((await send('not json', { cookie: cookieFor('owner') })).status).toBe(400);
      expect((await send({ answer: 'other', other: 'x'.repeat(2000) }, { cookie: cookieFor('owner') })).status).toBe(413);
      expect(await sql`select user_id from traffic_found_via`).toHaveLength(0);
    });

    test("an app's own answers are the ones taken, under its own words", async () => {
      const own = createTraffic(pgConfig({ foundViaAnswers: [{ value: 'podcast', label: 'A podcast' }, { value: 'other', label: 'Something else' }] }));
      newPerson('listener');
      const send = (body: unknown) => own.routeHandlers.POST(request('/api/traffic/found-via', { body, cookie: cookieFor('listener'), ip: '198.51.100.62' }));
      expect((await send({ answer: 'google' })).status).toBe(400);
      expect((await send({ answer: 'podcast' })).status).toBe(204);
      expect((await summaryOf('7d', 'UTC', own)).foundVia).toEqual([{ answer: 'podcast', label: 'A podcast', signups: 1 }]);
    });
  });

  describe('Google Ads sign-ups', () => {
    const fetchFile = (instance: Traffic, authorization?: string, ip = '66.249.80.1') => {
      const headers = new Headers({ 'user-agent': 'Google-Ads-Conversions', 'x-client-ip': ip });
      if (authorization) headers.set('authorization', authorization);
      return instance.routeHandlers.GET(new Request('https://example.com/api/traffic/google-ads.csv', { headers }));
    };
    const basic = (password: string) => `Basic ${Buffer.from(`google-ads:${password}`).toString('base64')}`;
    const signupRow = (userId: string, extra: Record<string, unknown>) =>
      sql`insert into traffic_visits ${sql({ id: crypto.randomUUID(), kind: 'signup', path: '/sign-up', source: 'Google Ads', user_id: userId, occurred_at: new Date().toISOString(), ...extra })}`;

    test('an ad click is kept with the visit, carried to the sign-up and listed in the file Google Ads reads', async () => {
      const ip = '198.51.100.77';
      // An organic search a day before, then the ad: the source stays the first arrival, the click id is the ad's.
      await sql`insert into traffic_visits (id, kind, occurred_at, path, source, referrer_host, visitor_key, ip)
        values (${crypto.randomUUID()}, 'view', ${new Date(Date.now() - DAY).toISOString()}::timestamptz, '/', 'Google', 'google.com', ${visitorKey(ip, CHROME)}, ${ip}::inet)`;
      const ad = view('/', { referrer: 'https://www.google.com/', utm_source: 'google-ads', utm_medium: 'cpc', utm_campaign: 'ex-search', utm_term: 'example api', gclid: GCLID });
      await note(traffic, ad, { ip, agent: CHROME });
      expect((await sql`select source, campaign, gclid, gbraid, wbraid from traffic_visits where id = ${ad.id}`)[0]).toEqual({ source: 'Google Ads', campaign: 'ex-search', gclid: GCLID, gbraid: null, wbraid: null });
      await note(traffic, view('/sign-up', { referrer: 'https://example.com/' }), { ip, agent: CHROME });

      newPerson('adclick');
      expect((await traffic.routeHandlers.POST(request('/api/traffic/signup', { cookie: cookieFor('adclick'), ip, agent: CHROME }))).status).toBe(204);
      const [row] = await sql`select source, views_before, gclid, occurred_at from traffic_visits where user_id = 'usr_adclick'`;
      expect(row).toMatchObject({ source: 'Google', views_before: 3, gclid: GCLID });

      // Left out: a test, the team's own account (by its email as the app has it now), one too old
      // for Google, one with no click id, a second sign-up from the same gclid.
      const signedUp = new Date(row!.occurred_at).getTime();
      const before = (ms: number) => new Date(signedUp - ms).toISOString();
      await signupRow('usr_test', { gclid: 'EAIaIQobChMItestClick', excluded: 'test', campaign: 'ex-test-ads' });
      await signupRow('usr_staff', { gclid: 'EAIaIQobChMIstaffClick' });
      await signupRow('usr_old', { gclid: 'EAIaIQobChMIoldClick', occurred_at: new Date(Date.now() - 91 * DAY).toISOString() });
      await signupRow('usr_none', {});
      await signupRow('usr_again', { gclid: GCLID, occurred_at: new Date(signedUp + 1).toISOString() });
      // Listed: iOS clicks with no gclid, each its own row even when two share a gbraid (Google
      // gives one gbraid to many clicks), and a click with both, sent with its gclid alone.
      await signupRow('usr_ios_w', { wbraid: 'CkQKCQjw8--2BhCHEjQA', occurred_at: before(4000) });
      await signupRow('usr_ios_a', { gbraid: '0AAAAADa3bC9xYzQ_k-1', occurred_at: before(3000) });
      await signupRow('usr_ios_b', { gbraid: '0AAAAADa3bC9xYzQ_k-1', occurred_at: before(2000) });
      await signupRow('usr_both', { gclid: 'EAIaIQobChMIbothClick', gbraid: '0AAAAADa3bC9xYzQ_k-1', occurred_at: before(1000) });
      extraAccounts.set('usr_staff', { id: 'usr_staff', name: 'Team Member', email: 'admin@example.com' });

      const denied = await fetchFile(traffic);
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toBe('Basic realm="example.com", charset="UTF-8"');
      expect((await fetchFile(traffic, basic(`${IMPORT_PASSWORD}x`))).status).toBe(401);

      const file = await fetchFile(traffic, basic(IMPORT_PASSWORD));
      expect(file.status).toBe(200);
      expect(file.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(file.headers.get('cache-control')).toBe('no-store');
      expect(await file.text()).toBe(
        'Google Click ID,Conversion Name,Conversion Time,GBRAID,WBRAID\r\n'
          + `,Sign-up,${conversionTime(before(4000))},,CkQKCQjw8--2BhCHEjQA\r\n`
          + `,Sign-up,${conversionTime(before(3000))},0AAAAADa3bC9xYzQ_k-1,\r\n`
          + `,Sign-up,${conversionTime(before(2000))},0AAAAADa3bC9xYzQ_k-1,\r\n`
          + `EAIaIQobChMIbothClick,Sign-up,${conversionTime(before(1000))},,\r\n`
          + `${GCLID},Sign-up,${conversionTime(before(0))},,\r\n`,
      );
    });

    test('when the app cannot say whose accounts they are, the file leaves out only test sign-ups, and says so once', async () => {
      const said: string[] = [];
      const instance = createTraffic(pgConfig({ log: (line) => said.push(line) }));
      const at = new Date(Date.now() - 60_000).toISOString();
      await signupRow('usr_staff', { gclid: 'EAIaIQobChMIstaffClick', occurred_at: at });
      await signupRow('usr_test', { gclid: 'EAIaIQobChMItestClick', excluded: 'test', campaign: 'ex-test-ads' });
      extraAccounts.set('usr_staff', { id: 'usr_staff', name: 'Team Member', email: 'admin@example.com' });

      accountsHook.unknown = true;
      const listed = `Google Click ID,Conversion Name,Conversion Time,GBRAID,WBRAID\r\nEAIaIQobChMIstaffClick,Sign-up,${conversionTime(at)},,\r\n`;
      expect(await (await fetchFile(instance, basic(IMPORT_PASSWORD), '66.249.80.2')).text()).toBe(listed);
      expect(await (await fetchFile(instance, basic(IMPORT_PASSWORD), '66.249.80.2')).text()).toBe(listed);
      expect(said.filter((line) => line.includes("team's own accounts"))).toHaveLength(1);

      // Once the app can say again, the team is left out again.
      accountsHook.unknown = false;
      expect(await (await fetchFile(instance, basic(IMPORT_PASSWORD), '66.249.80.2')).text()).toBe('Google Click ID,Conversion Name,Conversion Time,GBRAID,WBRAID\r\n');
    });

    test('without the login, or with a short password, the file does not exist', async () => {
      const off = createTraffic(pgConfig({ googleAds: undefined }));
      expect((await fetchFile(off, basic(IMPORT_PASSWORD))).status).toBe(404);
      const said: string[] = [];
      const short = createTraffic(pgConfig({ googleAds: { user: 'google-ads', password: 'too-short' }, log: (line) => said.push(line) }));
      expect((await fetchFile(short, basic('too-short'))).status).toBe(404);
      expect((await fetchFile(short, basic('too-short'))).status).toBe(404);
      // Said once, when the config was read, not on every fetch.
      expect(said).toHaveLength(1);
    });

    test('guessing the password is stopped after 20 tries from one address', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) statuses.push((await fetchFile(traffic, basic(`guess-${i}`), '192.0.2.200')).status);
      expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
      expect(statuses[20]).toBe(429);
    });
  });

  describe('the 180-day clearing', () => {
    const insertOld = (id: string, daysAgo: number) =>
      sql`insert into traffic_visits (id, kind, occurred_at, path, source, ip, user_agent, visitor_key, gclid, gbraid, wbraid)
        values (${id}, 'view', ${new Date(Date.now() - daysAgo * DAY).toISOString()}::timestamptz, '/', 'Google Ads', '203.0.113.9', 'Safari', 'key', ${GCLID}, '0AAAAADa3bC9xYzQ_k-1', 'CkQKCQjw8--2BhCHEjQA')`;

    test('addresses, user agents, visitor keys and ad click ids go after 180 days; the rest stays; a second run changes nothing', async () => {
      await insertOld('00000000-0000-4000-8000-000000000001', 181);
      await insertOld('00000000-0000-4000-8000-000000000002', 179);
      expect(await clearOldVisitorAddresses(sql)).toBe(1);
      const rows = await sql`select ip, user_agent, visitor_key, gclid, gbraid, wbraid, source from traffic_visits order by id`;
      expect(rows.map((r) => [r.ip, r.user_agent, r.visitor_key, r.gclid, r.gbraid, r.wbraid, r.source])).toEqual([
        [null, null, null, null, null, null, 'Google Ads'],
        ['203.0.113.9', 'Safari', 'key', GCLID, '0AAAAADa3bC9xYzQ_k-1', 'CkQKCQjw8--2BhCHEjQA', 'Google Ads'],
      ]);
      expect(await clearOldVisitorAddresses(sql)).toBe(0);
    });

    test('a backlog is cleared a batch at a time until none is left, and a run stops after its batches', async () => {
      for (let i = 0; i < 7; i += 1) await insertOld(crypto.randomUUID(), 200 + i);
      expect(await clearOldVisitorAddresses(sql, { batch: 2, maxBatches: 3 })).toBe(6);
      expect(await clearOldVisitorAddresses(sql, { batch: 2, maxBatches: 3 })).toBe(1);
      expect(await clearOldVisitorAddresses(sql, { batch: 2, maxBatches: 3 })).toBe(0);
      // The package's own run: 5,000 a batch, up to 100 batches.
      expect([TRAFFIC_CLEAR_BATCH, TRAFFIC_CLEAR_MAX_BATCHES]).toEqual([5000, 100]);
      for (let i = 0; i < 3; i += 1) await insertOld(crypto.randomUUID(), 365);
      expect(await traffic.clearOldVisits()).toBe(3);
      expect(await createTraffic(pgConfig({ db: () => null })).clearOldVisits()).toBe(0);
    });

    test('the intake starts the clearing without waiting for it, at most once an hour', async () => {
      const instance = createTraffic(pgConfig());
      const cleared = async (id: string) => (await sql`select ip from traffic_visits where id = ${id}`)[0]?.ip === null;
      const first = crypto.randomUUID();
      await insertOld(first, 200);
      expect((await note(instance, view('/'), { ip: '198.51.100.90' })).status).toBe(204);
      for (let i = 0; i < 100 && !(await cleared(first)); i += 1) await Bun.sleep(20);
      expect(await cleared(first)).toBe(true);

      const second = crypto.randomUUID();
      await insertOld(second, 200);
      expect((await note(instance, view('/'), { ip: '198.51.100.90' })).status).toBe(204);
      await Bun.sleep(300);
      expect(await cleared(second)).toBe(false);
    });
  });

  describe('health', () => {
    const insertView = (extra: Record<string, unknown>) =>
      sql`insert into traffic_visits ${sql({ id: crypto.randomUUID(), kind: 'view', path: '/', occurred_at: new Date().toISOString(), excluded: null, ip: null, user_agent: null, visitor_key: 'key', ...extra })}`;

    test('quiet with no counted view in 72 hours, ok with one, down when a row past the grace still holds an address', async () => {
      expect(await traffic.health()).toEqual({ status: 'quiet', lastViewAt: null, oldestUnclearedAt: null });

      // A bot's view and a test are not counted views.
      await insertView({ excluded: 'bot' });
      await insertView({ excluded: 'test' });
      expect((await traffic.health()).status).toBe('quiet');
      // A counted view three days and an hour ago is too old to say the counter works.
      await insertView({ occurred_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString() });
      expect((await traffic.health()).status).toBe('quiet');

      await note(traffic, view('/'), { ip: '198.51.100.95' });
      const ok = await traffic.health();
      expect(ok.status).toBe('ok');
      expect(Date.now() - Date.parse(ok.lastViewAt!)).toBeLessThan(60_000);

      // 181 days: past retention, inside the two-day grace.
      await insertView({ occurred_at: new Date(Date.now() - 181 * DAY).toISOString(), ip: '203.0.113.9' });
      expect((await traffic.health()).status).toBe('ok');
      // 183 days with only a visitor key: the clearing has stopped.
      const stuck = new Date(Date.now() - 183 * DAY).toISOString();
      await insertView({ occurred_at: stuck });
      expect(await traffic.health()).toMatchObject({ status: 'down', oldestUnclearedAt: stuck });

      expect(await traffic.clearOldVisits()).toBe(2);
      expect((await traffic.health()).status).toBe('ok');
    });

    test('without a database it is down', async () => {
      expect(await createTraffic(pgConfig({ db: () => null })).health()).toEqual({ status: 'down', lastViewAt: null, oldestUnclearedAt: null });
    });
  });
});
