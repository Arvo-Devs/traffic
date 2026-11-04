/**
 * The two files that ship outside the Traffic page stay small. The counter is
 * on every public page, so it may import only React, next/navigation and the
 * counted-pages rule beside it. The notes are imported by sign-up forms, so
 * they bring no React and nothing but the found-via types. The notes are also
 * fire and forget, to the routes under the base path.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { noteFoundVia, noteSignup } from '../src/notes';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Every module a file asks for: static imports and re-exports, import(), require(). */
function specifiers(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm)) found.add(match[1]!);
  for (const match of code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) found.add(match[1]!);
  for (const match of code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g)) found.add(match[1]!);
  return [...found].sort();
}

describe('src/counter.tsx', () => {
  const code = source('../src/counter.tsx');

  test('imports nothing beyond react, next/navigation and ./paths', () => {
    expect(specifiers(code)).toEqual(['./paths', 'next/navigation', 'react']);
    expect(code).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
  });

  test('sends its notes as text/plain, by beacon and by the fetch behind it', () => {
    expect(code).toContain("new Blob([body], { type: 'text/plain;charset=UTF-8' })");
    expect(code).toContain("headers: { 'content-type': 'text/plain;charset=UTF-8' }");
    expect(code).toContain('keepalive: true');
    expect(code).not.toContain('application/json');
  });
});

describe('src/notes.ts', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('imports only the found-via types, and no React', () => {
    const code = source('../src/notes.ts');
    expect(specifiers(code)).toEqual(['./shared/found-via']);
    expect(code).toMatch(/^import type \{[^}]+\} from '\.\/shared\/found-via';$/m);
    expect(code).not.toMatch(/^'use client'/m);
  });

  test('noteSignup and noteFoundVia post to the routes, fire and forget', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.reject(new Error('offline'));
    }) as unknown as typeof fetch;

    expect(noteSignup()).toBeUndefined();
    noteFoundVia({ answer: 'other', other: 'A newsletter' });
    noteSignup('/admin/traffic/');
    noteFoundVia({ answer: 'skipped', other: null }, '/admin/traffic');
    // A refused request is swallowed: nothing throws, now or once it settles.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      ['/api/traffic/signup', 'POST'],
      ['/api/traffic/found-via', 'POST'],
      ['/admin/traffic/signup', 'POST'],
      ['/admin/traffic/found-via', 'POST'],
    ]);
    expect(calls.every((c) => c.init.keepalive === true && c.init.credentials === 'same-origin')).toBe(true);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ answer: 'other', other: 'A newsletter' });
    expect((calls[1]!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});
