// What kind of browser a visit came from, read from its user agent. Pure.
// Coarse on purpose: the Traffic page shows phone, tablet or computer, the
// browser family and the system, never the full user agent. Taken from
// BetterFans Link's copy.

export type DeviceClass = 'phone' | 'tablet' | 'computer';

/**
 * Phone, tablet or computer. An iPad in desktop mode reports itself as a Mac,
 * so a "Macintosh" with touch points is a tablet (the page sends
 * navigator.maxTouchPoints for this).
 */
export function deviceClass(userAgent: string, touchPoints: number | null = null): DeviceClass {
  if (/iPad|Tablet|PlayBook|Silk\/|Kindle|SM-T\d|Lenovo TB|Nexus (7|9|10)\b/i.test(userAgent)) return 'tablet';
  if (/Macintosh/i.test(userAgent) && (touchPoints ?? 0) > 1) return 'tablet';
  if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(userAgent)) return 'phone';
  return 'computer';
}

// In-app browsers first: they carry Chrome or Safari tokens too.
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Instagram/i, 'Instagram app'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/, 'Facebook app'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok app'],
  [/Snapchat/i, 'Snapchat app'],
  [/Telegram/i, 'Telegram app'],
  [/LinkedInApp/i, 'LinkedIn app'],
  [/Twitter for|TwitterAndroid/i, 'X app'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|OPT\/|Opera/, 'Opera'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/YaBrowser/, 'Yandex Browser'],
  [/Firefox\/|FxiOS/, 'Firefox'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

export function browserName(userAgent: string): string {
  for (const [pattern, name] of BROWSERS) if (pattern.test(userAgent)) return name;
  return 'Other';
}

export function systemName(userAgent: string, touchPoints: number | null = null): string {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/CrOS/.test(userAgent)) return 'ChromeOS';
  if (/Macintosh|Mac OS X/.test(userAgent)) return (touchPoints ?? 0) > 1 ? 'iOS' : 'macOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'Other';
}

// Crawlers, link-preview fetchers, monitors and scripted browsers. Most never
// run the page's code, so they never send a note; the ones that render pages
// (Googlebot, Bingbot, Lighthouse, headless Chrome) say so in their agent.
const BOT = new RegExp(
  [
    'bot[\\s/;)_-]', 'bot$', 'crawl', 'spider', 'slurp', 'facebookexternalhit', 'facebookcatalog', 'embedly',
    'quora link preview', 'whatsapp/', 'skypeuripreview', 'bingpreview', 'web preview', 'headlesschrome',
    'lighthouse', 'pagespeed', 'gtmetrix', 'google-inspectiontool', 'chatgpt-user', 'claude-user',
    'perplexity-user', 'anthropic-ai', 'python-requests', 'python-urllib', 'curl/', 'wget/', 'axios/',
    'node-fetch', 'undici', 'go-http-client', 'java/', 'okhttp', 'scrapy', 'phantomjs', 'puppeteer', 'playwright',
    'baiduspider', 'semrush', 'ahrefs', 'dataforseo', 'screaming frog', 'feedfetcher',
    'uptimerobot', 'statuscake', 'pingdom',
  ].join('|'),
  'i',
);

// Phones whose brand ends in "bot" and would otherwise look like crawlers.
const BOT_LOOKALIKE = /\bcubot\b/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 12) return true;
  return BOT.test(userAgent.replace(BOT_LOOKALIKE, ''));
}
