// The Traffic page's ranges, arithmetic and the shape of what it reads. Pure,
// so the page, the server and the tests agree on what "7 days" and "join
// rate" mean. Taken from BetterFans Link's copy.

export const TRAFFIC_RANGES = ['today', '7d', '30d', '90d'] as const;
export type TrafficRange = (typeof TRAFFIC_RANGES)[number];

export const TRAFFIC_RANGE_LABELS: Readonly<Record<TrafficRange, string>> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

export function isTrafficRange(value: unknown): value is TrafficRange {
  return typeof value === 'string' && (TRAFFIC_RANGES as readonly string[]).includes(value);
}

/** Whole days before today that a range reaches back, in the viewer's time zone. */
export function rangeDaysBack(range: TrafficRange): number {
  return range === 'today' ? 0 : Number.parseInt(range, 10) - 1;
}

/** Today is drawn by the hour, every other range by the day. */
export function rangeBucket(range: TrafficRange): 'hour' | 'day' {
  return range === 'today' ? 'hour' : 'day';
}

/** An IANA time zone the server can use, or UTC. */
export function safeTimeZone(input: string | null | undefined): string {
  if (!input || input.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(input)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input });
    return input;
  } catch {
    return 'UTC';
  }
}

// Chrome and Node name these zones by their old IANA names, which a database
// without tzdata's backward links does not know.
const CURRENT_ZONE_NAMES: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/** The names a zone may go by in the database: as given, then its current IANA name. */
export function timeZoneNames(zone: string): string[] {
  const current = CURRENT_ZONE_NAMES[zone];
  return current ? [zone, current] : [zone];
}

/** Sign-ups over visitors, as a percentage with one decimal; null when nobody visited. */
export function joinRate(signups: number, visitors: number): number | null {
  if (visitors <= 0) return null;
  return Math.round((signups / visitors) * 1000) / 10;
}

/** The change from the previous window as a percentage; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type TrafficLink = {
  name: string;
  /** Where the link was posted; for a tag nobody made in the link maker, where most of its visits came from. */
  platform: string | null;
  path: string | null;
  /** False for a tag that arrived without being made in the link maker (a typed ?ref= or a utm_campaign). */
  saved: boolean;
  createdAt: string | null;
  visitors: number;
  signups: number;
};

/** What the page needs from the app's config: where tagged links point and which pages they can open. */
export type TrafficSite = {
  /** The public address tagged links open, with no slash at the end: https://example.com. */
  url: string;
  linkPages: { value: string; label: string }[];
  /** The app's test tag (like bfl-test), for the page's "How this counts" note. */
  testTag: string;
};

export type TrafficSummary = {
  range: TrafficRange;
  timeZone: string;
  bucket: 'hour' | 'day';
  windowStart: string;
  generatedAt: string;
  site: TrafficSite;
  totals: { visitors: number; views: number; signups: number; joinRate: number | null };
  /** The same stretch one range earlier, up to the same time. */
  previous: { visitors: number; views: number; signups: number };
  /** Visitors with a page view in the last 5 minutes. */
  liveVisitors: number;
  /** Buckets in the viewer's time zone, YYYY-MM-DDTHH:MI. */
  series: { bucket: string; visitors: number; views: number; signups: number }[];
  sources: { source: string; visitors: number; signups: number }[];
  /** Answers to "How did you find us?" given in the range (found-via.ts), skips included, with the words the page shows. */
  foundVia: { answer: string; label: string; signups: number }[];
  links: TrafficLink[];
  pages: { path: string; visitors: number; views: number; avgSeconds: number | null }[];
  countries: { country: string | null; visitors: number }[];
  devices: { device: string | null; visitors: number }[];
  browsers: { browser: string | null; visitors: number }[];
  latestSignups: {
    at: string;
    /** The account's id, for the app's own link to it. */
    userId: string | null;
    /** Read live from the app (the `accounts` hook), never stored. */
    name: string | null;
    email: string | null;
    /** True when the app no longer knows the account: it was deleted. */
    removed: boolean;
    source: string | null;
    campaign: string | null;
    landingPath: string | null;
    firstSeenAt: string | null;
    viewsBefore: number | null;
    country: string | null;
    /** Their answer to "How did you find us?", `skipped`, or null when they were not asked. */
    foundVia: string | null;
    /** The words the page shows for that answer. */
    foundViaLabel: string | null;
    /** The words given with Something else. */
    foundViaOther: string | null;
  }[];
};
