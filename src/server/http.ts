// Answers for the Traffic routes, in the error body BetterFans Link's
// dashboard RPC uses ({ error: { type, code, message, hint?, param? },
// requestId }), so a page that shows those errors shows these the same way.
// Every answer is no-store.
import { randomUUID } from 'node:crypto';
import type { ResolvedTrafficConfig, TrafficSql, TrafficUser } from '../config';
import { fromOwnPage } from './request';

type ErrorType = 'invalid_request' | 'authentication' | 'permission' | 'not_found' | 'conflict' | 'rate_limited' | 'internal';

const STATUS: Record<ErrorType, number> = {
  invalid_request: 400,
  authentication: 401,
  permission: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 503,
};

export const NO_STORE = { 'cache-control': 'no-store' } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function apiError(type: ErrorType, code: string, message: string, extra: { hint?: string; param?: string } = {}): Response {
  const requestId = `req_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  return Response.json({ error: { type, code, message, ...extra }, requestId }, { status: STATUS[type], headers: NO_STORE });
}

export function noContent(status = 204): Response {
  return new Response(null, { status, headers: NO_STORE });
}

/** The app's sign-in or the database could not be reached. */
export function unavailable(): Response {
  return apiError('internal', 'internal_error', 'Traffic is not answering right now.', { hint: 'Try again in a minute.' });
}

export function notFound(): Response {
  return apiError('not_found', 'route_not_found', 'This page does not exist.');
}

/**
 * The person who may see the page and the database, or the answer to send
 * instead. Anyone else gets not found, so the page's address says nothing to
 * them. A write must come from the site's own pages, and a staff member's
 * view-as session never writes: someone else is looking.
 */
export async function viewerContext<User extends TrafficUser>(
  request: Request,
  config: ResolvedTrafficConfig<User>,
  opts: Readonly<{ write?: boolean }> = {},
): Promise<Readonly<{ user: User; sql: TrafficSql }> | Response> {
  if (opts.write && !fromOwnPage(request.headers, config.siteHosts)) {
    return apiError('permission', 'missing_permission', 'This request came from a page we do not trust.');
  }
  let user: User | null;
  try {
    user = await config.signedInUser(request, { fresh: false });
  } catch (error) {
    config.log('[Traffic] could not check the session', error);
    return unavailable();
  }
  if (!user) return apiError('authentication', 'not_signed_in', 'Sign in to see this page.');
  let allowed: boolean;
  try {
    allowed = await config.canView(user);
  } catch (error) {
    config.log('[Traffic] could not check who may see the page', error);
    return unavailable();
  }
  if (!allowed || (opts.write && user.viewedAs)) return notFound();
  try {
    const sql = await config.db();
    if (!sql) {
      return apiError('internal', 'internal_error', 'Traffic has no database yet.', {
        hint: "Give createTraffic a database (db in the config) with the tables from the package's migrations folder.",
      });
    }
    return { user, sql };
  } catch (error) {
    config.log('[Traffic] the database did not answer', error);
    return unavailable();
  }
}
