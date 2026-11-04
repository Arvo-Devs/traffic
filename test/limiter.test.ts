/**
 * The limit on public routes: a rolling window per subject and in total.
 * BetterFans Link's first copy started its window over, so one address could
 * send its cap at the end of one window and again at the start of the next.
 */
import { describe, expect, test } from 'bun:test';
import { createPublicLimiter } from '../src/server/limiter';

const T = 1_000_000;

describe('the rolling window', () => {
  test('one subject never gets more than its cap in any window, across an edge', () => {
    const admit = createPublicLimiter({ perSubject: 3, total: 1000, windowMs: 1000 });
    expect(admit('a', T)).toBe(true);
    expect(admit('a', T + 997)).toBe(true);
    expect(admit('a', T + 998)).toBe(true);
    expect(admit('a', T + 999)).toBe(false);
    // The first call leaves the window: one place opens, not a fresh three.
    // A window that started over at T + 1000 let all three through again.
    expect(admit('a', T + 1000)).toBe(true);
    expect(admit('a', T + 1001)).toBe(false);
    expect(admit('a', T + 1002)).toBe(false);
    expect(admit('a', T + 1996)).toBe(false);
    // T + 997 leaves at T + 1997.
    expect(admit('a', T + 1997)).toBe(true);
    // Other subjects have their own count.
    expect(admit('b', T + 1997)).toBe(true);
  });

  test('a burst at the end of a window and the start of the next is still one cap', () => {
    const admit = createPublicLimiter({ perSubject: 5, total: 1000, windowMs: 60_000 });
    const lateBurst = Array.from({ length: 5 }, (_, i) => admit('203.0.113.7', T + 59_990 + i));
    const earlyBurst = Array.from({ length: 5 }, (_, i) => admit('203.0.113.7', T + 60_010 + i));
    expect(lateBurst).toEqual([true, true, true, true, true]);
    expect(earlyBurst).toEqual([false, false, false, false, false]);
  });

  test('refused calls do not count', () => {
    const admit = createPublicLimiter({ perSubject: 2, total: 1000, windowMs: 1000 });
    expect([admit('a', T), admit('a', T + 1), admit('a', T + 2), admit('a', T + 3)]).toEqual([true, true, false, false]);
    // Both calls let through leave the window by T + 1001; the refused ones held nothing.
    expect([admit('a', T + 1001), admit('a', T + 1001)]).toEqual([true, true]);
  });

  test('everyone together is held to the total', () => {
    const admit = createPublicLimiter({ perSubject: 10, total: 3, windowMs: 1000 });
    expect([admit('a', T), admit('b', T + 1), admit('c', T + 2), admit('d', T + 3)]).toEqual([true, true, true, false]);
    expect(admit('d', T + 1000)).toBe(true);
    expect(admit('e', T + 1000)).toBe(false);
  });

  test('it holds only the subjects of the last window', () => {
    const admit = createPublicLimiter({ perSubject: 10, total: 100_000, windowMs: 1000 });
    for (let i = 0; i < 5000; i += 1) admit(`198.51.${Math.floor(i / 256)}.${i % 256}`, T + (i % 500));
    expect(admit.size()).toBe(5000);
    // Every one of those calls has left the window by T + 1500.
    expect(admit('203.0.113.7', T + 1500)).toBe(true);
    expect(admit.size()).toBe(1);
    expect(admit('203.0.113.7', T + 2500)).toBe(true);
    expect(admit.size()).toBe(1);
  });

  test('it keeps the signature BetterFans Link calls: (subject) with the time now', () => {
    const admit = createPublicLimiter({ perSubject: 1, total: 10, windowMs: 60_000 });
    expect(admit('usr_1')).toBe(true);
    expect(admit('usr_1')).toBe(false);
    expect(admit('usr_2')).toBe(true);
  });
});
