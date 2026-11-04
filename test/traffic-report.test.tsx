/**
 * The Traffic page's body renders each of its states without throwing, with
 * the headings and words that state needs: loading, a failed load, a quiet
 * range and a full one. Rendered to a string with react-dom/server, with the
 * summary seeded into react-query's cache under the page's own key.
 */
import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { summaryKey } from '../src/client/api';
import { TrafficReport, TrafficSkeleton } from '../src/client';
import { viewerTimeZone } from '../src/shared/format';
import type { TrafficSummary } from '../src/shared/summary';
import { TrafficError } from '../src/ui/ui-deps';

const BASE = '/api/traffic';
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

function summary(overrides: Partial<TrafficSummary> = {}): TrafficSummary {
  return {
    range: '7d',
    timeZone: 'America/New_York',
    bucket: 'day',
    windowStart: ago(7 * 24 * 60),
    generatedAt: ago(0),
    site: {
      url: 'https://example.com',
      linkPages: [
        { value: '/', label: 'Home' },
        { value: '/pricing', label: 'Pricing' },
      ],
      testTag: 'ex-test',
    },
    totals: { visitors: 1234, views: 4321, signups: 12, joinRate: 1 },
    previous: { visitors: 1000, views: 4000, signups: 10 },
    liveVisitors: 3,
    series: Array.from({ length: 7 }, (_, i) => ({ bucket: `2026-10-${20 + i}T00:00`, visitors: 100 + i * 20, views: 300 + i, signups: i % 3 })),
    sources: [
      { source: 'Google', visitors: 600, signups: 7 },
      { source: 'Direct or unknown', visitors: 400, signups: 3 },
      { source: 'Telegram', visitors: 234, signups: 2 },
    ],
    foundVia: [
      { answer: 'google', label: 'Google', signups: 5 },
      { answer: 'skipped', label: 'Skipped', signups: 2 },
    ],
    links: [
      { name: 'launch-video', platform: 'Telegram', path: '/pricing', saved: true, createdAt: ago(3 * 24 * 60), visitors: 234, signups: 2 },
      { name: 'spring-campaign', platform: 'Email', path: null, saved: false, createdAt: null, visitors: 12, signups: 0 },
    ],
    pages: [
      { path: '/', visitors: 900, views: 2000, avgSeconds: 48 },
      { path: '/pricing', visitors: 300, views: 500, avgSeconds: null },
    ],
    countries: [
      { country: 'US', visitors: 700 },
      { country: null, visitors: 20 },
    ],
    devices: [
      { device: 'computer', visitors: 800 },
      { device: 'phone', visitors: 434 },
    ],
    browsers: [
      { browser: 'Chrome', visitors: 900 },
      { browser: null, visitors: 4 },
    ],
    latestSignups: [
      {
        at: ago(30),
        userId: 'user_1',
        name: 'Dana <script>alert(1)</script>',
        email: 'dana@example.com',
        removed: false,
        source: 'Google',
        campaign: null,
        landingPath: '/pricing',
        firstSeenAt: ago(3 * 24 * 60),
        viewsBefore: 4,
        country: 'US',
        foundVia: 'other',
        foundViaLabel: 'Something else',
        foundViaOther: 'A newsletter',
      },
      {
        at: ago(90),
        userId: 'user_2',
        name: null,
        email: 'gone@example.com',
        removed: true,
        source: null,
        campaign: 'launch-video',
        landingPath: null,
        firstSeenAt: null,
        viewsBefore: null,
        country: null,
        foundVia: null,
        foundViaLabel: null,
        foundViaOther: null,
      },
      {
        at: ago(120),
        userId: 'user_3',
        name: null,
        email: 'only-email@example.com',
        removed: false,
        source: 'Telegram',
        campaign: null,
        landingPath: '/',
        firstSeenAt: ago(125),
        viewsBefore: 1,
        country: 'GB',
        foundVia: 'skipped',
        foundViaLabel: 'Skipped',
        foundViaOther: null,
      },
    ],
    ...overrides,
  };
}

const quietSummary = () =>
  summary({
    totals: { visitors: 0, views: 0, signups: 0, joinRate: null },
    previous: { visitors: 0, views: 0, signups: 0 },
    liveVisitors: 0,
    series: [],
    sources: [],
    foundVia: [],
    links: [],
    pages: [],
    countries: [],
    devices: [],
    browsers: [],
    latestSignups: [],
  });

// Without retryOnMount: false, a query that failed with nothing cached shows as loading again on its next render.
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
const key = () => summaryKey(BASE, '7d', viewerTimeZone());
const render = (qc: QueryClient) =>
  renderToString(
    <QueryClientProvider client={qc}>
      <TrafficReport />
    </QueryClientProvider>,
  ).replaceAll('<!-- -->', '');
