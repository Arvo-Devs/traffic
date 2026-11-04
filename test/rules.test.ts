/**
 * The counting rules: where a visit came from, which device, which notes the
 * counter accepts, which paths count, and the address and country a request
 * is filed under. Ported from BetterFans Link's tests/app/traffic-rules.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { normalizeConfig } from '../src/config';
import { countedPathMatcher, isCleanPath, TRAFFIC_MAX_ENGAGED_SECONDS } from '../src/paths';
import { clientAddress, countryCode, requestFacts } from '../src/server/request';
import { browserName, deviceClass, isBotUserAgent, systemName } from '../src/shared/device';
import { parseTrafficNote } from '../src/shared/note';
import { DIRECT_SOURCE, TAGGED_SOURCE, inAppBrowserSource, isTestTag, normalizeLinkName, parseReferrer, sourceForUtm, visitOrigin } from '../src/shared/origin';
import { COUNTED, SITE_HOSTS, fakeConfig } from './fake-app';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
const INSTAGRAM_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.25.92 (iPhone15,3; iOS 17_6; en_US; en; scale=3.00; 1290x2796; 640283071)';

const isCounted = countedPathMatcher(COUNTED);

function origin(overrides: Partial<Parameters<typeof visitOrigin>[0]>) {
  return visitOrigin({ referrer: null, ref: null, utmSource: null, utmCampaign: null, userAgent: IPHONE_SAFARI, siteHosts: SITE_HOSTS, ...overrides });
}

describe('where a visit came from', () => {
  test('a Telegram post with no referrer is filed under where its tagged link was posted', () => {
    const saved = new Map([['launch-video', 'Telegram']]);
    expect(origin({ ref: 'launch-video', savedLinks: saved })).toEqual({ source: 'Telegram', campaign: 'launch-video', referrerHost: null, referrerPath: null });
    // The same click without the tag says nothing about where it came from.
    expect(origin({}).source).toBe(DIRECT_SOURCE);
  });

  test('a tag nobody made still counts as a tag, and a referrer still names the place', () => {
    expect(origin({ ref: 'Spring Promo' })).toEqual({ source: TAGGED_SOURCE, campaign: 'spring-promo', referrerHost: null, referrerPath: null });
    expect(origin({ ref: 'spring-promo', referrer: 'https://t.co/AbC123' }).source).toBe('X');
  });

  test('known referrers are named, unknown ones keep their host, and the query never survives', () => {
    expect(origin({ referrer: 'https://t.co/xyz' }).source).toBe('X');
    expect(origin({ referrer: 'https://www.google.com/' }).source).toBe('Google');
    expect(origin({ referrer: 'https://www.google.co.uk/' }).source).toBe('Google');
    expect(origin({ referrer: 'https://mail.google.com/mail/u/0/' }).source).toBe('Gmail');
    expect(origin({ referrer: 'https://web.telegram.org/k/' }).source).toBe('Telegram');
    expect(origin({ referrer: 'https://chatgpt.com/' }).source).toBe('ChatGPT');
    expect(origin({ referrer: 'https://github.com/someone/agent' }).source).toBe('GitHub');
    expect(origin({ referrer: 'https://news.ycombinator.com/item?id=1' }).source).toBe('Hacker News');
    const reddit = origin({ referrer: 'https://www.reddit.com/r/agency/comments/abc/?share_id=secret' });
    expect(reddit).toEqual({ source: 'Reddit', campaign: null, referrerHost: 'reddit.com', referrerPath: '/r/agency/comments/abc/' });
    expect(origin({ referrer: 'https://blog.example.org/post?q=1' })).toEqual({ source: 'blog.example.org', campaign: null, referrerHost: 'blog.example.org', referrerPath: '/post' });
  });

  test('link-in-bio pages are one source, and utm snap is Snapchat', () => {
    expect(origin({ referrer: 'https://beacons.ai/someone' }).source).toBe('Link in bio');
    expect(origin({ referrer: 'https://allmylinks.com/someone' }).source).toBe('Link in bio');
    expect(origin({ referrer: 'https://allmy.bio/someone' }).source).toBe('Link in bio');
    expect(origin({ referrer: 'https://www.beacons.ai/someone' }).source).toBe('Link in bio');
    expect(origin({ referrer: 'https://linktr.ee/someone' }).source).toBe('Linktree');
    expect(origin({ utmSource: 'snap' }).source).toBe('Snapchat');
    expect(origin({ utmSource: 'Snap' }).source).toBe('Snapchat');
  });

  test("an app's own source names are used first, with their subdomains, and only for that app", () => {
    const sources = { hosts: { 'Partner.Example': 'Partner', 'www.press.example': 'Press' }, utm: { 'PT-News': 'Partner', google: 'Search' } };
    expect(origin({ referrer: 'https://partner.example/deal', sources }).source).toBe('Partner');
    expect(origin({ referrer: 'https://blog.partner.example/x', sources }).source).toBe('Partner');
    expect(origin({ referrer: 'https://www.press.example/', sources }).source).toBe('Press');
    // Not a subdomain, only a longer name.
    expect(origin({ referrer: 'https://notpartner.example/', sources }).source).toBe('notpartner.example');
    expect(origin({ utmSource: 'pt-news', sources }).source).toBe('Partner');
    // An app can rename a place the package knows.
    expect(sourceForUtm('google', sources)).toBe('Search');
    // Another app without them sees the host as it is.
    expect(origin({ referrer: 'https://partner.example/deal' }).source).toBe('partner.example');
    expect(sourceForUtm('google')).toBe('Google');
  });

  test('an Android app referrer names the app', () => {
    expect(origin({ referrer: 'android-app://org.telegram.messenger/' })).toEqual({ source: 'Telegram', campaign: null, referrerHost: 'org.telegram.messenger', referrerPath: null });
    expect(origin({ referrer: 'android-app://com.google.android.gm/' }).source).toBe('Gmail');
    expect(origin({ referrer: 'android-app://com.unknown.app/' }).source).toBe('com.unknown.app');
  });

  test('utm tags are read, and a known utm_source is named', () => {
    expect(origin({ utmSource: 'tg', utmCampaign: 'October drop' })).toEqual({ source: 'Telegram', campaign: 'October drop', referrerHost: null, referrerPath: null });
    expect(origin({ utmSource: 'partner-newsletter' }).source).toBe('partner-newsletter');
    // A Search campaign's final URL suffix: ad clicks are not organic Google.
    expect(origin({ referrer: 'https://www.google.com/', utmSource: 'google-ads', utmCampaign: 'ex-search' })).toEqual({ source: 'Google Ads', campaign: 'ex-search', referrerHost: 'google.com', referrerPath: null });
    // The link maker's own tag wins over utm_campaign as the campaign.
    expect(origin({ ref: 'reel', utmCampaign: 'other' }).campaign).toBe('reel');
  });

  test('a click inside the site is not an arrival', () => {
    expect(origin({ referrer: 'https://example.com/docs' })).toEqual({ source: null, campaign: null, referrerHost: null, referrerPath: null });
    expect(origin({ referrer: 'https://www.example.com/' }).source).toBeNull();
    expect(origin({ referrer: 'https://app.example.com/dashboard' }).source).toBeNull();
    expect(origin({ referrer: 'http://localhost:3000/features' }).source).toBeNull();
    // A tag on an inside link still counts as arriving with that tag.
    expect(origin({ referrer: 'https://example.com/', ref: 'launch-video', savedLinks: new Map([['launch-video', 'Telegram']]) }).source).toBe('Telegram');
  });

  test('an in-app browser names its app when there is no referrer', () => {
    expect(origin({ userAgent: INSTAGRAM_IOS }).source).toBe('Instagram');
    expect(inAppBrowserSource(IPHONE_SAFARI)).toBeNull();
    expect(inAppBrowserSource('Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.104;FBBV/652914316]')).toBe('Facebook');
    // A referrer beats the app's name: Instagram's link shim says where.
    expect(origin({ userAgent: INSTAGRAM_IOS, referrer: 'https://l.instagram.com/' }).source).toBe('Instagram');
  });

  test('unreadable referrers are no referrer', () => {
    expect(parseReferrer('not a url')).toBeNull();
    expect(parseReferrer('javascript:alert(1)')).toBeNull();
    expect(parseReferrer('data:text/html,hi')).toBeNull();
    expect(origin({ referrer: 'not a url' }).source).toBe(DIRECT_SOURCE);
  });

  test('link names come out the way they go into ?ref=', () => {
    expect(normalizeLinkName('Launch Video')).toBe('launch-video');
    expect(normalizeLinkName('  TG__Post #1 ')).toBe('tg-post-1');
    expect(normalizeLinkName('reel.v2')).toBe('reel.v2');
    expect(normalizeLinkName('---')).toBeNull();
    expect(normalizeLinkName('')).toBeNull();
    expect(normalizeLinkName('a'.repeat(80))?.length).toBe(60);
  });

  test("test tags are the app's own prefix", () => {
    expect(isTestTag('ex-test-live-check', 'ex-test')).toBe(true);
    expect(isTestTag('EX-TEST', 'ex-test')).toBe(true);
    expect(isTestTag('launch-video', 'ex-test')).toBe(false);
    expect(isTestTag(null, 'ex-test')).toBe(false);
    // Another app's prefix is just a tag here, and an empty prefix marks nothing.
    expect(isTestTag('other-test-1', 'ex-test')).toBe(false);
    expect(isTestTag('anything', '')).toBe(false);
  });
});

const ID = '3f0c8a52-5d1e-4c6b-9a7e-2b8f4d1c6e90';

describe('the note a page sends', () => {
  test('a view from a public page is read field by field', () => {
    const note = parseTrafficNote(
      {
        kind: 'view', id: ID.toUpperCase(), path: '/docs/quickstart', referrer: 'https://t.co/abc', ref: 'launch-video',
        utm_source: 'tg', utm_campaign: 'oct', width: 390.4, touch: 5, language: 'en-US', extra: 'ignored',
      },
      isCounted,
    );
    expect(note).toEqual({
      kind: 'view', id: ID, path: '/docs/quickstart', referrer: 'https://t.co/abc', ref: 'launch-video',
      utmSource: 'tg', utmMedium: null, utmCampaign: 'oct', utmContent: null, utmTerm: null,
      gclid: null, gbraid: null, wbraid: null,
      width: 390, touchPoints: 5, language: 'en-US',
    });
  });

  test('only the pages the app counts are counted', () => {
    for (const path of ['/', '/features', '/features/approvals', '/docs', '/docs/api/accounts', '/pricing', '/help/billing', '/learn/what-is-an-api', '/privacy', '/sign-up', '/docs/v1.2', '/docs/.hidden-but-not-a-dot-segment']) {
      expect(isCounted(path)).toBe(true);
    }
    for (const path of ['/dashboard', '/dashboard/traffic', '/sign-in', '/new', '/approve/act_1', '/link/tok_secret', '/oauth/authorize', '/invite/abc', '/unsubscribe', '/api/site-note', '/featuresx', '/docs?x=1', '/docs#a', 'docs', '/features/../dashboard x']) {
      expect(isCounted(path)).toBe(false);
    }
    expect(parseTrafficNote({ kind: 'view', id: ID, path: '/link/tok_secret' }, isCounted)).toBeNull();
  });

  test('dot segments, hidden separators and empty segments never count, however they are written', () => {
    for (const path of [
      '/docs/../link/tok_secret', '/docs/./quickstart', '/docs/..', '/docs/.',
      '/docs/%2e%2e/link/x', '/docs/%2E%2E/link/x', '/docs/%2e%2E/link/x', '/docs/.%2e/link/x', '/docs/%2e./link/x', '/docs/%2e',
      '/docs//quickstart', '//docs', '/docs/', '/features//',
      '/docs/x%2f..%2flink', '/docs/x%2F..', '/docs/x%5c..%5clink', '/docs/%5C',
    ]) {
      expect([path, isCounted(path)]).toEqual([path, false]);
      expect(isCleanPath(path)).toBe(false);
    }
    expect(isCleanPath('/')).toBe(true);
    expect(parseTrafficNote({ kind: 'view', id: ID, path: '/docs/%2e%2e/link/tok_secret' }, isCounted)).toBeNull();
  });

  test("an app's own counted check gets no dot or empty segment either", () => {
    // A prefix check like the one BetterFans Link had: /docs/../link/x passes it.
    const config = normalizeConfig(fakeConfig({ counted: (path: string) => path === '/' || path.startsWith('/docs') }));
    expect(config.isCounted('/docs/quickstart')).toBe(true);
    expect(config.isCounted('/docs/../link/tok_secret')).toBe(false);
    expect(config.isCounted('/docs/%2e%2e/link/tok_secret')).toBe(false);
    expect(config.isCounted('/docs//x')).toBe(false);
    expect(config.isCounted('/docs?x=1')).toBe(false);
  });

  test('a leave note carries the seconds the page was seen, capped', () => {
    expect(parseTrafficNote({ kind: 'leave', id: ID, seconds: 42 }, isCounted)).toEqual({ kind: 'leave', id: ID, seconds: 42 });
    expect(parseTrafficNote({ kind: 'leave', id: ID, seconds: 99_999 }, isCounted)).toEqual({ kind: 'leave', id: ID, seconds: TRAFFIC_MAX_ENGAGED_SECONDS });
    expect(parseTrafficNote({ kind: 'leave', id: ID, seconds: -1 }, isCounted)).toBeNull();
    expect(parseTrafficNote({ kind: 'leave', id: ID, seconds: 'ten' }, isCounted)).toBeNull();
  });

  test('anything a page of ours would not send is refused', () => {
    expect(parseTrafficNote(null, isCounted)).toBeNull();
    expect(parseTrafficNote([], isCounted)).toBeNull();
    expect(parseTrafficNote('view', isCounted)).toBeNull();
    expect(parseTrafficNote({ kind: 'view', id: 'not-a-uuid', path: '/' }, isCounted)).toBeNull();
    expect(parseTrafficNote({ kind: 'click', id: ID, path: '/' }, isCounted)).toBeNull();
    expect(parseTrafficNote({ kind: 'view', id: ID, path: `/docs/${'a'.repeat(400)}` }, isCounted)).toBeNull();
  });

  test('long fields are cut, wrong types are dropped', () => {
    const note = parseTrafficNote({ kind: 'view', id: ID, path: '/', referrer: `https://example.org/${'x'.repeat(2000)}`, ref: 42, width: 'wide', touch: 999 }, isCounted);
    expect(note?.kind).toBe('view');
    if (note?.kind !== 'view') return;
    expect(note.referrer?.length).toBe(1000);
    expect(note.ref).toBeNull();
    expect(note.width).toBeNull();
    expect(note.touchPoints).toBeNull();
  });

  test('a NUL character in a tag is dropped: Postgres refuses it in text', () => {
    const note = parseTrafficNote({ kind: 'view', id: ID, path: '/', ref: 'a\u0000b', utm_source: '\u0000', utm_campaign: 'oct\u0000', language: 'en\u0000US' }, isCounted);
    expect(note?.kind).toBe('view');
    if (note?.kind !== 'view') return;
    expect(note.ref).toBe('ab');
    expect(note.utmSource).toBeNull();
    expect(note.utmCampaign).toBe('oct');
    expect(note.language).toBe('enUS');
  });
});

const AGENTS = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  instagram: INSTAGRAM_IOS,
  cubotPhone: 'Mozilla/5.0 (Linux; Android 12; CUBOT P60 Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
};

describe('the device behind a visit', () => {
  test('phone, tablet or computer', () => {
    expect(deviceClass(AGENTS.iphoneSafari)).toBe('phone');
    expect(deviceClass(AGENTS.androidChrome)).toBe('phone');
    expect(deviceClass(AGENTS.androidTablet)).toBe('tablet');
    expect(deviceClass(AGENTS.macChrome)).toBe('computer');
    // An iPad asking for the desktop site looks like a Mac; its touch points give it away.
    expect(deviceClass(AGENTS.ipadDesktopMode, 5)).toBe('tablet');
    expect(deviceClass(AGENTS.ipadDesktopMode, 0)).toBe('computer');
  });

  test('browser family, in-app browsers first', () => {
    expect(browserName(AGENTS.iphoneSafari)).toBe('Safari');
    expect(browserName(AGENTS.androidChrome)).toBe('Chrome');
    expect(browserName(AGENTS.windowsEdge)).toBe('Edge');
    expect(browserName(AGENTS.linuxFirefox)).toBe('Firefox');
    expect(browserName(AGENTS.instagram)).toBe('Instagram app');
    expect(browserName('something else entirely')).toBe('Other');
  });

  test('system', () => {
    expect(systemName(AGENTS.iphoneSafari)).toBe('iOS');
    expect(systemName(AGENTS.androidChrome)).toBe('Android');
    expect(systemName(AGENTS.windowsEdge)).toBe('Windows');
    expect(systemName(AGENTS.macChrome)).toBe('macOS');
    expect(systemName(AGENTS.ipadDesktopMode, 5)).toBe('iOS');
    expect(systemName(AGENTS.linuxFirefox)).toBe('Linux');
  });

  test('crawlers, link previews and scripted browsers are bots; people are not', () => {
    for (const agent of [
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'TelegramBot (like TwitterBot)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Chrome-Lighthouse',
      'curl/8.7.1',
      'python-requests/2.32.3',
      '',
    ]) expect(isBotUserAgent(agent)).toBe(true);
    for (const agent of Object.values(AGENTS)) expect(isBotUserAgent(agent)).toBe(false);
  });
});

describe('the address a request is filed under', () => {
  const config = normalizeConfig(fakeConfig());
  const facts = (headers: Record<string, string>) => requestFacts(new Request('https://example.com/api/site-note', { method: 'POST', headers }), config);

  test("is the one the app's proxy names, never X-Forwarded-For", () => {
    expect(facts({ 'x-client-ip': '198.51.100.4', 'x-forwarded-for': '203.0.113.99' }).ip).toBe('198.51.100.4');
    // Anyone can write X-Forwarded-For; with no address from the proxy there is none.
    expect(facts({ 'x-forwarded-for': '203.0.113.99' }).ip).toBeNull();
    expect(facts({ 'x-client-ip': '2001:db8::7' }).ip).toBe('2001:db8::7');
  });

  test('an IPv4 address written as IPv6 is the IPv4 address', () => {
    expect(clientAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddress('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddress(' ::ffff:198.51.100.4 ')).toBe('198.51.100.4');
    expect(facts({ 'x-client-ip': '::ffff:198.51.100.4' }).ip).toBe('198.51.100.4');
    // Only an IPv4 address loses the prefix.
    expect(clientAddress('::ffff:999.1.1.1')).toBeNull();
    expect(clientAddress('::ffff:cb00:7107')).toBe('::ffff:cb00:7107');
  });

  test('anything that is not an address is no address', () => {
    for (const raw of ['', 'unknown', '203.0.113.7, 10.0.0.1', '203.0.113.7:443', '[2001:db8::1]', 'fe80::1%en0', '999.0.0.1', null, undefined]) {
      expect(clientAddress(raw)).toBeNull();
    }
  });

  test('the user agent is kept, cut at 512', () => {
    expect(facts({ 'user-agent': ` ${'a'.repeat(600)} ` }).userAgent).toHaveLength(512);
    expect(facts({}).userAgent).toBeNull();
  });
});

describe('the country of a visit', () => {
  const country = (value?: string) => requestFacts(new Request('https://example.com/', { headers: value === undefined ? {} : { 'x-country': value } }), normalizeConfig(fakeConfig())).country;

  test("is the one the app's hook names, in upper case", () => {
    expect(country('pt')).toBe('PT');
    expect(country(' GB ')).toBe('GB');
    expect(countryCode('us')).toBe('US');
  });

  test('is unknown without the hook, whatever the request says', () => {
    const config = normalizeConfig(fakeConfig({ country: undefined }));
    expect(requestFacts(new Request('https://example.com/', { headers: { 'x-country': 'PT', 'cf-ipcountry': 'PT' } }), config).country).toBeNull();
  });

  test('unknown, Tor and anything that is not a code are no country', () => {
    for (const code of ['XX', 'xx', 'T1', 'Portugal', 'P', '', '12']) expect(country(code)).toBeNull();
    expect(country()).toBeNull();
  });
});
