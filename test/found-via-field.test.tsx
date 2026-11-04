/**
 * "How did you find us?" on the first screen a new account sees: one named
 * group of choices, nothing picked until the person picks, big enough to tap
 * on a phone, and a box for the words only after Something else. Ported from
 * BetterFans Link's tests/app/found-via-field.test.tsx (main d4138f9).
 */
import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { FoundViaField } from '../src/client';
import { DEFAULT_FOUND_VIA_ANSWERS, FOUND_VIA_OTHER, type FoundViaChoice } from '../src/shared/found-via';

const render = (value: string | null, answers?: readonly FoundViaChoice[]) =>
  renderToString(<FoundViaField value={value} onChange={() => {}} other="" onOtherChange={() => {}} answers={answers} />).replaceAll('<!-- -->', '');

test('every answer is a choice in one group named by the question', () => {
  const html = render(null);
  const labelId = /<p id="([^"]+)"[^>]*><span>How did you find us\?<\/span>/.exec(html)?.[1];
  expect(labelId).toBeTruthy();
  expect(html).toContain(`role="radiogroup" aria-labelledby="${labelId}"`);
  expect(html).toContain('>Optional<');
  const radios = html.match(/<input type="radio"[^>]*>/g) ?? [];
  expect(radios).toHaveLength(DEFAULT_FOUND_VIA_ANSWERS.length);
  expect(new Set(radios.map((r) => /name="([^"]+)"/.exec(r)?.[1])).size).toBe(1);
  for (const answer of DEFAULT_FOUND_VIA_ANSWERS) expect(html).toContain(answer.label);
});

test('nothing is picked until the person picks, and a pick is checked', () => {
  expect(render(null)).not.toContain('checked');
  const picked = (render('friend').match(/<input type="radio"[^>]*>/g) ?? []).filter((r) => r.includes('checked'));
  expect(picked).toHaveLength(1);
  expect(picked[0]).toContain('value="friend"');
});

test('each choice is at least 40 px tall on a phone', () => {
  const labels = render(null).match(/<label class="([^"]*)"/g) ?? [];
  expect(labels).toHaveLength(DEFAULT_FOUND_VIA_ANSWERS.length);
  for (const label of labels) expect(label).toContain('max-sm:h-10');
});

test('the box for the words shows only after Something else, at 16 px on a phone', () => {
  expect(render('google')).not.toContain('aria-label="Where did you find us?"');
  const box = /<input[^>]*aria-label="Where did you find us\?"[^>]*>/.exec(render(FOUND_VIA_OTHER))?.[0] ?? '';
  expect(box).toContain('maxLength="120"');
  expect(box).toContain('max-sm:text-base');
});

test("an app's own answers replace the default list, and an answer's words render as text", () => {
  const answers = [
    { value: 'podcast', label: 'A podcast' },
    { value: 'other', label: '<b>Somewhere</b> else' },
  ];
  const html = render('podcast', answers);
  expect(html.match(/<input type="radio"[^>]*>/g) ?? []).toHaveLength(2);
  expect(html).toContain('A podcast');
  expect(html).not.toContain('Google');
  expect(html).not.toContain('<b>');
  expect(html).toContain('&lt;b&gt;Somewhere&lt;/b&gt; else');
  expect(render('other', answers)).toContain('aria-label="Where did you find us?"');
});
