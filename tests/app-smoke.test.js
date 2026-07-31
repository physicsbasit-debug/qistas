import test from 'node:test';
import assert from 'node:assert/strict';

test('app renders simplified controls and multiple-model results without browser errors', async () => {
  const listeners = new Map();
  const appRoot = {
    innerHTML: '',
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  const storage = new Map();

  globalThis.document = {
    querySelector(selector) {
      if (selector === '#app') return appRoot;
      return { value: '' };
    },
  };
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  globalThis.window = { print() {} };

  await import(`../src/app.js?smoke=${Date.now()}`);
  assert.match(appRoot.innerHTML, /قِسطاس/);
  assert.match(appRoot.innerHTML, /سقف الأنصبة/);
  assert.match(appRoot.innerHTML, /الإصدار 0\.5/);

  const click = listeners.get('click');
  await click({
    target: {
      closest() { return { dataset: { action: 'step', id: '1' } }; },
    },
  });

  assert.match(appRoot.innerHTML, /<h2>المعلمون<\/h2>/);
  assert.match(appRoot.innerHTML, /تخصصه في صف واحد/);
  assert.match(appRoot.innerHTML, /الدور/);
  assert.doesNotMatch(appRoot.innerHTML, /المستهدف<input/);
  assert.doesNotMatch(appRoot.innerHTML, /مسموح عند الحاجة/);

  await click({
    target: {
      closest() { return { dataset: { action: 'step', id: '3' } }; },
    },
  });
  assert.match(appRoot.innerHTML, /نماذج التوزيع/);

  await click({
    target: {
      closest() { return { dataset: { action: 'generate' } }; },
    },
  });

  assert.match(appRoot.innerHTML, /عثر قِسطاس على 20 نموذجًا/);
  assert.match(appRoot.innerHTML, /النموذج 1 من 20/);
  assert.match(appRoot.innerHTML, /نماذج إضافية/);
  assert.match(appRoot.innerHTML, /مقارنة أفضل 8 نماذج/);

  await click({
    target: {
      closest() { return { dataset: { action: 'generate-more' } }; },
    },
  });
  assert.match(appRoot.innerHTML, /عثر قِسطاس على 40 نموذجًا/);
  assert.match(appRoot.innerHTML, /النموذج \d+ من 40/);
});
