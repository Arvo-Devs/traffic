/**
 * The Traffic routes, mounted under basePath (default /api/traffic) by one
 * catch-all route file in the app:
 *
 *   GET    ''                the page's numbers, for canView
 *   POST   'links'           make a tagged link, for canView, from the site's own pages
 *   DELETE 'links?name='     remove one, the same way
 *   POST   'signup'          count the account just made: signed in, from the site's own pages
 *   POST   'found-via'       keep the answer to "How did you find us?", once per account
 *   GET    'google-ads.csv'  sign-ups from Google ads, for the Google Ads login (HTTP Basic)
 *
 * Anything else is not found. Each answer and status is the one BetterFans
 * Link's route files gave (app/api/traffic/**), so a page or a test written
 * against them reads these the same way. Every answer is no-store.
 */
import type { ResolvedTrafficConfig, TrafficUser } from '../config';
import { FOUND_VIA_NOTE_MAX_BYTES, parseFoundViaNote } from '../shared/found-via';
import { isTrafficLinkPlatform, normalizeLinkName } from '../shared/origin';
import { isTrafficRange, type TrafficLink } from '../shared/summary';
import { recordFoundVia } from './found-via';
import { conversionsCsv, googleAdsSignups, hasImportLogin } from './google-ads';
import { apiError, json, NO_STORE, noContent, notFound, unavailable, viewerContext } from './http';
import { createPublicLimiter } from './limiter';
import { addressOf, fromOwnPage, readTextUpTo, requestFacts } from './request';
import { recordSignupOutcome } from './signup';
import { trafficSummary } from './summary';

const TEN_MINUTES = 10 * 60 * 1000;

export type RouteHandler = (request: Request) => Promise<Response>;
export type TrafficRouteHandlers = Readonly<{ GET: RouteHandler; POST: RouteHandler; DELETE: RouteHandler }>;

