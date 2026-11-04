// "How did you find us?": one optional question a new account sees once,
// right after signing up, never on the sign-up form itself. Traffic can only
// name a source the link carried, so a sign-up from a typed address, an email
// app or a group chat lands under Direct or unknown; the person's own answer
// sits beside it on the Traffic page. Pure, so the screen, the route and the
// page share one list. An app can give its own answers to both the server
// config and the field; the default list is BetterFans Link's.

export type FoundViaChoice = Readonly<{ value: string; label: string }>;

/** The answers, in the order the screen shows them. */
export const DEFAULT_FOUND_VIA_ANSWERS: readonly FoundViaChoice[] = [
  { value: 'google', label: 'Google' },
  { value: 'ai', label: 'ChatGPT or another AI' },
  { value: 'x', label: 'X' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'github', label: 'GitHub' },
  { value: 'friend', label: 'A friend or colleague' },
  { value: 'email', label: 'An email from us' },
  { value: 'group-chat', label: 'A group chat' },
  { value: 'other', label: 'Something else' },
];

/** The answer that comes with a box for the person's own words. */
export const FOUND_VIA_OTHER = 'other';
/** Kept when the question was shown and left blank, so the page tells a skip from a person never asked. */
export const FOUND_VIA_SKIPPED = 'skipped';
/** The longest "Something else" answer kept. */
export const FOUND_VIA_OTHER_MAX = 120;
/** A note is one answer and a few words: anything bigger is not one. */
export const FOUND_VIA_NOTE_MAX_BYTES = 1024;

/** An answer as the database keeps it (traffic_found_via_answer_check): lower case letters and dashes. */
const VALUE = /^[a-z][a-z-]{0,29}$/;

export type FoundViaNote = Readonly<{ answer: string; other: string | null }>;

/**
 * The list, checked once: values the database takes, no repeats, never the
 * word kept for a skip, and a label for each. Throws on a bad list, so a
 * misconfigured app fails at its first request instead of losing answers.
 */
export function checkFoundViaAnswers(answers: readonly FoundViaChoice[]): readonly FoundViaChoice[] {
  if (!answers.length) throw new Error('@arvo/traffic: "How did you find us?" needs at least one answer.');
  const seen = new Set<string>();
  for (const { value, label } of answers) {
    if (!VALUE.test(value) || value === FOUND_VIA_SKIPPED || seen.has(value) || !label.trim()) {
      throw new Error(`@arvo/traffic: "${value}" is not a usable answer to "How did you find us?". Use lower case letters and dashes, once each, with a label.`);
    }
    seen.add(value);
  }
  return answers;
}

export function isFoundViaAnswer(value: unknown, answers: readonly FoundViaChoice[] = DEFAULT_FOUND_VIA_ANSWERS): value is string {
  return typeof value === 'string' && answers.some((choice) => choice.value === value);
}

/** The "Something else" words, one line with control characters dropped (Postgres refuses a NUL), or null when empty. */
function otherText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const printable = Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('');
  const text = printable.replace(/\s+/g, ' ').trim();
  // Cut by character, not UTF-16 unit, so an emoji is never split.
  return text ? Array.from(text).slice(0, FOUND_VIA_OTHER_MAX).join('').trim() : null;
}

/** What the screen sent, checked field by field; null when it is not a note. The words are kept only with "Something else". */
export function parseFoundViaNote(raw: unknown, answers: readonly FoundViaChoice[] = DEFAULT_FOUND_VIA_ANSWERS): FoundViaNote | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { answer, other } = raw as Record<string, unknown>;
  if (answer === FOUND_VIA_SKIPPED) return { answer, other: null };
  if (!isFoundViaAnswer(answer, answers)) return null;
  return { answer, other: answer === FOUND_VIA_OTHER ? otherText(other) : null };
}

/** The words the Traffic page shows for a kept answer, or null when there is none. An answer no longer on the list shows as it was kept. */
export function foundViaLabel(answer: string | null | undefined, answers: readonly FoundViaChoice[] = DEFAULT_FOUND_VIA_ANSWERS): string | null {
  if (!answer) return null;
  if (answer === FOUND_VIA_SKIPPED) return 'Skipped';
  return answers.find((choice) => choice.value === answer)?.label ?? answer;
}
