'use client';

import { useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { countedPathMatcher, type CountedPages } from './paths';

// Counts visits to the site's counted pages for the Traffic page. Ported from
// BetterFans Link's components/traffic/site-note.tsx (main d4138f9), which
// came from Fan Auto's. On each counted page it sends one small note when the
// page is shown, and one with the seconds it was visible when the page is
// hidden or left. Nothing is saved in the browser: the view's id lives in
// memory for as long as the page is open. The server works out the rest and
// leaves out people signed in to the app, bots and automated browsers. It
// ships on every public page, so it imports only React, next/navigation and
// ./paths.

const TAGS = ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
// Google Ads adds one of these to an ad's link. Kept with the visit, so a
// sign-up from the ad can be sent back to Google Ads without its tag or a cookie.
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid'] as const;

type View = { id: string; path: string; startedAt: number; visibleSince: number | null; seenMs: number };

// The view on screen, and the page before it (a click inside the site is not an arrival).
let current: View | null = null;
let previousPath: string | null = null;

function send(endpoint: string, note: Record<string, unknown>) {
  const body = JSON.stringify(note);
  // text/plain is a request browsers never refuse as a beacon (some refuse
  // JSON) and never hold back for a CORS check, so the note goes out even to
  // an endpoint on another host.
  try {
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
  } catch {
    // A browser that refuses the beacon gets the same note by fetch.
  }
  // Like the beacon, it sends the cookies and reads nothing back.
  void fetch(endpoint, {
    method: 'POST',
    body,
    keepalive: true,
    mode: 'no-cors',
    credentials: 'include',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
  }).catch(() => undefined);
}

function pause(view: View) {
  if (view.visibleSince === null) return;
  view.seenMs += performance.now() - view.visibleSince;
  view.visibleSince = null;
}

function reportTime(endpoint: string, view: View) {
  pause(view);
  const seconds = Math.round(view.seenMs / 1000);
  if (seconds > 0) send(endpoint, { kind: 'leave', id: view.id, seconds });
}

export type TrafficCounterProps = {
  /** The pages that count: the same object the server config gets. */
  counted: CountedPages;
  /** Where the notes go. Default /api/site-note on the same site. */
  endpoint?: string;
};

/** Put it once in the root layout. It renders nothing. */
export function TrafficCounter({ counted, endpoint = '/api/site-note' }: TrafficCounterProps) {
  const pathname = usePathname();
  // Keyed on the lists, not the object, so a layout that passes a new object
  // with the same pages never starts a second view of the page on screen.
  const lists = JSON.stringify([counted.pages ?? [], counted.sections ?? []]);
  const isCounted = useMemo(() => {
    const [pages, sections] = JSON.parse(lists) as [string[], string[]];
    return countedPathMatcher({ pages, sections });
  }, [lists]);

  useEffect(() => {
    if (!pathname || !isCounted(pathname) || navigator.webdriver || typeof crypto?.randomUUID !== 'function') {
      previousPath = pathname;
      return undefined;
    }
    // React runs an effect twice in development: the same page within a moment is the same view.
    const reused = current && current.path === pathname && performance.now() - current.startedAt < 1500 ? current : null;
    const view: View = reused ?? { id: crypto.randomUUID(), path: pathname, startedAt: performance.now(), visibleSince: null, seenMs: 0 };
    if (!reused) {
      const params = new URLSearchParams(window.location.search);
      const referrer = previousPath === null ? document.referrer : `${window.location.origin}${previousPath}`;
      send(endpoint, {
        kind: 'view',
        id: view.id,
        path: pathname,
        referrer: referrer || null,
        ...Object.fromEntries([...TAGS, ...CLICK_IDS].map((tag) => [tag, params.get(tag)])),
        width: window.innerWidth,
        touch: navigator.maxTouchPoints ?? 0,
        language: navigator.language,
      });
    }
    current = view;
    previousPath = pathname;
    if (document.visibilityState === 'visible' && view.visibleSince === null) view.visibleSince = performance.now();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') reportTime(endpoint, view);
      else if (view.visibleSince === null) view.visibleSince = performance.now();
    };
    const onPageHide = () => reportTime(endpoint, view);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      reportTime(endpoint, view);
    };
  }, [pathname, isCounted, endpoint]);

  return null;
}
