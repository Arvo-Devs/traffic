// Where a visit to the site came from, in the words the Traffic page shows.
// Pure, so the intake, the sign-up and the tests share it. Taken from
// BetterFans Link's copy. An app adds its own names (config.sources), merged
// in at lookup time, so one app's sources never show on another's page.
//
// Three signals, strongest first:
//   a tagged link    ?ref=<name> made with the page's link maker (it knows
//                    where the link was posted), or utm_source/utm_campaign
//   the referrer     the page the visitor clicked from, named when we know it
//   the app          an in-app browser (Instagram, TikTok…) names itself in
//                    its user agent even when it sends no referrer
// Apps such as Telegram, WhatsApp and Discord usually open a link with no
// referrer at all, so without a tag those visits are "Direct or unknown".

export const DIRECT_SOURCE = 'Direct or unknown';
/** A ?ref= tag nobody made in the link maker, on a visit with no other clue. */
export const TAGGED_SOURCE = 'Tagged link';

/** Where a tagged link can be posted, as the link maker offers it. The name is the source its visits are filed under. */
export const TRAFFIC_LINK_PLATFORMS = [
  'X',
  'Reddit',
  'Telegram',
  'Discord',
  'LinkedIn',
  'GitHub',
  'Hacker News',
  'Product Hunt',
  'YouTube',
  'Instagram',
  'TikTok',
  'WhatsApp',
  'Email',
  'Other',
] as const;
export type TrafficLinkPlatform = (typeof TRAFFIC_LINK_PLATFORMS)[number];

export function isTrafficLinkPlatform(value: unknown): value is TrafficLinkPlatform {
  return typeof value === 'string' && (TRAFFIC_LINK_PLATFORMS as readonly string[]).includes(value);
}

/**
 * True for a tag starting with the app's test prefix (BetterFans Link's is
 * bfl-test): a check of the counter itself, like a test visit after a deploy.
 * Those visits are stored, so the check can be seen, and never counted.
 */
export function isTestTag(campaign: string | null | undefined, prefix: string): boolean {
  return Boolean(prefix && campaign && campaign.toLowerCase().startsWith(prefix.toLowerCase()));
}

const LINK_NAME = /^[a-z0-9][a-z0-9._-]{0,59}$/;

/**
 * A link name as it goes into ?ref=: lower case, spaces and underscores to
 * dashes, nothing but letters, digits, dots and dashes, at most 60 long.
 * Null when nothing usable is left.
 */
export function normalizeLinkName(input: string): string | null {
  const name = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 60)
    .replace(/[-.]+$/, '');
  return LINK_NAME.test(name) ? name : null;
}

