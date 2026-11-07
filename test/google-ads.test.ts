/**
 * Google Ads sign-ups without a Google tag: the click id the counter keeps,
 * the login Google Ads' scheduled upload sends, and the file it reads. The
 * database side (a click to a sign-up to the file) is in traffic.pg.test.ts.
 * Ported from BetterFans Link's tests/app/traffic-google-ads.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { normalizeConfig } from '../src/config';
import { GOOGLE_ADS_CONVERSION_NAME, conversionTime, conversionsCsv, googleAdsLogin, hasImportLogin } from '../src/server/google-ads';
import { clickId, parseTrafficNote } from '../src/shared/note';
import { COUNTED, fakeConfig } from './fake-app';
import { countedPathMatcher } from '../src/paths';

const ID = '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b';
const GCLID = 'Cj0KCQjw8--2BhCHARIsAF_w1gzT9xQ_aZ-cLmv1ZbD8eQ3hR5uUrK0TqWbN1s6YyX4pL2mVxPaEaAgQvEALw_wcB';
const PASSWORD = 'k3Vq9xT2mP7wR4zL8nB5cY1d';
const isCounted = countedPathMatcher(COUNTED);

const basic = (user: string, password: string) => new Headers({ authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` });

describe('the click id the counter keeps', () => {
  test('a view from an ad keeps its gclid, gbraid and wbraid exactly as Google sent them', () => {
    const note = parseTrafficNote({ kind: 'view', id: ID, path: '/', utm_source: 'google-ads', gclid: ` ${GCLID} `, gbraid: '0AAAAADa3bC9xYzQ_k-1', wbraid: 'CkQKCQjw8--2BhCHEjQA' }, isCounted);
    expect(note).toMatchObject({ utmSource: 'google-ads', gclid: GCLID, gbraid: '0AAAAADa3bC9xYzQ_k-1', wbraid: 'CkQKCQjw8--2BhCHEjQA' });
  });

  test('anything that is not a click id is dropped, and the rest of the view still counts', () => {
    for (const bad of ['', 'short', 'has space in it', 'Cj0KCQjw<script>', 'Cj0KCQjw8.2BhCHARIsAF', 'x'.repeat(301), 42, null, ['Cj0KCQjw8--2BhCH']]) {
      expect(clickId(bad)).toBeNull();
    }
    const note = parseTrafficNote({ kind: 'view', id: ID, path: '/features', gclid: 'Cj0KCQjw<img src=x>' }, isCounted);
    expect(note).toMatchObject({ kind: 'view', path: '/features', gclid: null, gbraid: null, wbraid: null });
    // Case is part of the id: Google rejects a gclid whose case changed.
    expect(clickId('AbCdEfGh12')).toBe('AbCdEfGh12');
  });
});

describe('the login Google Ads sends', () => {
  test('both are needed, the password is long enough and the user name has no colon', () => {
    expect(googleAdsLogin(undefined)).toBeNull();
    expect(googleAdsLogin({})).toBeNull();
    expect(googleAdsLogin({ user: 'google-ads' })).toBeNull();
    expect(googleAdsLogin({ password: PASSWORD })).toBeNull();
    expect(googleAdsLogin({ user: 'google-ads', password: 'short-password' })).toBeNull();
    expect(googleAdsLogin({ user: 'google:ads', password: PASSWORD })).toBeNull();
    expect(googleAdsLogin({ user: null, password: null })).toBeNull();
    expect(googleAdsLogin({ user: ' google-ads ', password: PASSWORD })).toEqual({ user: 'google-ads', password: PASSWORD });
  });

  test('a half-set login turns the file off and says so once, when the config is read', () => {
    const logs: string[] = [];
    const config = normalizeConfig(fakeConfig({ googleAds: { user: 'google-ads' }, log: (line) => logs.push(line) }));
    expect(config.googleAds).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('Google Ads file is off');
    // Short password: off, and said.
    logs.length = 0;
    expect(normalizeConfig(fakeConfig({ googleAds: { user: 'google-ads', password: 'too-short' }, log: (line) => logs.push(line) })).googleAds).toBeNull();
    expect(logs).toHaveLength(1);
    // Nothing set: off, and nothing to say.
    logs.length = 0;
    expect(normalizeConfig(fakeConfig({ log: (line) => logs.push(line) })).googleAds).toBeNull();
    expect(logs).toEqual([]);
  });

  test('the conversion name and the realm come from the config, or the defaults', () => {
    const on = normalizeConfig(fakeConfig({ googleAds: { user: 'google-ads', password: PASSWORD } })).googleAds;
    expect(on).toEqual({ user: 'google-ads', password: PASSWORD, conversionName: GOOGLE_ADS_CONVERSION_NAME, realm: 'example.com' });
    const named = normalizeConfig(fakeConfig({ googleAds: { user: 'google-ads', password: PASSWORD, conversionName: ' Trial start ', realm: 'Example "Site"' } })).googleAds;
    expect(named).toMatchObject({ conversionName: 'Trial start', realm: 'Example Site' });
  });

  test('only the exact user name and password open the file', () => {
    const login = { user: 'google-ads', password: PASSWORD };
    expect(hasImportLogin(basic('google-ads', PASSWORD), login)).toBe(true);
    expect(hasImportLogin(new Headers({ authorization: `basic ${Buffer.from(`google-ads:${PASSWORD}`).toString('base64')}` }), login)).toBe(true);
    // A colon in the password is part of the password.
    expect(hasImportLogin(basic('google-ads', `${PASSWORD}:extra`), { user: 'google-ads', password: `${PASSWORD}:extra` })).toBe(true);
    expect(hasImportLogin(basic('google-ads', `${PASSWORD}x`), login)).toBe(false);
    expect(hasImportLogin(basic('google-ads', PASSWORD.toUpperCase()), login)).toBe(false);
    expect(hasImportLogin(basic('other', PASSWORD), login)).toBe(false);
    expect(hasImportLogin(basic('', ''), login)).toBe(false);
    expect(hasImportLogin(new Headers(), login)).toBe(false);
    expect(hasImportLogin(new Headers({ authorization: `Bearer ${PASSWORD}` }), login)).toBe(false);
    expect(hasImportLogin(new Headers({ authorization: `Basic ${Buffer.from(`google-ads${PASSWORD}`).toString('base64')}` }), login)).toBe(false);
    expect(hasImportLogin(new Headers({ authorization: 'Basic !!!not-base64' }), login)).toBe(false);
  });
});

describe('the file Google Ads reads', () => {
  const HEADER = 'Google Click ID,Conversion Name,Conversion Time,GBRAID,WBRAID\r\n';

  test('column names first, then one row per sign-up with its time in UTC', () => {
    expect(GOOGLE_ADS_CONVERSION_NAME).toBe('Sign-up');
    expect(conversionTime('2026-10-26T18:04:05.678Z')).toBe('2026-10-26 18:04:05+0000');
    expect(conversionTime('2026-10-26T11:04:05-07:00')).toBe('2026-10-26 18:04:05+0000');
    expect(
      conversionsCsv([
        { kind: 'gclid', id: GCLID, occurredAt: '2026-10-26T18:04:05.678Z' },
        { kind: 'gclid', id: 'EAIaIQobChMI8_pQ', occurredAt: '2026-10-27T00:00:00.000Z' },
      ]),
    ).toBe(
      HEADER
        + `${GCLID},Sign-up,2026-10-26 18:04:05+0000,,\r\n`
        + 'EAIaIQobChMI8_pQ,Sign-up,2026-10-27 00:00:00+0000,,\r\n',
    );
  });

  test('an iOS click with no gclid goes in the GBRAID or WBRAID column, the first three columns where they always were', () => {
    expect(
      conversionsCsv([
        { kind: 'gbraid', id: '0AAAAADa3bC9xYzQ_k-1', occurredAt: '2026-11-06T16:14:00.000Z' },
        { kind: 'wbraid', id: 'CkQKCQjw8--2BhCHEjQA', occurredAt: '2026-11-06T17:00:00.000Z' },
      ]),
    ).toBe(
      HEADER
        + ',Sign-up,2026-11-06 16:14:00+0000,0AAAAADa3bC9xYzQ_k-1,\r\n'
        + ',Sign-up,2026-11-06 17:00:00+0000,,CkQKCQjw8--2BhCHEjQA\r\n',
    );
  });

  test("the app's conversion name is written as Google Ads needs it, quoted when it must be", () => {
    expect(conversionsCsv([{ kind: 'gclid', id: 'EAIaIQobChMI8_pQ', occurredAt: '2026-10-27T00:00:00.000Z' }], 'Sign-up, paid')).toBe(
      `${HEADER}EAIaIQobChMI8_pQ,"Sign-up, paid",2026-10-27 00:00:00+0000,,\r\n`,
    );
  });

  test('with no sign-ups yet the file is the column names alone', () => {
    expect(conversionsCsv([])).toBe(HEADER);
  });
});
