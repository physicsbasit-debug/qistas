import test from 'node:test';
import assert from 'node:assert/strict';

test('app renders setup and teacher controls without a browser runtime error', async () => {
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
  assert.match(appRoot.innerHTML, /بيانات الخطة/);

  const click = listeners.get('click');
  await click({
    target: {
      closest() { return { dataset: { action: 'step', id: '1' } }; },
    },
  });

  assert.match(appRoot.innerHTML, /المعلمون والتحكم في التوزيع/);
  assert.match(appRoot.innerHTML, /تخصصه في صف واحد فقط/);
  assert.match(appRoot.innerHTML, /تطبيقه على نفس التخصص/);
});
