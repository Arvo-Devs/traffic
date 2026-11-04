// The contract between the package and the app that installs it. Everything
// that differs from app to app comes in through here: the database, who is
// signed in and who may see the page, which pages count, the site's own hosts,
// and where the visitor's address and country come from.
//
// normalizeConfig reads it once, in createTraffic. It imports nothing that
// needs Node, so a page that imports a type from here stays a browser bundle.
import type postgres from 'postgres';
import { countedPathMatcher, isCleanPath, type CountedPages } from './paths';
import { checkFoundViaAnswers, DEFAULT_FOUND_VIA_ANSWERS, type FoundViaChoice } from './shared/found-via';
import type { ExtraSources } from './shared/origin';

/**
 * A postgres.js client for the app's database, with Traffic's tables
 * (migrations/). Give it one nothing wraps with drizzle: drizzle(sql) changes
 * how a shared client reads dates and JSON.
 */
export type TrafficSql = postgres.Sql;

/** The person signed in, as the app's auth knows them on this request. */
export type TrafficUser = Readonly<{
  id: string;
  email: string;
  name?: string | null;
  /** When the account was made (ISO 8601). A sign-up counts only for an account under 30 minutes old. */
  createdAt?: string | null;
  /** True in a staff member's view-as session: someone else is looking, so Traffic writes nothing for it. */
  viewedAs?: boolean;
}>;

/** An account as the app knows it now, for the sign-ups list. Leave a deleted account out and the page shows it as removed. */
export type TrafficAccount = Readonly<{ id: string; name: string | null; email: string | null }>;

/** A page the link maker offers: the path a tagged link opens and its name on the page. */
export type TrafficLinkPage = Readonly<{ value: string; label: string }>;

export type TrafficLog = (line: string, error?: unknown) => void;

export type TrafficConfig<User extends TrafficUser = TrafficUser> = Readonly<{
  /** The database, or null when it is not set up (the routes answer 503). A function, so nothing connects at build time. */
  db: () => Promise<TrafficSql | null> | TrafficSql | null;
  /** Who is signed in, asked on every call that needs it. `fresh` skips any cache: the sign-up check needs the newest answer. */
  signedInUser: (request: Request, options: Readonly<{ fresh: boolean }>) => Promise<User | null>;
  /** True for the people who may open the Traffic page (Mass Access). Everyone else gets not found. */
  canView: (user: User) => boolean | Promise<boolean>;
  /** True when the request carries the app's session cookie. Answered without a network call: a signed-in browser's views are not stored. */
  hasSessionCookie: (request: Request) => boolean;
  /** The public pages that count, the same object the counter gets. A function works too; dot and empty segments are refused before it is asked. */
  counted: CountedPages | ((path: string) => boolean);
  /** Optional: true when a counted path is a page that exists, so a mistyped address under a counted section is not stored. */
  isPage?: (path: string) => boolean | Promise<boolean>;
  /** The site's own hosts. A referrer on one is a click inside the site, and only pages on them may send notes. */
  siteHosts: readonly string[];
  /** The public address tagged links open, like https://example.com. */
  siteUrl: string;
  /** The pages the link maker offers. Default: the home page only. */
  linkPages?: readonly TrafficLinkPage[];
  /**
   * The visitor's address, from a header the app's own proxy sets and a
   * caller cannot: never the first X-Forwarded-For entry. Null when unknown.
   */
  clientIp: (request: Request) => string | null;
  /** The visitor's country as an ISO 3166 code, from a header the app's own proxy sets. Default: unknown. */
  country?: (request: Request) => string | null;
  /** Tags starting with this (BetterFans Link's is bfl-test) are checks of the counter: stored, never counted. */
  testTag: string;
  /**
   * Names and emails as they are now, for the sign-ups list and to leave the
   * team out of the Google Ads file. Resolve to null when accounts cannot be
   * looked up right now: the list then shows no names and nobody as removed,
   * and the Google Ads file leaves out only test sign-ups.
   */
  accounts?: (ids: readonly string[]) => Promise<readonly TrafficAccount[] | null>;
  /** Emails of the team's own accounts, left out of the Google Ads file. Needs `accounts`, which says whose account each sign-up is. */
  staffEmails?: () => readonly string[];
  /** The Google Ads file of sign-ups: off unless both are set and the password has 20 characters or more. */
  googleAds?: Readonly<{ user?: string | null; password?: string | null; conversionName?: string; realm?: string }>;
  /** The answers to "How did you find us?". Default: DEFAULT_FOUND_VIA_ANSWERS. Give the field the same list. */
  foundViaAnswers?: readonly FoundViaChoice[];
  /** More source names: referrer hosts and utm_source values this app wants named, like { hosts: { 'partner.example': 'Partner' } }. */
  sources?: ExtraSources;
  /** The path a sign-up row is filed under. Default /sign-up. */
  signupPath?: string;
  /** Where routeHandlers are mounted. Default /api/traffic. */
  basePath?: string;
  /** Where errors are written. Default console.error. */
  log?: TrafficLog;
}>;

/** Below this the password is too easy to guess, and the Google Ads file stays off. */
export const GOOGLE_ADS_PASSWORD_MIN = 20;
/** The conversion action in Google Ads. The name must match it exactly. */
export const GOOGLE_ADS_CONVERSION_NAME = 'Sign-up';

export type GoogleAdsLogin = Readonly<{ user: string; password: string }>;

/**
 * The login Google Ads is given for its scheduled upload, or null when the
 * file is off: both are needed, the user name has no colon (a colon ends the
 * user name in HTTP Basic, so one inside it could never match) and the
 * password has 20 characters or more.
 */
