// What a screen tells the Traffic routes: an account may have just been made
// here, or the person answered "How did you find us?". Ported from
// BetterFans Link's lib/traffic/client.ts (main d4138f9). Both are fire and
// forget, so a form never waits for them. Sign-up forms import this file, so
// it has no React and nothing beyond the found-via types: it must not pull
// the Traffic page into a sign-up form's bundle.
import type { FoundViaNote } from './shared/found-via';

/** Where the Traffic routes are mounted unless the app says otherwise. */
export const TRAFFIC_BASE_PATH = '/api/traffic';

function route(basePath: string, name: string): string {
  return `${basePath.replace(/\/+$/, '')}/${name}`;
}

/**
 * Tells the Traffic page an account may have just been made here. The server
 * asks who is signed in and counts only an account under 30 minutes old, once.
 */
export function noteSignup(basePath: string = TRAFFIC_BASE_PATH): void {
  void fetch(route(basePath, 'signup'), { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
}

/** Sends the answer to "How did you find us?" once the screen that asked it is done. The server keeps one per account. */
export function noteFoundVia(note: FoundViaNote, basePath: string = TRAFFIC_BASE_PATH): void {
  void fetch(route(basePath, 'found-via'), {
    method: 'POST',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(note),
  }).catch(() => undefined);
}
