import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Gemini review accepts dynamic model ids and omits deprecated sampling parameters', async () => {
  const source = await readFile(
    new URL('../supabase/functions/review-distribution/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /recommendedScenario: \{ type: 'string' \}/);
  assert.doesNotMatch(source, /temperature\s*:/);
  assert.match(source, /gemini-3\.6-flash/);
});

test('package version is 0.5.0', async () => {
  const source = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(source).version, '0.5.0');
});
