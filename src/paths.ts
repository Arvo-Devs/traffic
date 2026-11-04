// Which pages the visit counter counts, and the limits a note is held to.
// The counter (src/counter.tsx) imports this on every public page, so it
// stays tiny: no other imports.

/**
 * A site's counted pages: single pages, and sections counted with every page
 * under them. Plain data, so a server layout can hand the same object to the
 * counter and to the server config.
 */
export type CountedPages = Readonly<{
  /** Pages counted on their own, like "/" or "/sign-up". */
  pages?: readonly string[];
  /** Sections counted with everything under them, like "/docs". */
  sections?: readonly string[];
}>;

const PATH = /^\/[A-Za-z0-9._~\-/%]*$/;
// A browser resolves "." and ".." (also written %2e) before it asks for a
// page, so a path that still has one was written by hand: "/docs/../link/x"
// passes the "/docs" prefix check and names a page that is not under it.
const ENCODED_DOT = /%2e/gi;
// A slash or backslash written as %2f or %5c hides a segment the same way.
const ENCODED_SEPARATOR = /%(2f|5c)/i;

/**
 * True for a path shaped like a page of the site: a slash, then segments of
 * letters, digits and `._~-%`, at most 300 characters. A dot segment ("." or
 * "..", plain or with %2e in any case), a hidden separator (%2f, %5c) and an
 * empty segment ("//", or a slash at the end) are refused. Only "/" itself
 * ends in a slash.
 */
export function isCleanPath(path: string): boolean {
  if (typeof path !== 'string' || path.length > 300 || !PATH.test(path)) return false;
  if (path === '/') return true;
  for (const segment of path.slice(1).split('/')) {
    const plain = segment.replace(ENCODED_DOT, '.');
    if (!plain || plain === '.' || plain === '..' || ENCODED_SEPARATOR.test(segment)) return false;
  }
  return true;
}

/**
 * True for a page whose views the Traffic page counts. It is an allow list: a
 * path not listed is never counted, so a new private page (a hosted page that
 * carries a token in its path) can never be stored by mistake.
 */
export function countedPathMatcher(counted: CountedPages): (path: string) => boolean {
  const pages = new Set(counted.pages ?? []);
  const sections = (counted.sections ?? []).map((section) => section.replace(/\/+$/, '')).filter(Boolean);
  return (path: string) => {
    if (!isCleanPath(path)) return false;
    if (pages.has(path)) return true;
    return sections.some((section) => path === section || path.startsWith(`${section}/`));
  };
}

/** A note is a path, a referrer and a few tags: well under this. */
export const TRAFFIC_NOTE_MAX_BYTES = 4096;
/** Time on a page is capped here: a tab left open overnight is not an hour of reading. */
export const TRAFFIC_MAX_ENGAGED_SECONDS = 60 * 60;
/** How long a visitor's address, user agent, visitor key and ad click ids are kept. */
export const TRAFFIC_ADDRESS_RETENTION_DAYS = 180;
