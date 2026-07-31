import { seedData } from './data/seed.js';
import {
  ASSIGNMENT_STATUS,
  buildInitialCustomSelection,
  createDefaultAssignmentPolicy,
  describeAssignmentPolicy,
  normalizeAssignmentPolicy,
  POLICY_MODES,
  requirementLabel,
} from './domain/assignmentPolicy.js';
import {
  generateDistributionModels,
  rankDistributionModels,
  validateInputs,
} from './engine/distribution.js';
import { clearAppData, clone, loadAppData, saveAppData } from './services/storage.js';
import { exportScenarioCsv } from './services/export.js';

const app = document.querySelector('#app');
const MODEL_BATCH_SIZE = 20;
const MAX_DISPLAY_MODELS = 100;

let state = {
  step: 0,
  data: loadAppData(seedData),
  scenarios: [],
  selectedId: 'balanced',
  errors: [],
  notice: '',
  generating: false,
  generationRound: 0,
  searchStats: { attempts: 0, uniqueFound: 0, completeFound: 0 },
};

const esc = (value = '') => String(value).replace(
  /[&<>'"]/g,
  (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]),
);

const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`;
const totalPeriods = () => state.data.requirements.reduce(
  (sum, item) => sum + Number(item.sections) * Number(item.periodsPerSection),
  0,
);
const totalSections = () => state.data.requirements.reduce(
  (sum, item) => sum + Number(item.sections),
  0,
);
const selected = () => state.scenarios.find((scenario) => scenario.id === state.selectedId)
  || state.scenarios[0];

function invalidateResults() {
  state.scenarios = [];
  state.errors = [];
  state.generationRound = 0;
  state.searchStats = { attempts: 0, uniqueFound: 0, completeFound: 0 };
}

function persistRender() {
  saveAppData(state.data);
  render();
}

function updateData(path, value) {
  const [kind, id, field] = path.split(':');

  if (kind === 'root') state.data[field] = value;

  if (kind === 'settings') {
    state.data.settings[field] = Number(value);
  }

  if (kind === 'teacher') {
    const teacher = state.data.teachers.find((item) => item.id === id);
    if (!teacher) return;
    if (field === 'isLead') teacher[field] = value === 'true';
    else teacher[field] = value;
  }

  if (kind === 'req') {
    const requirement = state.data.requirements.find((item) => item.id === id);
    if (!requirement) return;
    requirement[field] = ['sections', 'periodsPerSection'].includes(field)
      ? Number(value)
      : value;
  }

  invalidateResults();
  saveAppData(state.data);
}

function teacherPolicy(teacher) {
  teacher.assignmentPolicy = normalizeAssignmentPolicy(teacher.assignmentPolicy);
  return teacher.assignmentPolicy;
}

function specialtyGrades(teacher) {
  return [...new Set(state.data.requirements
    .filter((requirement) => requirement.subject === teacher.specialty)
    .map((requirement) => requirement.grade)
    .filter(Boolean))];
}

function defaultRequirement(teacher, extraOnly = false) {
  return state.data.requirements.find((requirement) => (
    !extraOnly || requirement.subject !== teacher.specialty
  )) ?? state.data.requirements[0];
}

function setPolicyMode(teacher, mode) {
  const policy = teacherPolicy(teacher);
  policy.mode = mode;

  if (mode === POLICY_MODES.SPECIALTY_GRADE) {
    const grades = specialtyGrades(teacher);
    if (!grades.includes(policy.grade)) policy.grade = grades[0] || '';
  }

  if (mode === POLICY_MODES.SINGLE_REQUIREMENT) {
    if (!state.data.requirements.some((requirement) => requirement.id === policy.requirementId)) {
      policy.requirementId = defaultRequirement(teacher)?.id || '';
    }
  }

  if (mode === POLICY_MODES.SPECIALTY_PLUS_EXTRA) {
    if (!state.data.requirements.some((requirement) => requirement.id === policy.extraRequirementId)) {
      policy.extraRequirementId = defaultRequirement(teacher, true)?.id || '';
    }
  }

  if (mode === POLICY_MODES.CUSTOM && !policy.selectedRequirementIds.length) {
    policy.selectedRequirementIds = buildInitialCustomSelection(teacher, state.data.requirements);
  }
}

function setupPanel() {
  return `
    <section class="panel stack-lg">
      <div>
        <p class="eyebrow">الخطوة الأولى</p>
        <h2>بيانات الخطة</h2>
        <p class="muted">أدخل اسم المدرسة واضبط سقف النصاب مرة واحدة. التطبيق يتولى الموازنة، فلا حاجة لهدف وأدنى وأعلى لكل معلم.</p>
      </div>

      <div class="form-grid two">
        <label>اسم المدرسة
          <input data-path="root::schoolName" value="${esc(state.data.schoolName)}">
        </label>
        <label>القسم أو المجال
          <input data-path="root::departmentName" value="${esc(state.data.departmentName)}">
        </label>
      </div>

      <div class="simple-settings">
        <div>
          <strong>سقف الأنصبة</strong>
          <p class="muted">إعداد عام، ويمكن تغييره في أي وقت.</p>
        </div>
        <label>المعلم
          <input type="number" min="1" data-path="settings::teacherMaxLoad" value="${state.data.settings.teacherMaxLoad}">
        </label>
        <label>المعلم الأول
          <input type="number" min="1" data-path="settings::leadMaxLoad" value="${state.data.settings.leadMaxLoad}">
        </label>
      </div>

      <div class="kpi-grid">
        <article class="kpi"><span>المعلمون النشطون</span><strong>${state.data.teachers.filter((teacher) => teacher.active).length}</strong></article>
        <article class="kpi"><span>الشعب والمقررات</span><strong>${totalSections()}</strong></article>
        <article class="kpi"><span>إجمالي الحصص</span><strong>${totalPeriods()}</strong></article>
      </div>

      <div class="note">البيانات ومحركات التوزيع تعمل محليًا داخل المتصفح، دون حساب خارجي أو اتصال سحابي.</div>
    </section>`;
}

const policyModeLabels = [
  [POLICY_MODES.SPECIALTY_ONLY, 'تخصصه في جميع الصفوف'],
  [POLICY_MODES.SPECIALTY_GRADE, 'تخصصه في صف واحد'],
  [POLICY_MODES.SINGLE_REQUIREMENT, 'صف ومادة فقط'],
  [POLICY_MODES.SPECIALTY_PLUS_EXTRA, 'تخصصه + صف ومادة إضافيان'],
  [POLICY_MODES.CUSTOM, 'اختيار يدوي بسيط'],
];

function requirementOptions(selectedId = '', filter = () => true) {
  const available = state.data.requirements.filter(filter);
  if (!available.length) return '<option value="">لا يوجد خيار إضافي متاح</option>';
  return available.map((requirement) => `
    <option value="${esc(requirement.id)}" ${requirement.id === selectedId ? 'selected' : ''}>
      ${esc(requirementLabel(requirement))}
    </option>`).join('');
}

function policyContext(teacher) {
  const policy = teacherPolicy(teacher);

  if (policy.mode === POLICY_MODES.SPECIALTY_GRADE) {
    const grades = specialtyGrades(teacher);
    return `
      <label class="policy-context-label">الصف
        <select data-policy-field="${teacher.id}:grade">
          ${grades.length
    ? grades.map((grade) => `<option value="${esc(grade)}" ${grade === policy.grade ? 'selected' : ''}>${esc(grade)}</option>`).join('')
    : '<option value="">لا يوجد صف مطابق للتخصص</option>'}
        </select>
      </label>`;
  }

  if (policy.mode === POLICY_MODES.SINGLE_REQUIREMENT) {
    return `
      <label class="policy-context-label">اختر الصف والمادة
        <select data-policy-field="${teacher.id}:requirementId">
          ${requirementOptions(policy.requirementId)}
        </select>
      </label>`;
  }

  if (policy.mode === POLICY_MODES.SPECIALTY_PLUS_EXTRA) {
    return `
      <label class="policy-context-label">الإضافة
        <select data-policy-field="${teacher.id}:extraRequirementId">
          ${requirementOptions(policy.extraRequirementId, (requirement) => requirement.subject !== teacher.specialty)}
        </select>
      </label>`;
  }

  if (policy.mode === POLICY_MODES.CUSTOM) {
    const selectedIds = new Set(policy.selectedRequirementIds);
    return `
      <div class="simple-selection">
        <strong>اختر ما يمكن للمعلم تدريسه</strong>
        <p class="muted">المحدد مسموح، وغير المحدد ممنوع. بهذه البساطة، دون ألوان إشارات المرور.</p>
        <div class="selection-grid">
          ${state.data.requirements.map((requirement) => `
            <label class="selection-item ${selectedIds.has(requirement.id) ? 'selected' : ''}">
              <input type="checkbox" data-policy-selection="${teacher.id}:${requirement.id}" ${selectedIds.has(requirement.id) ? 'checked' : ''}>
              <span>${esc(requirementLabel(requirement))}</span>
            </label>`).join('') || '<p class="muted">أضف الصفوف والمواد أولًا.</p>'}
        </div>
      </div>`;
  }

  return '';
}

function teacherEditor(teacher) {
  const policy = teacherPolicy(teacher);
  return `
    <article class="teacher-editor ${teacher.active ? '' : 'inactive'}">
      <header class="teacher-editor-header">
        <div class="teacher-title">
          <span class="teacher-avatar">${esc((teacher.name || 'م').trim().slice(0, 1))}</span>
          <div>
            <strong>${esc(teacher.name || 'معلم جديد')}</strong>
            <small>${esc(teacher.specialty || 'لم يحدد التخصص')}${teacher.isLead ? ' · معلم أول' : ''}</small>
          </div>
        </div>
        <div class="teacher-header-actions">
          <label class="switch-label"><input type="checkbox" data-check="teacher:${teacher.id}:active" ${teacher.active ? 'checked' : ''}> نشط</label>
          <button class="icon-button danger" title="حذف المعلم" data-action="delete-teacher" data-id="${teacher.id}">×</button>
        </div>
      </header>

      <div class="teacher-simple-grid">
        <label>اسم المعلم
          <input data-path="teacher:${teacher.id}:name" value="${esc(teacher.name)}">
        </label>
        <label>التخصص
          <input data-path="teacher:${teacher.id}:specialty" value="${esc(teacher.specialty)}">
        </label>
        <label>الدور
          <select data-path="teacher:${teacher.id}:isLead">
            <option value="false" ${teacher.isLead ? '' : 'selected'}>معلم</option>
            <option value="true" ${teacher.isLead ? 'selected' : ''}>معلم أول</option>
          </select>
        </label>
        <label>طريقة التوزيع
          <select data-policy-field="${teacher.id}:mode">
            ${policyModeLabels.map(([value, label]) => `<option value="${value}" ${policy.mode === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="policy-box simplified">
        <div class="policy-summary-row">
          <div>
            <small>سيُسند إليه</small>
            <strong>${esc(describeAssignmentPolicy(teacher, state.data.requirements))}</strong>
          </div>
          <button class="text-button compact" data-action="copy-policy" data-id="${teacher.id}">تطبيق على معلمي ${esc(teacher.specialty || 'التخصص نفسه')}</button>
        </div>
        ${policyContext(teacher)}
      </div>
    </article>`;
}

function teachersPanel() {
  return `
    <section class="panel stack-lg">
      <div class="section-heading">
        <div>
          <p class="eyebrow">الخطوة الثانية</p>
          <h2>المعلمون</h2>
          <p class="muted">لكل معلم اختر طريقة واحدة فقط. لا توجد أهداف نصاب ولا ثلاثة حدود تلاحقك في كل بطاقة.</p>
        </div>
        <button class="button secondary" data-action="add-teacher">إضافة معلم</button>
      </div>
      ${state.notice ? `<div class="alert success">${esc(state.notice)}</div>` : ''}
      <div class="teacher-editor-list">
        ${state.data.teachers.map(teacherEditor).join('')}
      </div>
    </section>`;
}

function requirementsPanel() {
  return `
    <section class="panel stack-lg">
      <div class="section-heading">
        <div>
          <p class="eyebrow">الخطوة الثالثة</p>
          <h2>الصفوف والمواد</h2>
          <p class="muted">كل سطر يحدد صفًا ومادة وعدد الشعب وحصص كل شعبة.</p>
        </div>
        <button class="button secondary" data-action="add-req">إضافة صف ومادة</button>
      </div>
      <div class="table-wrap compact-table">
        <table>
          <thead><tr><th>الصف</th><th>المادة</th><th>عدد الشعب</th><th>حصص الشعبة</th><th>الإجمالي</th><th></th></tr></thead>
          <tbody>
            ${state.data.requirements.map((requirement) => `
              <tr>
                <td><input data-path="req:${requirement.id}:grade" value="${esc(requirement.grade)}"></td>
                <td><input data-path="req:${requirement.id}:subject" value="${esc(requirement.subject)}"></td>
                <td><input class="number" type="number" min="1" data-path="req:${requirement.id}:sections" value="${requirement.sections}"></td>
                <td><input class="number" type="number" min="1" data-path="req:${requirement.id}:periodsPerSection" value="${requirement.periodsPerSection}"></td>
                <td><strong>${Number(requirement.sections) * Number(requirement.periodsPerSection)}</strong></td>
                <td><button class="icon-button danger" data-action="delete-req" data-id="${requirement.id}">×</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="note">بعد تغيير الصفوف أو المواد، راجع المعلمين الذين اخترت لهم صفًا أو مادة محددين.</div>
    </section>`;
}

function modelNavigator(scenario) {
  if (!scenario || !state.scenarios.length) return '';
  const currentIndex = Math.max(0, state.scenarios.findIndex((item) => item.id === scenario.id));
  const canGenerateMore = state.scenarios.length < MAX_DISPLAY_MODELS;
  return `
    <div class="model-navigator no-print">
      <div class="model-position">
        <span>النموذج ${currentIndex + 1} من ${state.scenarios.length}</span>
        <strong>${esc(scenario.tag)}</strong>
      </div>
      <label class="model-select-label">اختر نموذجًا
        <select data-model-select>
          ${state.scenarios.map((model, index) => `
            <option value="${model.id}" ${model.id === scenario.id ? 'selected' : ''}>
              النموذج ${index + 1} · ${esc(model.tag)} · الفرق ${model.loadSpread}
            </option>`).join('')}
        </select>
      </label>
      <div class="actions model-actions">
        <button class="button secondary" data-action="prev-model" ${currentIndex === 0 ? 'disabled' : ''}>السابق</button>
        <button class="button secondary" data-action="next-model" ${currentIndex >= state.scenarios.length - 1 ? 'disabled' : ''}>التالي</button>
        <button class="button primary" data-action="generate-more" ${!canGenerateMore || state.generating ? 'disabled' : ''}>
          ${state.generating ? 'جارٍ البحث…' : 'نماذج إضافية'}
        </button>
      </div>
    </div>`;
}

function modelComparison() {
  if (state.scenarios.length < 2) return '';
  const compared = state.scenarios.slice(0, 8);
  return `
    <details class="model-comparison no-print">
      <summary>مقارنة أفضل ${compared.length} نماذج</summary>
      <div class="table-wrap compact-table top-gap">
        <table>
          <thead><tr><th>النموذج</th><th>التصنيف</th><th>أعلى نصاب</th><th>أقل نصاب</th><th>الفرق</th><th>التشعب</th><th></th></tr></thead>
          <tbody>
            ${compared.map((model, index) => `
              <tr class="${model.id === state.selectedId ? 'selected-model-row' : ''}">
                <td>النموذج ${index + 1}</td>
                <td>${esc(model.tag)}</td>
                <td>${model.highestLoad}</td>
                <td>${model.lowestLoad}</td>
                <td>${model.loadSpread}</td>
                <td>${model.compactness}</td>
                <td><button class="text-button compact" data-action="select-scenario" data-id="${model.id}">عرض</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>`;
}

function resultsPanel() {
  const scenario = selected();
  const assignedPeriods = scenario?.assignments.reduce((sum, item) => sum + item.periods, 0) || 0;

  const unassigned = scenario?.unassigned.length
    ? `<div class="alert error"><strong>هذه الشعب لم تُسند:</strong><div class="chips top-gap">${scenario.unassigned.map((item) => `<span>${esc(item.grade)} / ${item.section} · ${esc(item.subject)} (${item.periods})</span>`).join('')}</div></div>`
    : '';

  const result = scenario ? `
    <div class="panel stack-lg print-area">
      <div class="section-heading">
        <div>
          <p class="eyebrow">النتيجة</p>
          <h2>${esc(scenario.label)} <span class="model-tag">${esc(scenario.tag)}</span></h2>
          <p class="muted">${esc(scenario.description)}</p>
        </div>
        <div class="actions no-print">
          <button class="button secondary" data-action="export">تصدير CSV</button>
          <button class="button secondary" data-action="print">طباعة / PDF</button>
        </div>
      </div>

      ${modelNavigator(scenario)}

      <div class="kpi-grid four">
        <article class="kpi"><span>الحصص المسندة</span><strong>${assignedPeriods}</strong></article>
        <article class="kpi"><span>أعلى نصاب</span><strong>${scenario.highestLoad}</strong></article>
        <article class="kpi"><span>أقل نصاب</span><strong>${scenario.lowestLoad}</strong></article>
        <article class="kpi"><span>الفرق</span><strong>${scenario.loadSpread}</strong></article>
      </div>

      ${scenario.warnings.length ? `<div class="alert warning"><ul>${scenario.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div>` : '<div class="alert success">اكتمل توزيع جميع الشعب داخل الخيارات التي حددتها.</div>'}
      ${scenario.repairedCount ? `<div class="alert success smart-repair-note">أعاد قِسطاس موازنة ${scenario.relocationCount} تكليفات لتغطية ${scenario.repairedCount} شعبة كان يمكن أن تبقى غير مسندة في التوزيع التسلسلي.</div>` : ''}
      ${unassigned}

      <div class="teacher-results">
        ${scenario.summaries.map((summaryItem) => {
    const teacher = state.data.teachers.find((item) => item.id === summaryItem.teacherId);
    if (!teacher) return '';
    const sortedAssignments = [...summaryItem.assignments].sort((a, b) => (
      a.grade.localeCompare(b.grade, 'ar')
      || a.subject.localeCompare(b.subject, 'ar')
      || a.section - b.section
    ));
    return `
            <article class="teacher-card">
              <header>
                <div><h3>${esc(teacher.name)}</h3><p>${esc(teacher.specialty)}${teacher.isLead ? ' · معلم أول' : ''}</p></div>
                <span class="load-badge ${summaryItem.load > summaryItem.maxLoad ? 'over' : ''}">${summaryItem.load} / ${summaryItem.maxLoad} حصة</span>
              </header>
              <div class="chips">
                ${sortedAssignments.map((assignment) => `<span class="${assignment.preference === ASSIGNMENT_STATUS.ALLOWED ? 'flexible' : ''}">${esc(assignment.grade)} / ${assignment.section} · ${esc(assignment.subject)} (${assignment.periods})</span>`).join('') || '<span>لا توجد شعب مسندة</span>'}
              </div>
            </article>`;
  }).join('')}
      </div>

      ${modelComparison()}
    </div>` : '';

  const searchMessage = state.scenarios.length
    ? `<div class="models-found"><strong>عثر قِسطاس على ${state.scenarios.length} نموذجًا مختلفًا${state.searchStats.completeFound ? ' ومكتملًا' : ''}.</strong><span>تم فحص ${state.searchStats.attempts} محاولة توزيع، مع حذف النتائج المكررة تلقائيًا.</span></div>`
    : '';

  return `
    <section class="stack-lg">
      <div class="panel hero-result">
        <div>
          <p class="eyebrow">الخطوة الرابعة</p>
          <h2>نماذج التوزيع</h2>
          <p class="muted">ينشئ قِسطاس أكبر مجموعة عملية من الحلول الصحيحة والمختلفة، ثم يرتبها ويترك الاختيار لك.</p>
        </div>
        <button class="button primary" data-action="generate" ${state.generating ? 'disabled' : ''}>${state.generating ? 'جارٍ البحث عن النماذج…' : 'ولّد نماذج التوزيع'}</button>
      </div>

      ${state.errors.length ? `<div class="alert error"><strong>راجع هذه النقاط:</strong><ul>${state.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul></div>` : ''}
      ${searchMessage}
      ${result}

    </section>`;
}

function render() {
  const steps = ['الإعداد', 'المعلمون', 'الصفوف والمواد', 'التوزيع'];
  app.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-mark">ق</div>
        <div class="brand-copy"><p>قِسطاس</p><span>أنصبة موزونة، توزيع أذكى</span></div>
        <div class="header-actions"><button class="text-button" data-action="reset">استعادة المثال</button></div>
      </header>
      <main>
        <section class="intro">
          <div>
            <span class="status-pill">الإصدار 0.5.1 · محرك محلي مستقر</span>
            <h1>حدّد من يدرّس ماذا.<br>وقِسطاس يوزّع الباقي.</h1>
            <p>حدّد نطاق كل معلم فقط. قِسطاس يبحث عن نماذج صحيحة ومتنوعة، ثم يعرضها مرتبة لتختار الأنسب.</p>
          </div>
          <div class="intro-stat"><span>الحصص المطلوبة</span><strong>${totalPeriods()}</strong><small>${totalSections()} شعبة ومقررًا</small></div>
        </section>
        <nav class="step-nav">
          ${steps.map((label, index) => `<button class="step-item ${state.step === index ? 'active' : ''}" data-action="step" data-id="${index}"><span>${index + 1}</span>${label}</button>`).join('')}
        </nav>
        ${state.step === 0
    ? setupPanel()
    : state.step === 1
      ? teachersPanel()
      : state.step === 2 ? requirementsPanel() : resultsPanel()}
        <div class="footer-nav no-print">
          <button class="button secondary" data-action="prev" ${state.step === 0 ? 'disabled' : ''}>السابق</button>
          <button class="button primary" data-action="next">${state.step < 3 ? 'التالي' : 'ولّد نماذج التوزيع'}</button>
        </div>
      </main>
    </div>`;
}

app.addEventListener('input', (event) => {
  if (event.target.dataset.path) updateData(event.target.dataset.path, event.target.value);
});

app.addEventListener('change', (event) => {
  if (event.target.dataset.path) {
    updateData(event.target.dataset.path, event.target.value);
    render();
    return;
  }

  if (event.target.dataset.check) {
    const [, id, field] = event.target.dataset.check.split(':');
    const teacher = state.data.teachers.find((item) => item.id === id);
    if (teacher) teacher[field] = event.target.checked;
    invalidateResults();
    persistRender();
    return;
  }

  if (event.target.dataset.policyField) {
    const [id, field] = event.target.dataset.policyField.split(':');
    const teacher = state.data.teachers.find((item) => item.id === id);
    if (!teacher) return;
    if (field === 'mode') setPolicyMode(teacher, event.target.value);
    else teacherPolicy(teacher)[field] = event.target.value;
    invalidateResults();
    persistRender();
    return;
  }

  if (event.target.dataset.modelSelect !== undefined) {
    state.selectedId = event.target.value;
    render();
    return;
  }

  if (event.target.dataset.policySelection) {
    const [id, requirementId] = event.target.dataset.policySelection.split(':');
    const teacher = state.data.teachers.find((item) => item.id === id);
    if (!teacher) return;
    const policy = teacherPolicy(teacher);
    const selectedIds = new Set(policy.selectedRequirementIds);
    if (event.target.checked) selectedIds.add(requirementId);
    else selectedIds.delete(requirementId);
    policy.selectedRequirementIds = [...selectedIds];
    invalidateResults();
    persistRender();
  }
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'step') {
    state.step = Number(button.dataset.id);
    state.notice = '';
    render();
  }

  if (action === 'prev') {
    state.step = Math.max(0, state.step - 1);
    state.notice = '';
    render();
  }

  if (action === 'next') {
    state.notice = '';
    if (state.step < 3) {
      state.step += 1;
      render();
    } else await generate(false);
  }

  if (action === 'reset') {
    clearAppData();
    state = {
      step: 0,
      data: clone(seedData),
      scenarios: [],
      selectedId: 'balanced',
      errors: [],
      notice: '',
      generating: false,
      generationRound: 0,
      searchStats: { attempts: 0, uniqueFound: 0, completeFound: 0 },
    };
    persistRender();
  }

  if (action === 'add-teacher') {
    state.data.teachers.push({
      id: uid(),
      name: '',
      specialty: '',
      isLead: false,
      active: true,
      assignmentPolicy: createDefaultAssignmentPolicy(),
    });
    invalidateResults();
    persistRender();
  }

  if (action === 'delete-teacher') {
    state.data.teachers = state.data.teachers.filter((item) => item.id !== button.dataset.id);
    invalidateResults();
    persistRender();
  }

  if (action === 'copy-policy') {
    const source = state.data.teachers.find((item) => item.id === button.dataset.id);
    if (!source) return;
    const matching = state.data.teachers.filter((item) => (
      item.id !== source.id && item.specialty === source.specialty
    ));
    for (const teacher of matching) teacher.assignmentPolicy = clone(teacherPolicy(source));
    state.notice = matching.length
      ? `تم تطبيق طريقة توزيع ${source.name || 'المعلم'} على ${matching.length} من معلمي ${source.specialty}.`
      : 'لا يوجد معلم آخر بالتخصص نفسه.';
    invalidateResults();
    persistRender();
  }

  if (action === 'add-req') {
    state.data.requirements.push({
      id: uid(),
      grade: '',
      subject: '',
      sections: 1,
      periodsPerSection: 1,
    });
    invalidateResults();
    persistRender();
  }

  if (action === 'delete-req') {
    state.data.requirements = state.data.requirements.filter((item) => item.id !== button.dataset.id);
    invalidateResults();
    persistRender();
  }

  if (action === 'generate') await generate(false);

  if (action === 'select-scenario') {
    state.selectedId = button.dataset.id;
    render();
  }

  if (action === 'prev-model' || action === 'next-model') {
    const currentIndex = Math.max(0, state.scenarios.findIndex((item) => item.id === state.selectedId));
    const direction = action === 'prev-model' ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(state.scenarios.length - 1, currentIndex + direction));
    state.selectedId = state.scenarios[nextIndex]?.id || state.selectedId;
    render();
  }

  if (action === 'generate-more') await generate(true);

  if (action === 'export' && selected()) exportScenarioCsv(selected(), state.data.teachers);
  if (action === 'print') window.print();

});

async function generate(more = false) {
  state.errors = validateInputs(
    state.data.teachers,
    state.data.requirements,
    state.data.settings,
  );

  if (state.errors.length) {
    render();
    return;
  }

  state.generating = true;
  render();
  await new Promise((resolve) => setTimeout(resolve, 20));

  try {
    const excludeSignatures = more ? state.scenarios.map((scenario) => scenario.signature) : [];
    const result = generateDistributionModels(
      state.data.teachers,
      state.data.requirements,
      state.data.settings,
      {
        limit: MODEL_BATCH_SIZE,
        attempts: 100,
        seedOffset: more ? state.generationRound + 1 : 0,
        excludeSignatures,
      },
    );

    const previousSelectedId = state.selectedId;
    const combined = more ? [...state.scenarios, ...result.models] : result.models;
    state.scenarios = rankDistributionModels(combined, MAX_DISPLAY_MODELS);
    state.generationRound = more ? state.generationRound + 1 : 0;
    state.searchStats = {
      attempts: (more ? state.searchStats.attempts : 0) + result.attempts,
      uniqueFound: state.scenarios.length,
      completeFound: state.scenarios.filter(
        (scenario) => scenario.unassigned.length === 0 && scenario.overloadCount === 0,
      ).length,
    };
    state.selectedId = more && state.scenarios.some((scenario) => scenario.id === previousSelectedId)
      ? previousSelectedId
      : state.scenarios[0]?.id || '';
    state.notice = more && !result.models.length
      ? 'لم يعثر البحث الإضافي على نموذج جديد مختلف.'
      : '';
  } finally {
    state.generating = false;
    render();
  }
}


render();
