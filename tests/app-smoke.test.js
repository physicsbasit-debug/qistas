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
  assert.doesNotMatch(appRoot.innerHTML, /Gemini|Supabase/);
  assert.match(appRoot.innerHTML, /الإصدار 0\.9\.0/);

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
  assert.match(appRoot.innerHTML, /اعتماد مبدئي وتعديل/);

  await click({
    target: {
      closest() { return { dataset: { action: 'generate-more' } }; },
    },
  });
  assert.match(appRoot.innerHTML, /عثر قِسطاس على 40 نموذجًا/);
  assert.match(appRoot.innerHTML, /النموذج \d+ من 40/);

  await click({
    target: {
      closest() { return { dataset: { action: 'adopt-model' } }; },
    },
  });
  assert.match(appRoot.innerHTML, /الخطة قيد التعديل/);
  assert.match(appRoot.innerHTML, /أعد توزيع غير المثبت/);
  assert.match(appRoot.innerHTML, /تثبيت التوزيع/);

  const lockMatch = appRoot.innerHTML.match(/data-action="toggle-teacher-lock" data-id="([^"]+)"/);
  assert.ok(lockMatch);
  const lockedTeacherId = lockMatch[1];
  await click({
    target: {
      closest() { return { dataset: { action: 'toggle-teacher-lock', id: lockedTeacherId } }; },
    },
  });
  assert.match(appRoot.innerHTML, /مثبت · فك/);

  await click({
    target: {
      closest() { return { dataset: { action: 'rebalance-draft' } }; },
    },
  });
  assert.match(appRoot.innerHTML, /حافظ قِسطاس على/);

  await click({
    target: {
      closest() { return { dataset: { action: 'toggle-teacher-lock', id: lockedTeacherId } }; },
    },
  });
  const taskMatch = appRoot.innerHTML.match(/data-action="select-transfer" data-task-id="([^"]+)"/);
  assert.ok(taskMatch);
  await click({
    target: {
      closest() { return { dataset: { action: 'select-transfer', taskId: taskMatch[1] } }; },
    },
  });
  assert.match(appRoot.innerHTML, /نقل شعبة/);
  const moveMatch = appRoot.innerHTML.match(/data-action="move-task" data-task-id="([^"]+)" data-teacher-id="([^"]+)"/);
  assert.ok(moveMatch);
  await click({
    target: {
      closest() { return { dataset: { action: 'move-task', taskId: moveMatch[1], teacherId: moveMatch[2] } }; },
    },
  });
  assert.match(appRoot.innerHTML, /تم نقل/);
  assert.match(appRoot.innerHTML, /مثبتة/);

  const resumedRoot = {
    innerHTML: '',
    addEventListener() {},
  };
  globalThis.document = {
    querySelector(selector) {
      if (selector === '#app') return resumedRoot;
      return { value: '' };
    },
  };
  await import(`../src/app.js?resume=${Date.now()}`);
  assert.match(resumedRoot.innerHTML, /الخطة قيد التعديل/);
  assert.match(resumedRoot.innerHTML, /مثبتة/);
});
