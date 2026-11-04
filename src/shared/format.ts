// How the Traffic page writes its numbers. Pure, so the page and the tests
// agree. The ranges and the arithmetic are in ./summary.

/** "0:48", "2:10", "1:02:05": time on a page as people read clocks. Null when nobody stayed long enough to measure. */
export function formatSeconds(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** A page path as people read it: the home page by name. */
export function pageLabel(path: string): string {
  return path === '/' ? 'Home' : path;
}

const COUNTRY_NAMES = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

/** "United States" for "US"; the code itself when the name is unknown. */
export function countryName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  try {
    return COUNTRY_NAMES?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "2 PM" for an hour bucket, "Oct 4" for a day. The server already wrote buckets in the viewer's time zone. */
export function bucketLabel(bucket: string, unit: 'hour' | 'day'): string {
  if (unit === 'hour') {
    const hour = Number(bucket.slice(11, 13));
    if (!Number.isFinite(hour)) return bucket;
    return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
  }
  const day = new Date(`${bucket.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(day.getTime()) ? bucket : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(day);
}

/** The address a tagged link opens: <site><path>?ref=<name>, the site's address coming from the server's config. */
export function trafficLinkUrl(siteUrl: string, name: string, path: string | null): string {
  return `${siteUrl.replace(/\/+$/, '')}${path && path !== '/' ? path : '/'}?ref=${encodeURIComponent(name)}`;
}

/** The viewer's own time zone, so days and hours on the page are theirs. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