/** One set per process (createTraffic makes it once): the limits count across calls. */
export function createRouteHandlers<User extends TrafficUser>(config: ResolvedTrafficConfig<User>): TrafficRouteHandlers {
  const signupLimit = createPublicLimiter({ perSubject: 10, total: 2000, windowMs: TEN_MINUTES });
  const foundViaLimit = createPublicLimiter({ perSubject: 10, total: 2000, windowMs: TEN_MINUTES });
  // Google Ads fetches the file once a day or so; anything near this is someone guessing the password.
  const googleAdsLimit = createPublicLimiter({ perSubject: 20, total: 200, windowMs: TEN_MINUTES });
  let warnedUnchecked = false;

  /** GET ?range=7d&tz=Europe/Lisbon: what the Traffic page shows. */
  async function summary(request: Request): Promise<Response> {
    const ctx = await viewerContext(request, config);
    if (ctx instanceof Response) return ctx;
    const params = new URL(request.url).searchParams;
    const range = params.get('range') ?? '7d';
    if (!isTrafficRange(range)) return apiError('invalid_request', 'invalid_parameter', 'Range must be today, 7d, 30d or 90d.', { param: 'range' });
    try {
      return json(
        await trafficSummary(ctx.sql, {
          range,
          timeZone: params.get('tz'),
          site: { url: config.siteUrl, linkPages: [...config.linkPages], testTag: config.testTag },
          answers: config.foundViaAnswers,
          accounts: config.accounts,
        }),
      );
    } catch (error) {
      config.log('[Traffic] the summary did not load', error);
      return unavailable();
    }
  }

  /**
   * POST { name, platform, path }: a tagged link for one post,
   * <site><path>?ref=<name>, filed under where it was posted even when the
   * click carries no referrer.
   */
  async function makeLink(request: Request): Promise<Response> {
    const ctx = await viewerContext(request, config, { write: true });
    if (ctx instanceof Response) return ctx;
    let body: { name?: unknown; platform?: unknown; path?: unknown };
    try {
      const parsed: unknown = JSON.parse((await readTextUpTo(request, 2048)) ?? '');
      body = parsed && typeof parsed === 'object' ? (parsed as typeof body) : {};
    } catch {
      return apiError('invalid_request', 'invalid_parameter', 'The request body is not valid JSON.');
    }
    const name = typeof body.name === 'string' ? normalizeLinkName(body.name.slice(0, 80)) : null;
    if (!name) return apiError('invalid_request', 'invalid_parameter', 'Use letters, numbers and dashes, like launch-video.', { param: 'name' });
    if (!isTrafficLinkPlatform(body.platform)) return apiError('invalid_request', 'invalid_parameter', 'Choose where you will post it.', { param: 'platform' });
    const path = typeof body.path === 'string' ? body.path : '/';
    const badPath = () => apiError('invalid_request', 'invalid_parameter', 'Choose a page of the public site.', { param: 'path' });
    if (!config.isCounted(path)) return badPath();
    try {
      if (config.isPage && !(await config.isPage(path))) return badPath();
      const [created] = await ctx.sql<{ name: string; platform: string; path: string; created_at: Date }[]>`
        insert into traffic_links (name, platform, path, created_by) values (${name}, ${body.platform}, ${path}, ${ctx.user.email})
        on conflict (name) do nothing
        returning name, platform, path, created_at
      `;
      if (!created) return apiError('conflict', 'link_exists', `There is already a link called ${name}. Pick another name.`, { param: 'name' });
      const link: TrafficLink = {
        name: created.name,
        platform: created.platform,
        path: created.path,
        saved: true,
        createdAt: new Date(created.created_at).toISOString(),
        visitors: 0,
        signups: 0,
      };
      return json(link, 201);
    } catch (error) {
      config.log('[Traffic] a link was not made', error);
      return unavailable();
    }
  }

  /** DELETE ?name=<name>: removes the link from the list. Visits it already brought keep their tag. */
  async function removeLink(request: Request): Promise<Response> {
    const ctx = await viewerContext(request, config, { write: true });
    if (ctx instanceof Response) return ctx;
    const name = new URL(request.url).searchParams.get('name') ?? '';
    try {
      const removed = await ctx.sql`delete from traffic_links where name = ${name.slice(0, 80)} returning name`;
      return removed.length ? noContent() : apiError('not_found', 'resource_not_found', 'That link is already gone.');
    } catch (error) {
      config.log('[Traffic] a link was not removed', error);
      return unavailable();
    }
  }

  /**
   * POST: the app's sign-up form calls this right after it makes an account
   * (noteSignup), as does any other form that can make one. The app's sign-in
   * says who it is and how new the account is; the sign-up is then counted
   * once, under where that browser first came from. It grants nothing and the
   * form never waits for it.
   */
  async function signup(request: Request): Promise<Response> {
    if (!fromOwnPage(request.headers, config.siteHosts)) return noContent(403);
    const facts = requestFacts(request, config);
    if (!signupLimit(facts.ip ?? 'unknown')) return noContent(429);
    try {
      const user = await config.signedInUser(request, { fresh: true });
      if (!user) return noContent(401);
      const outcome = await recordSignupOutcome(config, { request, user, facts });
      return outcome === 'no-database' ? noContent(503) : noContent();
    } catch (error) {
      config.log('[Traffic] a sign-up was not noted', error);
      return noContent(503);
    }
  }

  /**
   * POST { answer, other? }: the first screen a new account sees sends the
   * answer to "How did you find us?", or that it was left blank. The app's
   * sign-in says whose answer it is; it is kept once per account, beside
   * where Traffic saw that person first come from. It grants nothing and the
   * screen never waits for it.
   */
  async function foundVia(request: Request): Promise<Response> {
    if (!fromOwnPage(request.headers, config.siteHosts)) return noContent(403);
    if (!foundViaLimit(addressOf(request, config) ?? 'unknown')) return noContent(429);
    const text = await readTextUpTo(request, FOUND_VIA_NOTE_MAX_BYTES);
    if (text === null) return noContent(413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return noContent(400);
    }
    const note = parseFoundViaNote(raw, config.foundViaAnswers);
    if (!note) return noContent(400);
    try {
      const user = await config.signedInUser(request, { fresh: false });
      if (!user) return noContent(401);
      // A staff member viewing as someone is not that person, and the view is read only.
      if (user.viewedAs) return noContent(403);
      const sql = await config.db();
      if (!sql) return noContent(503);
      await recordFoundVia(sql, { userId: user.id, note });
      return noContent();
    } catch (error) {
      config.log('[Traffic] an answer to "How did you find us?" was not kept', error);
      return noContent(503);
    }
  }

  /**
   * GET: sign-ups from Google ads in the last 90 days, as the file of
   * conversions from clicks that Google Ads' scheduled upload reads. Only the
   * configured login opens it, sent as HTTP Basic credentials. Without that
   * login the route does not exist.
   */
  async function googleAdsFile(request: Request): Promise<Response> {
    const login = config.googleAds;
    if (!login) return noContent(404);
    if (!googleAdsLimit(addressOf(request, config) ?? 'unknown')) return noContent(429);
    if (!hasImportLogin(request.headers, login)) {
      return new Response(null, { status: 401, headers: { ...NO_STORE, 'www-authenticate': `Basic realm="${login.realm}", charset="UTF-8"` } });
    }
    try {
      const sql = await config.db();
      if (!sql) return noContent(503);
      const conversions = await googleAdsSignups(sql, {
        staff: config.staffEmails(),
        accounts: config.accounts,
        onUnchecked: () => {
          if (warnedUnchecked) return;
          warnedUnchecked = true;
          config.log("[Traffic] the Google Ads file could not check for the team's own accounts (accounts answered null), so it lists their sign-ups too");
        },
      });
      return new Response(conversionsCsv(conversions, login.conversionName), {
        headers: {
          ...NO_STORE,
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'inline; filename="google-ads.csv"',
          'x-robots-tag': 'noindex',
        },
      });
    } catch (error) {
      config.log('[Traffic] the Google Ads sign-ups were not read', error);
      return noContent(503);
    }
  }

  /** The route under basePath, without slashes at either end: '' is the summary. Null outside basePath. */
  function routeOf(request: Request): string | null {
    const { pathname } = new URL(request.url);
    const base = config.basePath;
    if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return null;
    return pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
  }

  function handler(routes: Readonly<Record<string, RouteHandler>>): RouteHandler {
    return async (request: Request) => {
      try {
        const route = routeOf(request);
        const handle = route === null ? undefined : Object.hasOwn(routes, route) ? routes[route] : undefined;
        return handle ? await handle(request) : notFound();
      } catch (error) {
        // An app hook threw where nothing else caught it: still a plain answer, never a crash.
        config.log('[Traffic] a request was not answered', error);
        return unavailable();
      }
    };
  }

  return {
    GET: handler({ '': summary, 'google-ads.csv': googleAdsFile }),
    POST: handler({ links: makeLink, signup, 'found-via': foundVia }),
    DELETE: handler({ links: removeLink }),
  };
}