const headings = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);

describe('TrafficReport', () => {
  test('loading: the skeleton, announced, and no numbers yet', () => {
    const html = render(client());
    expect(html).toContain('role="status" aria-label="Loading"');
    expect(html).toContain('animate-pulse');
    expect(headings(html)).toEqual([]);
    // The same skeleton the app can show in its own gate, inside the page's Suspense markers.
    expect(html.replace(/<!--\/?\$-->/g, '')).toBe(renderToString(<TrafficSkeleton />));
  });

  test("a failed load: the route's message, hint and request id, with Try again", async () => {
    const qc = client();
    const error = new TrafficError(503, { type: 'internal', code: 'internal_error', message: 'Traffic is not answering right now.', hint: 'Try again in a minute.' }, 'req_abc123');
    await qc.prefetchQuery({ queryKey: key(), queryFn: () => Promise.reject(error) });
    expect(qc.getQueryState(key())?.status).toBe('error');
    const html = render(qc);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Traffic is not answering right now.');
    expect(html).toContain('Try again in a minute.');
    expect(html).toContain('req_abc123');
    expect(html).toContain('Try again');
    expect(headings(html)).toEqual([]);
  });

  test('a quiet range: what to do next, the link maker and how it counts', () => {
    const qc = client();
    qc.setQueryData(key(), quietSummary());
    const html = render(qc);
    expect(html).toContain('No visits in the last 7 days');
    expect(html).toContain('Make a tagged link');
    expect(headings(html)).toEqual(['Tagged links']);
    expect(html).toContain('No tagged links yet');
    expect(html).toContain('How this counts:');
    expect(html).toContain('ex-test');
    expect(html).toContain('180 days');
    expect(html).not.toContain('Latest sign-ups');
  });

  test('a full range: every card, in order', () => {
    const qc = client();
    qc.setQueryData(key(), summary());
    const html = render(qc);
    expect(headings(html)).toEqual([
      'Visitors by day',
      'Where they came from',
      'What sign-ups told us',
      'Pages',
      'Devices',
      'Browsers',
      'Countries',
      'Tagged links',
      'Latest sign-ups',
    ]);
    for (const stat of ['Visitors', 'Page views', 'Sign-ups', 'Join rate']) expect(html).toContain(`>${stat}</p>`);
    expect(html).toContain('1,234');
    expect(html).toContain('3 people on the site now');
    expect(html).toContain('Their answer to &quot;How did you find us?&quot; right after signing up.');
    expect(html).toContain('How this counts:');
    expect(html).not.toMatch(/betterfans/i);
  });

  test("a full range: tagged links and pages open on the site's own address", () => {
    const qc = client();
    qc.setQueryData(key(), summary());
    const html = render(qc);
    expect(html).toContain('https://example.com/pricing?ref=launch-video');
    expect(html).toContain('Arrived as a tag nobody made here');
    expect(html).toContain('aria-label="Remove launch-video"');
    expect(html).not.toContain('aria-label="Remove spring-campaign"');
    expect(html).toContain('href="https://example.com/pricing"');
  });

  test('latest sign-ups: name or email, removed accounts, the first visit, and API text as text', () => {
    const qc = client();
    qc.setQueryData(key(), summary());
    const html = render(qc);
    const table = html.slice(html.indexOf('aria-label="Latest sign-ups"'));
    expect(table).toContain('>First visit</th>');
    expect(table).not.toContain('Pages before');
    expect(table).toContain('Dana &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(table).not.toContain('<script>');
    expect(table).toContain('dana@example.com');
    expect(table).toContain('Account removed');
    expect(table).not.toContain('gone@example.com');
    expect(table).toContain('only-email@example.com');
    expect(table).toContain('3 days ago');
    expect(table).toContain('4 pages');
    expect(table).toContain('1 page');
    expect(table).toContain('Not seen');
    expect(table).toContain('Something else');
    expect(table).toContain('A newsletter');
    expect(table).toContain('Not asked');
    expect(table).toContain('Skipped');
  });

  test('a basePath prop moves the calls, so the page reads under its own key', () => {
    const qc = client();
    qc.setQueryData(summaryKey('/admin/traffic', '7d', viewerTimeZone()), summary());
    const moved = renderToString(
      <QueryClientProvider client={qc}>
        <TrafficReport basePath="/admin/traffic/" />
      </QueryClientProvider>,
    );
    expect(moved).toContain('Latest sign-ups');
    expect(render(qc)).toContain('aria-label="Loading"');
  });
});
