import test from 'node:test';
import assert from 'node:assert/strict';

function createBrowserHarness() {
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
  globalThis.confirm = () => true;
  return { listeners, appRoot, storage };
}

function clickEvent(dataset) {
  return {
    target: {
      closest() { return { dataset }; },
    },
  };
}

function changeEvent(dataset, value = '', checked = false) {
  return { target: { dataset, value, checked } };
}

test('app keeps the existing distribution workflow after merging setup sections', async () => {
  const { listeners, appRoot } = createBrowserHarness();

  await import(`../src/app.js?smoke=${Date.now()}`);
  assert.match(appRoot.innerHTML, /قِسطاس/);
  assert.match(appRoot.innerHTML, /إعداد خطة التوزيع/);
  assert.match(appRoot.innerHTML, /ماذا تريد أن توزّع؟/);
  assert.match(appRoot.innerHTML, /عدد المعلمين/);
  assert.match(appRoot.innerHTML, /الشعب والحصص/);
  assert.match(appRoot.innerHTML, /الخطوة 1 من 3/);
  assert.match(appRoot.innerHTML, /الإصدار 1\.2\.0/);
  assert.doesNotMatch(appRoot.innerHTML, /Gemini|Supabase/);

  const click = listeners.get('click');
  await click(clickEvent({ action: 'step', id: '1' }));
  assert.match(appRoot.innerHTML, /<h2>المعلمون<\/h2>/);
  assert.match(appRoot.innerHTML, /تخصصه في صف واحد/);
  assert.match(appRoot.innerHTML, /الدور/);

  await click(clickEvent({ action: 'step', id: '2' }));
  assert.match(appRoot.innerHTML, /نماذج التوزيع/);
  await click(clickEvent({ action: 'generate' }));
  assert.match(appRoot.innerHTML, /عثر قِسطاس على 20 نموذجًا/);
  assert.match(appRoot.innerHTML, /النموذج 1 من 20/);
  assert.match(appRoot.innerHTML, /نماذج إضافية/);
  assert.match(appRoot.innerHTML, /اعتماد مبدئي وتعديل/);

  await click(clickEvent({ action: 'generate-more' }));
  assert.match(appRoot.innerHTML, /عثر قِسطاس على 40 نموذجًا/);

  await click(clickEvent({ action: 'adopt-model' }));
  assert.match(appRoot.innerHTML, /الخطة قيد التعديل/);
  assert.match(appRoot.innerHTML, /أعد توزيع غير المثبت/);

  const lockMatch = appRoot.innerHTML.match(/data-action="toggle-teacher-lock" data-id="([^"]+)"/);
  assert.ok(lockMatch);
  await click(clickEvent({ action: 'toggle-teacher-lock', id: lockMatch[1] }));
  assert.match(appRoot.innerHTML, /مثبت · فك/);

  await click(clickEvent({ action: 'rebalance-draft' }));
  assert.match(appRoot.innerHTML, /حافظ قِسطاس على/);
});

test('choosing one subject prepares a clean isolated plan and teacher list', async () => {
  const { listeners, appRoot, storage } = createBrowserHarness();
  await import(`../src/app.js?scope=${Date.now()}`);
  const change = listeners.get('change');
  const click = listeners.get('click');

  change(changeEvent({ planScope: 'mode' }, 'single'));
  change(changeEvent({ planScope: 'subjectId' }, 'arabic'));
  change(changeEvent({ planScope: 'teacherCount' }, '4'));
  change(changeEvent({ planScopeCheck: 'hasLead' }, '', true));
  await click(clickEvent({ action: 'apply-plan-configuration' }));

  assert.match(appRoot.innerHTML, /تم إنشاء خطة مستقلة لمادة أو قسم «اللغة العربية»/);
  assert.match(appRoot.innerHTML, /اللغة العربية/);
  assert.doesNotMatch(appRoot.innerHTML, /data-path="req:[^"]+:subject"[^>]*>[^<]*الفيزياء/);

  const saved = JSON.parse(storage.get('qistas:v1'));
  assert.equal(saved.planScope.mode, 'single');
  assert.equal(saved.planScope.subjectId, 'arabic');
  assert.equal(saved.teachers.length, 4);
  assert.equal(saved.teachers.filter((teacher) => teacher.isLead).length, 1);
  assert.ok(saved.teachers.every((teacher) => teacher.specialty === 'اللغة العربية'));
  assert.ok(saved.requirements.length > 0);
  assert.ok(saved.requirements.every((requirement) => requirement.subject === 'اللغة العربية'));

  await click(clickEvent({ action: 'step', id: '1' }));
  assert.equal((appRoot.innerHTML.match(/class="teacher-editor /g) || []).length, 4);
  assert.match(appRoot.innerHTML, /readonly aria-readonly="true"/);
});


test('saved plans can be stored and removed without changing the open plan', async () => {
  const { listeners, appRoot, storage } = createBrowserHarness();
  await import(`../src/app.js?plans=${Date.now()}`);
  const click = listeners.get('click');
  const change = listeners.get('change');

  await click(clickEvent({ action: 'save-plan' }));
  const plans = JSON.parse(storage.get('qistas:plans:v1'));
  assert.equal(plans.length, 1);
  assert.match(appRoot.innerHTML, /تم حفظ الخطة/);

  change(changeEvent({ planLibrarySelect: '' }, plans[0].id));
  await click(clickEvent({ action: 'delete-saved-plan' }));

  assert.deepEqual(JSON.parse(storage.get('qistas:plans:v1')), []);
  assert.match(appRoot.innerHTML, /بقيت الخطة المفتوحة دون تغيير/);
  assert.match(appRoot.innerHTML, /قسم العلوم/);
});
