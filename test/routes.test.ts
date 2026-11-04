/**
 * The routes without a database: which route answers what, the gate on the
 * page, the limits counted by the app's own address, and that every answer
 * is no-store. The same routes against a real database are in
 * traffic.pg.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { createTraffic } from '../src/index';
import { cookieFor, fakeConfig, request, view } from './fake-app';

const PASSWORD = 'k3Vq9xT2mP7wR4zL8nB5cY1d';

async function errorOf(response: Response) {
  const body = (await response.json()) as { error: { type: string; code: string; message: string; hint?: string; param?: string }; requestId: string };
  expect(body.requestId).toMatch(/^req_[0-9a-f]{24}$/);
  return body.error;
}

describe('the route handlers', () => {
  const traffic = createTraffic(fakeConfig());
  const { GET, POST, DELETE } = traffic.routeHandlers;

  test('the page needs someone signed in who may see it, then the database', async () => {
    const signedOut = await GET(request('/api/traffic?range=7d', { method: 'GET' }));
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get('cache-control')).toBe('no-store');
    expect(await errorOf(signedOut)).toEqual({ type: 'authentication', code: 'not_signed_in', message: 'Sign in to see this page.' });

    const other = await GET(request('/api/traffic', { method: 'GET', cookie: cookieFor('owner') }));
    expect(other.status).toBe(404);
    expect(await errorOf(other)).toMatchObject({ type: 'not_found', code: 'route_not_found' });

    const broken = await GET(request('/api/traffic', { method: 'GET', cookie: cookieFor('broken') }));
    expect(broken.status).toBe(503);
    expect(await errorOf(broken)).toMatchObject({ type: 'internal', message: 'Traffic is not answering right now.' });

    const noDatabase = await GET(request('/api/traffic', { method: 'GET', cookie: cookieFor('admin') }));
    expect(noDatabase.status).toBe(503);
    expect(await errorOf(noDatabase)).toMatchObject({ type: 'internal', message: 'Traffic has no database yet.' });
  });

  test('anything that is not one of the routes is not found', async () => {
    const admin = cookieFor('admin');
    for (const response of [
      await GET(request('/api/traffic/nope', { method: 'GET', cookie: admin })),
      await GET(request('/api/traffic/links', { method: 'GET', cookie: admin })),
      await GET(request('/api/traffic/signup', { method: 'GET', cookie: admin })),
      await GET(request('/api/trafficx', { method: 'GET', cookie: admin })),
      await GET(request('/elsewhere', { method: 'GET', cookie: admin })),
      await POST(request('/api/traffic', { cookie: admin, body: {} })),
      await POST(request('/api/traffic/google-ads.csv', { cookie: admin })),
      await POST(request('/api/traffic/constructor', { cookie: admin })),
      await DELETE(request('/api/traffic', { method: 'DELETE', cookie: admin })),
      await DELETE(request('/api/traffic/signup', { method: 'DELETE', cookie: admin })),
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await errorOf(response)).toMatchObject({ type: 'not_found', code: 'route_not_found' });
    }
  });

  test('a route answers with or without a slash at the end, under the basePath the app gave', async () => {
    const mounted = createTraffic(fakeConfig({ basePath: '/admin/stats/' })).routeHandlers;
    expect((await mounted.GET(request('/admin/stats', { method: 'GET' }))).status).toBe(401);
    expect((await mounted.GET(request('/admin/stats/', { method: 'GET' }))).status).toBe(401);
    expect((await mounted.GET(request('/api/traffic', { method: 'GET' }))).status).toBe(404);
    expect((await GET(request('/api/traffic/', { method: 'GET' }))).status).toBe(401);
  });

  test('without the Google Ads login the file does not exist', async () => {
    const response = await GET(request('/api/traffic/google-ads.csv', { method: 'GET' }));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  test('with it, a wrong login is asked for its password in the realm', async () => {
    const withAds = createTraffic(fakeConfig({ googleAds: { user: 'google-ads', password: PASSWORD, realm: 'Example' } })).routeHandlers;
    const denied = await withAds.GET(request('/api/traffic/google-ads.csv', { method: 'GET' }));
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toBe('Basic realm="Example", charset="UTF-8"');
    expect(denied.headers.get('cache-control')).toBe('no-store');
    const right = await withAds.GET(
      request('/api/traffic/google-ads.csv', { method: 'GET', headers: { authorization: `Basic ${Buffer.from(`google-ads:${PASSWORD}`).toString('base64')}` } }),
    );
    // Right login, no database.
    expect(right.status).toBe(503);
  });

  test('links are written only from the site\'s own pages, by someone who may see the page', async () => {
    const admin = cookieFor('admin');
    const evil = await POST(request('/api/traffic/links', { cookie: admin, origin: 'https://evil.example', body: { name: 'x', platform: 'X' } }));
    expect(evil.status).toBe(403);
    expect(await errorOf(evil)).toMatchObject({ type: 'permission', code: 'missing_permission' });
    expect((await POST(request('/api/traffic/links', { body: { name: 'x', platform: 'X' } }))).status).toBe(401);
    expect((await POST(request('/api/traffic/links', { cookie: cookieFor('owner'), body: { name: 'x', platform: 'X' } }))).status).toBe(404);
    expect((await DELETE(request('/api/traffic/links?name=x', { method: 'DELETE', cookie: admin, origin: 'https://evil.example' }))).status).toBe(403);
  });

  test("a view-as session reads what the app lets it, and never writes", async () => {
    // An app whose page lets a view-as session in to read.
    const lenient = createTraffic(fakeConfig({ canView: () => true })).routeHandlers;
    expect((await lenient.GET(request('/api/traffic', { method: 'GET', cookie: cookieFor('viewedas') }))).status).toBe(503);
    expect((await lenient.POST(request('/api/traffic/links', { cookie: cookieFor('viewedas'), body: { name: 'x', platform: 'X' } }))).status).toBe(404);
    expect((await lenient.DELETE(request('/api/traffic/links?name=x', { method: 'DELETE', cookie: cookieFor('viewedas') }))).status).toBe(404);
  });

  test('sign-ups and answers are refused from another site, and answered 503 without a database', async () => {
    expect((await POST(request('/api/traffic/signup', { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(request('/api/traffic/signup', {}))).status).toBe(401);
    expect((await POST(request('/api/traffic/found-via', { origin: 'https://evil.example', body: { answer: 'friend' } }))).status).toBe(403);
    expect((await POST(request('/api/traffic/found-via', { cookie: cookieFor('owner'), body: { answer: 'friend' } }))).status).toBe(503);
    for (const response of [await POST(request('/api/traffic/signup', {})), await POST(request('/api/traffic/found-via', { body: { answer: 'friend' } }))]) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
    }
  });

  test('an app hook that throws is a 503, never a crash', async () => {
    const throwing = createTraffic(fakeConfig({ clientIp: () => { throw new Error('no proxy header'); } }));
    expect((await throwing.routeHandlers.POST(request('/api/traffic/signup', {}))).status).toBe(503);
    expect((await throwing.intake(request('/api/site-note', { body: view('/') }))).status).toBe(503);
  });
});

describe('the limits count by the address the app names', () => {
  test('the intake: 240 notes per address in ten minutes, whatever X-Forwarded-For says', async () => {
    const traffic = createTraffic(fakeConfig());
    const statuses: number[] = [];
    for (let i = 0; i < 241; i += 1) {
      statuses.push((await traffic.intake(request('/api/site-note', { body: '{}', ip: '198.51.100.30', forwardedFor: `203.0.113.${i % 250}` }))).status);
    }
    // Not a note, so 400, until the limit.
    expect(statuses.slice(0, 240).every((status) => status === 400)).toBe(true);
    expect(statuses[240]).toBe(429);
    // An IPv4 address written as IPv6 is the same address.
    expect((await traffic.intake(request('/api/site-note', { body: '{}', ip: '::ffff:198.51.100.30' }))).status).toBe(429);
    expect((await traffic.intake(request('/api/site-note', { body: '{}', ip: '198.51.100.31' }))).status).toBe(400);
  });

  test('the sign-up route: 10 per address in ten minutes', async () => {
    const traffic = createTraffic(fakeConfig());
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await traffic.routeHandlers.POST(request('/api/traffic/signup', { ip: '198.51.100.40', forwardedFor: `203.0.113.${i}` }))).status);
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await traffic.routeHandlers.POST(request('/api/traffic/signup', { ip: '198.51.100.41' }))).status).toBe(401);
  });
});

describe('the intake without a database', () => {
  const traffic = createTraffic(fakeConfig());

  test('a note from the site is read as text whatever its content type, and answered 503', async () => {
    for (const contentType of ['text/plain;charset=UTF-8', 'application/json', null]) {
      const response = await traffic.intake(request('/api/site-note', { body: view('/'), contentType }));
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('a page that is not counted, or not a page, is refused before the database', async () => {
    expect((await traffic.intake(request('/api/site-note', { body: view('/docs/../link/tok_secret') }))).status).toBe(400);
    expect((await traffic.intake(request('/api/site-note', { body: view('/docs/%2E%2e/link/tok_secret') }))).status).toBe(400);
    const asked: string[] = [];
    const checked = createTraffic(
      fakeConfig({
        isPage: (path) => {
          asked.push(path);
          return path !== '/docs/missing';
        },
      }),
    );
    expect((await checked.intake(request('/api/site-note', { body: view('/docs/missing') }))).status).toBe(400);
    expect((await checked.intake(request('/api/site-note', { body: view('/dashboard') }))).status).toBe(400);
    // The page check only ever sees a path the app counts.
    expect(asked).toEqual(['/docs/missing']);
  });
});
