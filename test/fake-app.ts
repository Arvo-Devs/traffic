// A pretend app for the tests: its sign-in reads a `session=<who>` cookie,
// its proxy names the visitor's address in x-client-ip and the country in
// x-country, and anyone on MASS_ACCESS with a confirmed email may see the
// page. Requests come as the app's proxy would pass them on, with an
// x-forwarded-for any caller could have written, which Traffic must ignore.
import type { CountedPages } from '../src/paths';
import type { TrafficConfig, TrafficUser } from '../src/config';

export const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
export const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
export const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export const SITE_HOSTS = ['example.com', 'www.example.com', 'app.example.com', 'localhost', '127.0.0.1'];

export const COUNTED: CountedPages = {
  pages: ['/', '/sign-up'],
  sections: ['/docs', '/features', '/help', '/learn', '/pricing', '/privacy'],
};

export type Person = TrafficUser & { emailVerified: boolean };

export const MASS_ACCESS = new Set(['someone@example.org', 'admin@example.com', 'pending@example.com']);

export const PEOPLE: Record<string, Person> = {
  admin: { id: 'usr_admin', name: 'Site Admin', email: 'admin@example.com', emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z' },
  owner: { id: 'usr_owner', name: 'Workspace Owner', email: 'owner@example.test', emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z' },
  unconfirmed: { id: 'usr_unconfirmed', name: 'Not Yet', email: 'pending@example.com', emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z' },
};

export const cookieFor = (who: string) => `theme=dark; session=${who}`;

/** The fake app's config. `db` answers null (no database) unless the test gives one. */
export function fakeConfig(overrides: Partial<TrafficConfig<Person>> = {}): TrafficConfig<Person> {
  return {
    db: () => null,
    signedInUser: async (request) => {
      const who = /(?:^|;\s*)session=([a-z]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
      if (!who) return null;
      if (who === 'broken') throw new Error('sign-in is down');
      // A staff member viewing as the admin account.
      if (who === 'viewedas') return { ...PEOPLE.admin, viewedAs: true };
      return PEOPLE[who] ?? null;
    },
    canView: (user) => user.emailVerified && !user.viewedAs && MASS_ACCESS.has(user.email.toLowerCase()),
    hasSessionCookie: (request) => /(?:^|;\s*)session=/.test(request.headers.get('cookie') ?? ''),
    counted: COUNTED,
    siteHosts: SITE_HOSTS,
    siteUrl: 'https://example.com/',
    clientIp: (request) => request.headers.get('x-client-ip'),
    country: (request) => request.headers.get('x-country'),
    testTag: 'ex-test',
    log: () => undefined,
    ...overrides,
  };
}

export type RequestInitLike = {
  method?: string;
  body?: unknown;
  cookie?: string;
  /** The address the app's proxy names; null for none. */
  ip?: string | null;
  agent?: string | null;
  origin?: string | null;
  site?: string;
  country?: string;
  contentType?: string | null;
  forwardedFor?: string;
  headers?: Record<string, string>;
};

export function request(path: string, init: RequestInitLike = {}): Request {
  const headers = new Headers({ 'x-forwarded-for': init.forwardedFor ?? '192.0.2.250, 172.64.0.1' });
  if (init.contentType !== null) headers.set('content-type', init.contentType ?? 'application/json');
  if (init.agent !== null) headers.set('user-agent', init.agent ?? SAFARI);
  if (init.ip !== null) headers.set('x-client-ip', init.ip ?? '203.0.113.7');
  if (init.origin !== null) headers.set('origin', init.origin ?? 'https://example.com');
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.site) headers.set('sec-fetch-site', init.site);
  if (init.country) headers.set('x-country', init.country);
  for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value);
  const body = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  return new Request(`https://example.com${path}`, { method: init.method ?? 'POST', headers, body });
}

export const view = (path: string, extra: Record<string, unknown> = {}) => ({ kind: 'view', id: crypto.randomUUID(), path, referrer: null, ...extra });