// Hosts we know by name, matched on the referrer's host without "www.".
// A more specific host comes before the family it belongs to.
const HOST_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(gemini|bard)\.google\.com$/, 'Gemini'],
  [/^mail\.google\.com$/, 'Gmail'],
  [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, 'Google'],
  [/^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com|mobile\.x\.com)$/, 'X'],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me|telegram\.dog)$/, 'Telegram'],
  [/(^|\.)reddit\.com$|^redd\.it$/, 'Reddit'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, 'Facebook'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'],
  [/(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/, 'Discord'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'],
  [/(^|\.)snapchat\.com$/, 'Snapchat'],
  [/(^|\.)threads\.(net|com)$/, 'Threads'],
  [/(^|\.)bsky\.app$/, 'Bluesky'],
  [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)yahoo\.[a-z]{2,3}(\.[a-z]{2})?$/, 'Yahoo'],
  [/(^|\.)yandex\.[a-z]{2,3}$|^ya\.ru$/, 'Yandex'],
  [/(^|\.)baidu\.com$/, 'Baidu'],
  [/(^|\.)ecosia\.org$/, 'Ecosia'],
  [/^search\.brave\.com$/, 'Brave Search'],
  [/(^|\.)startpage\.com$/, 'Startpage'],
  [/(^|\.)(chatgpt\.com|chat\.openai\.com)$/, 'ChatGPT'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)claude\.ai$/, 'Claude'],
  [/^copilot\.microsoft\.com$/, 'Copilot'],
  [/(^|\.)onlyfans\.com$/, 'OnlyFans'],
  [/(^|\.)fansly\.com$/, 'Fansly'],
  [/(^|\.)fanvue\.com$/, 'Fanvue'],
  [/(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$|^pin\.it$/, 'Pinterest'],
  [/^news\.ycombinator\.com$/, 'Hacker News'],
  [/(^|\.)producthunt\.com$/, 'Product Hunt'],
  [/(^|\.)github\.com$/, 'GitHub'],
  [/^linktr\.ee$/, 'Linktree'],
  // Profile link pages: the visitor came from someone's bio, not the host's own site.
  [/(^|\.)(beacons\.ai|allmylinks\.com|allmy\.bio)$/, 'Link in bio'],
];

// Android apps open links with an android-app://<package>/ referrer.
const APP_PACKAGES: Readonly<Record<string, string>> = {
  'org.telegram.messenger': 'Telegram',
  'org.telegram.messenger.web': 'Telegram',
  'org.telegram.plus': 'Telegram',
  'org.thunderdog.challegram': 'Telegram',
  'com.google.android.gm': 'Gmail',
  'com.google.android.googlequicksearchbox': 'Google',
  'com.google.android.youtube': 'YouTube',
  'com.twitter.android': 'X',
  'com.instagram.android': 'Instagram',
  'com.facebook.katana': 'Facebook',
  'com.facebook.orca': 'Facebook',
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp',
  'com.discord': 'Discord',
  'com.reddit.frontpage': 'Reddit',
  'com.linkedin.android': 'LinkedIn',
  'com.zhiliaoapp.musically': 'TikTok',
  'com.ss.android.ugc.trill': 'TikTok',
  'com.snapchat.android': 'Snapchat',
  'com.slack': 'Slack',
};

// What people type into utm_source for the places above.
const UTM_SOURCES: Readonly<Record<string, string>> = {
  telegram: 'Telegram', tg: 'Telegram', 't.me': 'Telegram',
  x: 'X', twitter: 'X', 'x.com': 'X', 't.co': 'X',
  instagram: 'Instagram', ig: 'Instagram',
  facebook: 'Facebook', fb: 'Facebook', meta: 'Facebook',
  youtube: 'YouTube', yt: 'YouTube',
  tiktok: 'TikTok', tt: 'TikTok',
  reddit: 'Reddit',
  discord: 'Discord',
  whatsapp: 'WhatsApp', wa: 'WhatsApp',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat', snap: 'Snapchat',
  threads: 'Threads',
  github: 'GitHub',
  hackernews: 'Hacker News', hn: 'Hacker News',
  producthunt: 'Product Hunt', ph: 'Product Hunt',
  google: 'Google',
  'google-ads': 'Google Ads', googleads: 'Google Ads', adwords: 'Google Ads',
  bing: 'Bing',
  email: 'Email', newsletter: 'Email', mail: 'Email',
};

// In-app browsers that say whose app they are, for visits that carry no referrer.
const IN_APP_BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/, 'Facebook'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/Snapchat/i, 'Snapchat'],
  [/Twitter for|TwitterAndroid/i, 'X'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Telegram/i, 'Telegram'],
  [/Pinterest/i, 'Pinterest'],
  [/MicroMessenger/i, 'WeChat'],
  [/\bLine\//, 'LINE'],
];

/** The app an in-app browser belongs to, or null for an ordinary browser. */
export function inAppBrowserSource(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  for (const [pattern, name] of IN_APP_BROWSERS) if (pattern.test(userAgent)) return name;
  return null;
}

export type ParsedReferrer = Readonly<{ host: string; path: string | null; app: boolean }>;

/**
 * The referrer's host (lower case, without "www.") and path (no query: a
 * referrer's query can carry someone's search or a token). Null for an empty
 * or unreadable referrer.
 */
