/**
 * "How did you find us?" (src/shared/found-via.ts): which notes the route
 * takes, what the Traffic page calls each answer, and an app's own answers.
 * The route and the page against a real database are in traffic.pg.test.ts.
 * Ported from BetterFans Link's tests/app/traffic-found-via.test.ts; its
 * check of BetterFans Link's own first screen stays in BetterFans Link.
 */
import { describe, expect, test } from 'bun:test';
import { createTraffic } from '../src/index';
import {
  DEFAULT_FOUND_VIA_ANSWERS,
  FOUND_VIA_OTHER_MAX,
  FOUND_VIA_SKIPPED,
  checkFoundViaAnswers,
  foundViaLabel,
  isFoundViaAnswer,
  parseFoundViaNote,
} from '../src/shared/found-via';
import { fakeConfig } from './fake-app';

const OWN = [
  { value: 'podcast', label: 'A podcast' },
  { value: 'event', label: 'An event' },
  { value: 'other', label: 'Something else' },
] as const;

describe('the note the screen sends', () => {
  test('an answer is kept, and its words only with Something else', () => {
    expect(parseFoundViaNote({ answer: 'friend' })).toEqual({ answer: 'friend', other: null });
    expect(parseFoundViaNote({ answer: 'friend', other: 'my agency' })).toEqual({ answer: 'friend', other: null });
    expect(parseFoundViaNote({ answer: 'other', other: '  A podcast\u0000 about\n  agencies ' })).toEqual({ answer: 'other', other: 'A podcast about agencies' });
    expect(parseFoundViaNote({ answer: 'other', other: '   ' })).toEqual({ answer: 'other', other: null });
    expect(parseFoundViaNote({ answer: 'other' })).toEqual({ answer: 'other', other: null });
  });

  test('a blank answer is a skip, with no words', () => {
    expect(parseFoundViaNote({ answer: FOUND_VIA_SKIPPED, other: 'anything' })).toEqual({ answer: 'skipped', other: null });
  });

  test('long words are cut by character, so an emoji is never split', () => {
    const long = parseFoundViaNote({ answer: 'other', other: 'x'.repeat(500) });
    expect(long?.other).toHaveLength(FOUND_VIA_OTHER_MAX);
    const emoji = parseFoundViaNote({ answer: 'other', other: `${'a'.repeat(FOUND_VIA_OTHER_MAX - 1)}😀😀` });
    expect(Array.from(emoji?.other ?? '')).toHaveLength(FOUND_VIA_OTHER_MAX);
    expect(emoji?.other?.endsWith('😀')).toBe(true);
  });

  test('anything else is not a note', () => {
    for (const raw of [null, undefined, 'friend', 42, [], ['friend'], {}, { answer: 'tiktok' }, { answer: 7 }, { answer: 'Friend' }]) {
      expect(parseFoundViaNote(raw)).toBeNull();
    }
  });
});

describe('what the Traffic page calls an answer', () => {
  test('each answer has its words, a skip says so, and an answer no longer listed still shows', () => {
    expect(foundViaLabel('friend')).toBe('A friend or colleague');
    expect(foundViaLabel('ai')).toBe('ChatGPT or another AI');
    expect(foundViaLabel(FOUND_VIA_SKIPPED)).toBe('Skipped');
    expect(foundViaLabel('tiktok')).toBe('tiktok');
    expect(foundViaLabel(null)).toBeNull();
  });

  test('every default answer fits the column the database keeps it in', () => {
    // traffic_found_via_answer_check in migrations/0002_traffic_found_via.sql
    for (const answer of [...DEFAULT_FOUND_VIA_ANSWERS.map((choice) => choice.value), FOUND_VIA_SKIPPED]) expect(answer).toMatch(/^[a-z][a-z-]{0,29}$/);
    expect(checkFoundViaAnswers(DEFAULT_FOUND_VIA_ANSWERS)).toBe(DEFAULT_FOUND_VIA_ANSWERS);
  });
});

describe("an app's own answers", () => {
  test('its list decides what is an answer and what the page calls it', () => {
    expect(checkFoundViaAnswers(OWN)).toBe(OWN);
    expect(parseFoundViaNote({ answer: 'podcast' }, OWN)).toEqual({ answer: 'podcast', other: null });
    expect(parseFoundViaNote({ answer: 'other', other: 'a meetup' }, OWN)).toEqual({ answer: 'other', other: 'a meetup' });
    // A default answer the app left out is not one of its answers.
    expect(parseFoundViaNote({ answer: 'google' }, OWN)).toBeNull();
    expect(parseFoundViaNote({ answer: FOUND_VIA_SKIPPED }, OWN)).toEqual({ answer: 'skipped', other: null });
    expect(isFoundViaAnswer('event', OWN)).toBe(true);
    expect(foundViaLabel('podcast', OWN)).toBe('A podcast');
    // An answer kept before the app changed its list still shows as it was kept.
    expect(foundViaLabel('google', OWN)).toBe('google');
  });

  test('a list the database could not keep is refused when the config is read', () => {
    for (const bad of [
      [],
      [{ value: 'Podcast', label: 'A podcast' }],
      [{ value: 'has space', label: 'Spaced' }],
      [{ value: 'skipped', label: 'Skipped on purpose' }],
      [{ value: 'event', label: 'An event' }, { value: 'event', label: 'Again' }],
      [{ value: 'event', label: '   ' }],
      [{ value: 'a'.repeat(31), label: 'Too long' }],
    ]) {
      expect(() => checkFoundViaAnswers(bad)).toThrow('@arvo/traffic');
      expect(() => createTraffic(fakeConfig({ foundViaAnswers: bad }))).toThrow('@arvo/traffic');
    }
    expect(() => createTraffic(fakeConfig({ foundViaAnswers: OWN }))).not.toThrow();
  });
});
