// The note a public page sends to the intake (POST /api/site-note), checked
// field by field before anything is stored. Pure, so the route and the tests
// share it. Which pages count is the app's own list (../paths.ts).
//
// A page sends a `view` note when it is shown, and a `leave` note with the
// seconds it was visible when it is hidden or closed. The view's id is a
// random UUID made in the browser for that one view and kept nowhere: no
// cookie and nothing in the browser's storage. A view that arrived from a
// Google ad also carries the click id Google added to the link (gclid, or
// gbraid and wbraid on iOS), read from the address like the utm tags.
import { TRAFFIC_MAX_ENGAGED_SECONDS } from '../paths';

export type ViewNote = Readonly<{
  kind: 'view';
  id: string;
  path: string;
  referrer: string | null;
  ref: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  width: number | null;
  touchPoints: number | null;
  language: string | null;
}>;

export type LeaveNote = Readonly<{ kind: 'leave'; id: string; seconds: number }>;

export type TrafficNote = ViewNote | LeaveNote;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Google's click ids are URL-safe base64. Case matters: Google rejects one with its case changed. */
const CLICK_ID = /^[A-Za-z0-9_-]{8,300}$/;

/** A click id as Google sent it, or null for anything else. */
export function clickId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return CLICK_ID.test(trimmed) ? trimmed : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // A link's ?utm_source=%00 arrives as a real NUL, which Postgres refuses in text.
  const trimmed = value.replaceAll('\u0000', '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

/** The note, or null when it is not one a page of ours would send. */
export function parseTrafficNote(raw: unknown, isCounted: (path: string) => boolean): TrafficNote | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const note = raw as Record<string, unknown>;
  if (typeof note.id !== 'string' || !UUID.test(note.id)) return null;
  const id = note.id.toLowerCase();
  if (note.kind === 'leave') {
    const seconds = whole(note.seconds, 0, 7 * 24 * 60 * 60);
    return seconds === null ? null : { kind: 'leave', id, seconds: Math.min(seconds, TRAFFIC_MAX_ENGAGED_SECONDS) };
  }
  if (note.kind !== 'view') return null;
  if (typeof note.path !== 'string' || !isCounted(note.path)) return null;
  return {
    kind: 'view',
    id,
    path: note.path,
    referrer: text(note.referrer, 1000),
    ref: text(note.ref, 100),
    utmSource: text(note.utm_source, 100),
    utmMedium: text(note.utm_medium, 100),
    utmCampaign: text(note.utm_campaign, 100),
    utmContent: text(note.utm_content, 100),
    utmTerm: text(note.utm_term, 100),
    gclid: clickId(note.gclid),
    gbraid: clickId(note.gbraid),
    wbraid: clickId(note.wbraid),
    width: whole(note.width, 0, 20000),
    touchPoints: whole(note.touch, 0, 32),
    language: text(note.language, 35),
  };
}
