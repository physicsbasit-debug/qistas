import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the browser app has no active Gemini or Supabase integration', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestGeminiReview/);
  assert.doesNotMatch(source, /supabase-url/);
  assert.doesNotMatch(source, /supabase-anon-key/);
  assert.doesNotMatch(source, /data-action="gemini"/);
  assert.match(source, /analyzeDistributionFeasibility/);
  assert.match(source, /عرض توزيع جزئي للتشخيص/);
  assert.match(source, /لا يمكن إنشاء توزيع مكتمل بالبيانات الحالية/);
});


test('the build script excludes the dormant Gemini service from GitHub Pages', async () => {
  const source = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /geminiReview\.js/);
  assert.match(source, /await rm/);
});

test('package version is 1.3.1', async () => {
  const source = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(source).version, '1.3.1');
});