export function googleAdsLogin(input: TrafficConfig['googleAds'] | null | undefined): GoogleAdsLogin | null {
  const user = input?.user?.trim() ?? '';
  const password = input?.password ?? '';
  if (!user || user.includes(':') || password.length < GOOGLE_ADS_PASSWORD_MIN) return null;
  return { user, password };
}

/** The config as the routes use it: defaults filled in, hosts in lower case, every hook asked the same way. */
export type ResolvedTrafficConfig<User extends TrafficUser = TrafficUser> = Readonly<{
  db: () => Promise<TrafficSql | null>;
  signedInUser: (request: Request, options: Readonly<{ fresh: boolean }>) => Promise<User | null>;
  canView: (user: User) => Promise<boolean>;
  hasSessionCookie: (request: Request) => boolean;
  /** The counted check, with dot and empty segments refused whatever the app gave. */
  isCounted: (path: string) => boolean;
  isPage: ((path: string) => Promise<boolean>) | null;
  siteHosts: readonly string[];
  /** With no slash at the end. */
  siteUrl: string;
  linkPages: readonly TrafficLinkPage[];
  /** As the app gave it: the routes check what it answers (src/server/request.ts). */
  clientIp: (request: Request) => string | null;
  country: (request: Request) => string | null;
  testTag: string;
  accounts: ((ids: readonly string[]) => Promise<readonly TrafficAccount[] | null>) | null;
  /** In lower case. */
  staffEmails: () => ReadonlySet<string>;
  googleAds: (GoogleAdsLogin & Readonly<{ conversionName: string; realm: string }>) | null;
  foundViaAnswers: readonly FoundViaChoice[];
  sources: ExtraSources;
  signupPath: string;
  /** With no slash at the end; empty when mounted at the root. */
  basePath: string;
  log: TrafficLog;
}>;

const defaultLog: TrafficLog = (line, error) => {
  if (error === undefined) console.error(line);
  else console.error(line, error);
};

function namesTable(table: Readonly<Record<string, string>> | undefined, key: (raw: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [raw, name] of Object.entries(table ?? {})) {
    const k = key(raw);
    if (k && typeof name === 'string' && name.trim()) out[k] = name.trim();
  }
  return out;
}

/**
 * Reads the app's config once. Throws on a config that could never work (no
 * hosts, a site address that is not one, a bad answer list), so a
 * misconfigured app fails at its first request instead of losing visits.
 */
export function normalizeConfig<User extends TrafficUser>(config: TrafficConfig<User>): ResolvedTrafficConfig<User> {
  const log = config.log ?? defaultLog;

  const siteHosts = [...new Set(config.siteHosts.map((host) => host.trim().toLowerCase()).filter(Boolean))];
  if (!siteHosts.length) throw new Error('@arvo/traffic: siteHosts needs the site\'s own hosts, like ["example.com"].');

  const siteUrl = config.siteUrl.trim().replace(/\/+$/, '');
  let siteHost: string;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(url.protocol);
    siteHost = url.hostname;
  } catch {
    throw new Error(`@arvo/traffic: siteUrl "${config.siteUrl}" is not the address of a site, like https://example.com.`);
  }

  const signupPath = config.signupPath ?? '/sign-up';
  if (!isCleanPath(signupPath)) throw new Error(`@arvo/traffic: signupPath "${signupPath}" is not a page path, like /sign-up.`);

  const counted = config.counted;
  const isCounted = typeof counted === 'function' ? (path: string) => isCleanPath(path) && counted(path) : countedPathMatcher(counted);
  const isPage = config.isPage;

  const login = googleAdsLogin(config.googleAds);
  if (!login && (config.googleAds?.user || config.googleAds?.password)) {
    log('[Traffic] the Google Ads file is off: give googleAds a user name with no colon and a password of 20 or more characters');
  }
  const staffEmails = config.staffEmails;
  if (login && staffEmails && !config.accounts) {
    log('[Traffic] staffEmails needs accounts to tell whose sign-up is whose: the Google Ads file lists the team\'s own sign-ups too');
  }

  const basePath = `/${(config.basePath ?? '/api/traffic').trim().replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '');

  return {
    db: async () => (await config.db()) ?? null,
    signedInUser: config.signedInUser,
    canView: async (user) => Boolean(await config.canView(user)),
    hasSessionCookie: config.hasSessionCookie,
    isCounted,
    isPage: isPage ? async (path) => Boolean(await isPage(path)) : null,
    siteHosts,
    siteUrl,
    linkPages: (config.linkPages ?? [{ value: '/', label: 'Home' }]).map((page) => ({ value: page.value, label: page.label })),
    clientIp: config.clientIp,
    country: config.country ?? (() => null),
    testTag: config.testTag.trim(),
    accounts: config.accounts ?? null,
    staffEmails: () => new Set((staffEmails?.() ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean)),
    googleAds: login && {
      ...login,
      conversionName: config.googleAds?.conversionName?.trim() || GOOGLE_ADS_CONVERSION_NAME,
      // The realm is a quoted string in WWW-Authenticate.
      realm: (config.googleAds?.realm ?? siteHost).replace(/["\\\r\n]/g, '').trim() || siteHost,
    },
    foundViaAnswers: checkFoundViaAnswers(config.foundViaAnswers ?? DEFAULT_FOUND_VIA_ANSWERS),
    sources: {
      hosts: namesTable(config.sources?.hosts, (raw) => raw.trim().toLowerCase().replace(/^www\./, '')),
      utm: namesTable(config.sources?.utm, (raw) => raw.trim().toLowerCase()),
    },
    signupPath,
    basePath,
    log,
  };
}