export function parseReferrer(referrer: string | null | undefined): ParsedReferrer | null {
  if (!referrer) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.protocol === 'android-app:') {
    const host = url.hostname.toLowerCase();
    return host ? { host, path: null, app: true } : null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  const path = url.pathname && url.pathname !== '/' ? url.pathname.slice(0, 300) : null;
  return { host, path, app: false };
}

/**
 * Names one app adds to the lists above (config.sources): referring hosts,
 * matched with their subdomains and without "www.", and utm_source values.
 * They are looked at first, so an app can also rename a place we know.
 */
export type ExtraSources = Readonly<{
  hosts?: Readonly<Record<string, string>>;
  utm?: Readonly<Record<string, string>>;
}>;

function ownName(table: Readonly<Record<string, string>> | undefined, matches: (key: string) => boolean): string | null {
  if (!table) return null;
  for (const [key, name] of Object.entries(table)) if (name.trim() && matches(key.trim().toLowerCase())) return name.trim();
  return null;
}

/** The name the Traffic page shows for a referring host, or null when it is not one we know. */
export function sourceForReferrer(referrer: ParsedReferrer, extra?: ExtraSources): string | null {
  if (referrer.app) return APP_PACKAGES[referrer.host] ?? null;
  const own = ownName(extra?.hosts, (key) => {
    const host = key.replace(/^www\./, '');
    return Boolean(host) && (referrer.host === host || referrer.host.endsWith(`.${host}`));
  });
  if (own) return own;
  for (const [pattern, name] of HOST_NAMES) if (pattern.test(referrer.host)) return name;
  return null;
}

/** The name for a utm_source value: a known place by its name, anything else as it was typed. */
export function sourceForUtm(utmSource: string, extra?: ExtraSources): string {
  const key = utmSource.trim().toLowerCase();
  return ownName(extra?.utm, (own) => own === key) ?? UTM_SOURCES[key] ?? utmSource.trim().slice(0, 40);
}

export type VisitOrigin = Readonly<{
  /** What the Traffic page groups the visit under. Null when the visit is a step inside the site, not an arrival. */
  source: string | null;
  /** The tag the visit arrived with: the ?ref= name, else utm_campaign. */
  campaign: string | null;
  referrerHost: string | null;
  referrerPath: string | null;
}>;

/**
 * Where one page view came from. `siteHosts` are our own hosts: a referrer on
 * one of them is a click inside the site, which is not an arrival unless it
 * carries a tag. `savedLinks` maps link-maker names to where they were posted.
 * `sources` are the app's own names (ExtraSources).
 */
export function visitOrigin(input: {
  referrer: string | null;
  ref: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  userAgent: string | null;
  siteHosts: readonly string[];
  savedLinks?: ReadonlyMap<string, string>;
  sources?: ExtraSources;
}): VisitOrigin {
  const referrer = parseReferrer(input.referrer);
  const ownHosts = input.siteHosts.map((host) => host.toLowerCase().replace(/^www\./, ''));
  const internal = Boolean(referrer && !referrer.app && ownHosts.includes(referrer.host));
  const ref = input.ref ? normalizeLinkName(input.ref) : null;
  const utmSource = input.utmSource?.trim() || null;
  const utmCampaign = input.utmCampaign?.trim().slice(0, 100) || null;
  const campaign = ref ?? utmCampaign;
  const referrerHost = referrer && !internal ? referrer.host : null;
  const referrerPath = referrer && !internal ? referrer.path : null;

  if (internal && !campaign && !utmSource) return { source: null, campaign: null, referrerHost: null, referrerPath: null };

  const saved = ref ? input.savedLinks?.get(ref) : undefined;
  const source =
    saved ??
    (utmSource ? sourceForUtm(utmSource, input.sources) : null) ??
    (referrer && !internal ? (sourceForReferrer(referrer, input.sources) ?? referrer.host) : null) ??
    inAppBrowserSource(input.userAgent) ??
    (campaign ? TAGGED_SOURCE : DIRECT_SOURCE);
  return { source, campaign, referrerHost, referrerPath };
}
