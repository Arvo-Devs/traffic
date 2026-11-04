// @arvo/traffic on the server. createTraffic(config) reads the app's config
// once and gives back everything the app wires up: the counter's intake, the
// route handlers under basePath, a sign-up call for the app's own account
// code, the clearing of old addresses and a health read. Keep one per
// process (README.md, "One server file"): the limits and the hourly clearing
// count across requests.
//
// Server only: it uses Node's crypto and net. The page, the counter and the
// browser calls are in ./client and ./counter.
import { normalizeConfig, type TrafficConfig, type TrafficUser } from './config';
import { trafficHealth, type TrafficHealth } from './server/health';
import { createIntake } from './server/intake';
import { clearOldVisitorAddresses } from './server/retention';
import { createRouteHandlers, type RouteHandler } from './server/routes';
import { recordSignupOutcome } from './server/signup';

export type Traffic = Readonly<{
  /** The counter's notes: the app's POST /api/site-note. Answers 204 and no body, or an error status. */
  intake: RouteHandler;
  /** GET, POST and DELETE for one catch-all route file at basePath. */
  routeHandlers: Readonly<{ GET: RouteHandler; POST: RouteHandler; DELETE: RouteHandler }>;
  /**
   * Counts a sign-up from the app's own account code: what the browser's
   * noteSignup() does, without its checks of the page it came from. Pass the
   * person's own request (its address and user agent find where they came
   * from). Counts an account under 30 minutes old, once; true when it wrote
   * the row. Never throws: a failure is logged and answers false, so it
   * cannot break the sign-up, and noteSignup() stays the fallback.
   */
  recordSignup: (input: Readonly<{ request: Request; user: TrafficUser }>) => Promise<boolean>;
  /** Clears addresses, user agents, visitor keys and ad click ids older than 180 days. How many rows it cleared; 0 without a database. */
  clearOldVisits: () => Promise<number>;
  /** down when a row past 180 days (plus 2) still holds an address, or there is no database; quiet when no counted view came in 72 hours. */
  health: () => Promise<TrafficHealth>;
}>;

export function createTraffic<User extends TrafficUser = TrafficUser>(input: TrafficConfig<User>): Traffic {
  const config = normalizeConfig(input);
  const routes = createRouteHandlers(config);
  return {
    intake: createIntake(config, (sql) => clearOldVisitorAddresses(sql)),
    routeHandlers: routes,
    recordSignup: async ({ request, user }) => {
      try {
        return (await recordSignupOutcome(config, { request, user })) === 'recorded';
      } catch (error) {
        config.log('[Traffic] a sign-up was not noted', error);
        return false;
      }
    },
    clearOldVisits: async () => {
      const sql = await config.db();
      return sql ? clearOldVisitorAddresses(sql) : 0;
    },
    health: async () => trafficHealth(await config.db()),
  };
}

export type { CountedPages } from './paths';
export type { TrafficAccount, TrafficConfig, TrafficLinkPage, TrafficLog, TrafficSql, TrafficUser } from './config';
export type { TrafficHealth } from './server/health';
export type { TrafficLink, TrafficRange, TrafficSite, TrafficSummary } from './shared/summary';

// Helpers apps use outside Traffic, like the limiter on their own public routes.
export { countedPathMatcher, isCleanPath } from './paths';
export { createPublicLimiter, type PublicLimiter, type PublicLimitRule } from './server/limiter';
export { clientAddress, fromOwnPage, readTextUpTo } from './server/request';
export { isBotUserAgent } from './shared/device';
export { normalizeLinkName } from './shared/origin';
export { safeTimeZone } from './shared/summary';
export {
  DEFAULT_FOUND_VIA_ANSWERS,
  FOUND_VIA_NOTE_MAX_BYTES,
  FOUND_VIA_OTHER,
  FOUND_VIA_OTHER_MAX,
  FOUND_VIA_SKIPPED,
  checkFoundViaAnswers,
  foundViaLabel,
  isFoundViaAnswer,
  parseFoundViaNote,
  type FoundViaChoice,
  type FoundViaNote,
} from './shared/found-via';
