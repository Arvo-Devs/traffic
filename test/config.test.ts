/**
 * Reading the app's config once: defaults, hosts in lower case, the checks
 * that make a config that could never work fail at the first request.
 */
import { describe, expect, test } from 'bun:test';
import { normalizeConfig } from '../src/config';
import { DEFAULT_FOUND_VIA_ANSWERS } from '../src/shared/found-via';
import { fakeConfig } from './fake-app';

describe('the config', () => {
  test('the defaults: /api/traffic, /sign-up, the home page for links, the default answers', () => {
    const config = normalizeConfig(fakeConfig());
    expect(config.basePath).toBe('/api/traffic');
    expect(config.signupPath).toBe('/sign-up');
    expect(config.linkPages).toEqual([{ value: '/', label: 'Home' }]);
    expect(config.foundViaAnswers).toBe(DEFAULT_FOUND_VIA_ANSWERS);
    expect(config.siteUrl).toBe('https://example.com');
    expect(config.accounts).toBeNull();
    expect(config.isPage).toBeNull();
    expect([...config.staffEmails()]).toEqual([]);
    expect(config.country(new Request('https://example.com/'))).toBeNull();
  });

  test('hosts are lower case and listed once, and emails are matched in lower case', () => {
    const config = normalizeConfig(fakeConfig({ siteHosts: [' Example.COM ', 'example.com', 'WWW.example.com', ''], staffEmails: () => [' Admin@Example.com ', ''] }));
    expect(config.siteHosts).toEqual(['example.com', 'www.example.com']);
    expect([...config.staffEmails()]).toEqual(['admin@example.com']);
  });

  test('basePath is read with or without its slashes', () => {
    expect(normalizeConfig(fakeConfig({ basePath: 'api/stats/' })).basePath).toBe('/api/stats');
    expect(normalizeConfig(fakeConfig({ basePath: '/' })).basePath).toBe('');
  });

  test("the app's own sources are read in lower case, without www.", () => {
    const config = normalizeConfig(fakeConfig({ sources: { hosts: { 'WWW.Partner.Example': ' Partner ', 'empty.example': ' ' }, utm: { ' PT-News ': 'Partner' } } }));
    expect(config.sources).toEqual({ hosts: { 'partner.example': 'Partner' }, utm: { 'pt-news': 'Partner' } });
  });

  test('a config that could never work fails when it is read', () => {
    expect(() => normalizeConfig(fakeConfig({ siteHosts: [] }))).toThrow('siteHosts');
    expect(() => normalizeConfig(fakeConfig({ siteUrl: 'example.com' }))).toThrow('siteUrl');
    expect(() => normalizeConfig(fakeConfig({ siteUrl: 'ftp://example.com' }))).toThrow('siteUrl');
    expect(() => normalizeConfig(fakeConfig({ signupPath: 'sign-up' }))).toThrow('signupPath');
  });

  test('staffEmails without accounts is said once: the team cannot be told apart', () => {
    const logs: string[] = [];
    normalizeConfig(fakeConfig({ googleAds: { user: 'google-ads', password: 'k3Vq9xT2mP7wR4zL8nB5cY1d' }, staffEmails: () => ['admin@example.com'], log: (line) => logs.push(line) }));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('staffEmails needs accounts');
  });
});
