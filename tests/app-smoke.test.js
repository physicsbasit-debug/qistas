import test from 'node:test';
import assert from 'node:assert/strict';

function createBrowserHarness(initialStorage = {}) {
  const listeners = new Map();
  const appRoot = {
    innerHTML: '',
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  const storage = new Map(Object.entries(initialStorage));

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
  assert.match(appRoot.innerHTML, /الإصدار 1\.3\.3/);
  assert.match(appRoot.innerHTML, /خطّط الأنصبة بوضوح/);
  assert.match(appRoot.innerHTML, /واعتمد التوزيع بثقة/);
  assert.match(appRoot.innerHTML, /إجمالي الحصص الأسبوعية/);
  assert.match(appRoot.innerHTML, /تكليفًا تدريسيًا/);
  assert.doesNotMatch(appRoot.innerHTML, /Gemini|Supabase/);
  assert.doesNotMatch(appRoot.innerHTML, /مواد أساسية|المهارات والفنون/);
  assert.doesNotMatch(appRoot.innerHTML, /تحديث عدد بطاقات المعلمين فقط/);
  assert.doesNotMatch(appRoot.innerHTML, /نظام الدوام|فترة واحدة|فترتان/);
  assert.doesNotMatch(appRoot.innerHTML, /data-path="root::planName"/);
  assert.match(appRoot.innerHTML, /اسم الخطة تلقائيًا/);
  assert.match(appRoot.innerHTML, /توزيع أنصبة قسم العلوم/);

  const click = listeners.get('click');
  await click(clickEvent({ action: 'step', id: '1' }));
  assert.match(appRoot.innerHTML, /<h2>المعلمون<\/h2>/);
  assert.match(appRoot.innerHTML, /تخصصه في صف واحد/);
  assert.match(appRoot.innerHTML, /الدور/);

  await click(clickEvent({ action: 'step', id: '2' }));
  assert.match(appRoot.innerHTML, /نماذج التوزيع/);
  await click(clickEvent({ action: 'generate' }));
  assert.match(appRoot.innerHTML, /تنزيل PDF رسمي/);
  assert.match(appRoot.innerHTML, /عثر قِسطاس على نموذج واحد مختلف/);
  assert.match(appRoot.innerHTML, /النموذج 1 من 1/);
  assert.match(appRoot.innerHTML, /نموذج بديل/);
  assert.match(appRoot.innerHTML, /اعتماد مبدئي وتعديل/);

  await click(clickEvent({ action: 'generate-more' }));
  assert.match(appRoot.innerHTML, /عثر قِسطاس على نموذجين مختلفين/);
  assert.match(appRoot.innerHTML, /النموذج 2 من 2/);

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

  assert.match(appRoot.innerHTML, /تم إعداد خطة مستقلة لـ«اللغة العربية» وتهيئة 4 معلمين لها/);
  assert.match(appRoot.innerHTML, /اللغة العربية/);
  assert.doesNotMatch(appRoot.innerHTML, /data-path="req:[^"]+:subject"[^>]*>[^<]*الفيزياء/);

  const saved = JSON.parse(storage.get('qistas:v1'));
  assert.equal(saved.planScope.mode, 'single');
  assert.equal(saved.planScope.subjectId, 'arabic');
  assert.equal(saved.planName, 'توزيع أنصبة مادة اللغة العربية');
  assert.equal(saved.teachers.length, 4);
  assert.equal(saved.teachers.filter((teacher) => teacher.isLead).length, 1);
  assert.ok(saved.teachers.every((teacher) => teacher.specialty === 'اللغة العربية'));
  assert.equal(saved.teachers[0].name, 'المعلم الأول');
  assert.ok(saved.teachers.slice(1).every((teacher) => teacher.name.includes('اللغة العربية')));
  assert.ok(saved.teachers.every((teacher) => !teacher.name.includes('أحياء')));
  assert.ok(saved.requirements.length > 0);
  assert.ok(saved.requirements.every((requirement) => requirement.subject === 'اللغة العربية'));

  await click(clickEvent({ action: 'step', id: '1' }));
  assert.equal((appRoot.innerHTML.match(/class="teacher-editor /g) || []).length, 4);
  assert.match(appRoot.innerHTML, /readonly aria-readonly="true"/);
  assert.doesNotMatch(appRoot.innerHTML, /نسخ الإعداد لزملاء التخصص/);
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


test('stored placeholder teacher names are repaired to the active single subject on startup', async () => {
  const legacy = {
    planId: 'islamic-plan',
    planName: 'التربية الإسلامية',
    schoolName: 'مدرسة اختبار',
    departmentName: 'التربية الإسلامية',
    academicYear: '2026/2027',
    gradeRange: { start: 8, end: 10 },
    planScope: {
      mode: 'single',
      templateId: 'islamic',
      subjectId: 'islamic',
      selectedSubjectIds: ['islamic'],
      teacherCount: 3,
      hasLead: true,
    },
    settings: { teacherMaxLoad: 18, leadMaxLoad: 14, schoolShift: 'single' },
    requirements: [
      { id: 'islamic-8', grade: 'الثامن', subject: 'التربية الإسلامية', sections: 8, periodsPerSection: 3 },
    ],
    teachers: [
      { id: 't1', name: 'المعلم الأول', specialty: 'التربية الإسلامية', isLead: true, active: true },
      { id: 't2', name: 'معلم أحياء 1', specialty: 'التربية الإسلامية', isLead: false, active: true },
      { id: 't3', name: 'معلم أحياء 2', specialty: 'التربية الإسلامية', isLead: false, active: true },
    ],
  };
  const { storage } = createBrowserHarness({ 'qistas:v1': JSON.stringify(legacy) });
  await import(`../src/app.js?repair=${Date.now()}`);
  const saved = JSON.parse(storage.get('qistas:v1'));
  assert.equal(saved.planName, 'توزيع أنصبة مادة التربية الإسلامية');
  assert.equal(saved.teachers[0].name, 'المعلم الأول');
  assert.equal(saved.teachers[1].name, 'معلم التربية الإسلامية 1');
  assert.equal(saved.teachers[2].name, 'معلم التربية الإسلامية 2');
});
