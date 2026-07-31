import { seedData } from './data/seed.js';
import {
  ASSIGNMENT_STATUS,
  buildInitialCustomRules,
  createDefaultAssignmentPolicy,
  describeAssignmentPolicy,
  normalizeAssignmentPolicy,
  POLICY_MODES,
  requirementLabel,
} from './domain/assignmentPolicy.js';
import { generateAllScenarios, validateInputs } from './engine/distribution.js';
import { clearAppData, clone, loadAppData, saveAppData } from './services/storage.js';
import { exportScenarioCsv } from './services/export.js';
import { requestGeminiReview } from './services/geminiReview.js';

const app = document.querySelector('#app');
let state = {
  step: 0,
  data: loadAppData(seedData),
  scenarios: [],
  selectedId: 'balanced',
  errors: [],
  gemini: null,
  geminiError: '',
  geminiLoading: false,
  notice: '',
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
  state.gemini = null;
  state.geminiError = '';
}

function persistRender() {
  saveAppData(state.data);
  render();
}

function input(path, value) {
  const [kind, id, field] = path.split(':');
  if (kind === 'root') state.data[field] = value;

  if (kind === 'teacher') {
    const teacher = state.data.teachers.find((item) => item.id === id);
    if (!teacher) return;
    if (['minLoad', 'targetLoad', 'maxLoad'].includes(field)) teacher[field] = Number(value);
    else if (field === 'allowedSubjects') {
      teacher[field] = value.split(/[،,]/).map((item) => item.trim()).filter(Boolean);
    } else teacher[field] = value;
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
  const specialtyOnly = state.data.requirements
    .filter((requirement) => requirement.subject === teacher.specialty)
    .map((requirement) => requirement.grade);
  const source = specialtyOnly.length
    ? specialtyOnly
    : state.data.requirements.map((requirement) => requirement.grade);
  return [...new Set(source.filter(Boolean))];
}

function preferredDefaultRequirement(teacher, extraOnly = false) {
  const allowed = new Set(Array.isArray(teacher.allowedSubjects) ? teacher.allowedSubjects : []);
  return state.data.requirements.find((requirement) => (
    (!extraOnly || requirement.subject !== teacher.specialty)
    && allowed.has(requirement.subject)
  )) ?? state.data.requirements.find((requirement) => (
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
      policy.requirementId = preferredDefaultRequirement(teacher)?.id || '';
    }
  }
  if (mode === POLICY_MODES.SPECIALTY_PLUS_EXTRA) {
    if (!state.data.requirements.some((requirement) => requirement.id === policy.extraRequirementId)) {
      policy.extraRequirementId = preferredDefaultRequirement(teacher, true)?.id || '';
    }
  }
  if (mode === POLICY_MODES.CUSTOM && !Object.keys(policy.customRules).length) {
    policy.customRules = buildInitialCustomRules(teacher, state.data.requirements);
  }
}

function setupPanel() {
  return `
    <section class="panel stack-lg">
      <div>
        <p class="eyebrow">الخطوة الأولى</p>
        <h2>بيانات الخطة</h2>
        <p class="muted">سمِّ المدرسة والقسم، ثم انتقل إلى المعلمين والمتطلبات.</p>
      </div>
      <div class="form-grid two">
        <label>اسم المدرسة
          <input data-path="root::schoolName" value="${esc(state.data.schoolName)}">
        </label>
        <label>القسم أو المجال
          <input data-path="root::departmentName" value="${esc(state.data.departmentName)}">
        </label>
      </div>
      <div class="kpi-grid">
        <article class="kpi"><span>المعلمون النشطون</span><strong>${state.data.teachers.filter((teacher) => teacher.active).length}</strong></article>
        <article class="kpi"><span>بنود المتطلبات</span><strong>${state.data.requirements.length}</strong></article>
        <article class="kpi"><span>إجمالي الحصص</span><strong>${totalPeriods()}</strong></article>
      </div>
      <div class="note">البيانات محفوظة محليًا في هذا المتصفح. مفتاح Gemini لا يدخل الواجهة مطلقًا.</div>
    </section>`;
}

const policyModeLabels = [
  [POLICY_MODES.USUAL, 'التوزيع المعتاد'],
  [POLICY_MODES.SPECIALTY_ONLY, 'تخصصه فقط'],
  [POLICY_MODES.SPECIALTY_GRADE, 'تخصصه في صف واحد فقط'],
  [POLICY_MODES.SINGLE_REQUIREMENT, 'صف ومادة محددان فقط'],
  [POLICY_MODES.SPECIALTY_PLUS_EXTRA, 'تخصصه + صف ومادة إضافيان'],
  [POLICY_MODES.CUSTOM, 'توزيع مخصص'],
];

function requirementOptions(selectedId = '') {
  if (!state.data.requirements.length) return '<option value="">أضف المتطلبات أولًا</option>';
  return state.data.requirements.map((requirement) => `
    <option value="${esc(requirement.id)}" ${requirement.id === selectedId ? 'selected' : ''}>
      ${esc(requirementLabel(requirement))}
    </option>`).join('');
}

function policyContext(teacher) {
  const policy = teacherPolicy(teacher);

  if (policy.mode === POLICY_MODES.SPECIALTY_GRADE) {
    const grades = specialtyGrades(teacher);
    return `
      <label class="policy-context-label">اختر الصف
        <select data-policy-field="${teacher.id}:grade">
          ${grades.length
    ? grades.map((grade) => `<option value="${esc(grade)}" ${grade === policy.grade ? 'selected' : ''}>${esc(grade)}</option>`).join('')
    : '<option value="">لا توجد صفوف مطابقة للتخصص</option>'}
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
      <label class="policy-context-label">اختر الإسناد الإضافي
        <select data-policy-field="${teacher.id}:extraRequirementId">
          ${requirementOptions(policy.extraRequirementId)}
        </select>
      </label>`;
  }

  if (policy.mode === POLICY_MODES.CUSTOM) {
    return `
      <div class="custom-policy">
        <div class="policy-legend">
          <span class="legend preferred">مفضّل</span>
          <span class="legend allowed">مسموح عند الحاجة</span>
          <span class="legend forbidden">ممنوع</span>
        </div>
        <div class="custom-policy-grid">
          ${state.data.requirements.map((requirement) => {
    const status = policy.customRules[requirement.id] || ASSIGNMENT_STATUS.FORBIDDEN;
    return `
              <label class="custom-rule">
                <span>${esc(requirementLabel(requirement))}</span>
                <select class="status-${status}" data-policy-rule="${teacher.id}:${requirement.id}">
                  <option value="preferred" ${status === ASSIGNMENT_STATUS.PREFERRED ? 'selected' : ''}>مفضّل</option>
                  <option value="allowed" ${status === ASSIGNMENT_STATUS.ALLOWED ? 'selected' : ''}>مسموح</option>
                  <option value="forbidden" ${status === ASSIGNMENT_STATUS.FORBIDDEN ? 'selected' : ''}>ممنوع</option>
                </select>
              </label>`;
  }).join('') || '<p class="muted">أضف الصفوف والمواد أولًا.</p>'}
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
            <small>${esc(teacher.specialty || 'لم يحدد التخصص')}</small>
          </div>
        </div>
        <div class="teacher-header-actions">
          <label class="switch-label"><input type="checkbox" data-check="teacher:${teacher.id}:active" ${teacher.active ? 'checked' : ''}> نشط</label>
          <button class="icon-button danger" title="حذف المعلم" data-action="delete-teacher" data-id="${teacher.id}">×</button>
        </div>
      </header>

      <div class="teacher-primary-grid">
        <label>اسم المعلم
          <input data-path="teacher:${teacher.id}:name" value="${esc(teacher.name)}">
        </label>
        <label>التخصص
          <input data-path="teacher:${teacher.id}:specialty" value="${esc(teacher.specialty)}">
        </label>
        <label>طريقة التوزيع
          <select data-policy-field="${teacher.id}:mode">
            ${policyModeLabels.map(([value, label]) => `<option value="${value}" ${policy.mode === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="policy-box">
        <div class="policy-summary-row">
          <div>
            <small>نطاق التدريس</small>
            <strong>${esc(describeAssignmentPolicy(teacher, state.data.requirements))}</strong>
          </div>
          <button class="text-button compact" data-action="copy-policy" data-id="${teacher.id}">تطبيقه على نفس التخصص</button>
        </div>
        ${policyContext(teacher)}
      </div>

      <div class="load-control">
        <label>الأدنى<input class="number" type="number" min="0" data-path="teacher:${teacher.id}:minLoad" value="${teacher.minLoad}"></label>
        <label>المستهدف<input class="number" type="number" min="0" data-path="teacher:${teacher.id}:targetLoad" value="${teacher.targetLoad}"></label>
        <label>الأعلى<input class="number" type="number" min="0" data-path="teacher:${teacher.id}:maxLoad" value="${teacher.maxLoad}"></label>
      </div>

      <details class="teacher-more">
        <summary>إعدادات إضافية</summary>
        <div class="form-grid two top-gap">
          <label>مواد إضافية مسموحة
            <input data-path="teacher:${teacher.id}:allowedSubjects" value="${esc((teacher.allowedSubjects || []).join('، '))}" placeholder="مثال: العلوم العامة">
          </label>
          <label class="checkbox-card"><input type="checkbox" data-check="teacher:${teacher.id}:isLead" ${teacher.isLead ? 'checked' : ''}> معلم أول أو منسق بنصاب مخفّض</label>
        </div>
      </details>
    </article>`;
}

function teachersPanel() {
  return `
    <section class="panel stack-lg">
      <div class="section-heading">
        <div>
          <p class="eyebrow">الخطوة الثانية</p>
          <h2>المعلمون والتحكم في التوزيع</h2>
          <p class="muted">اختر قالبًا بسيطًا لكل معلم. افتح «توزيع مخصص» فقط عندما تحتاج تحكمًا أدق.</p>
        </div>
        <button class="button secondary" data-action="add-teacher">إضافة معلم</button>
      </div>
      ${state.notice ? `<div class="alert success">${esc(state.notice)}</div>` : ''}
      <div class="teacher-editor-list">
        ${state.data.teachers.map(teacherEditor).join('')}
      </div>
    </section>`;
}

function reqPanel() {
  return `
    <section class="panel stack-lg">
      <div class="section-heading">
        <div>
          <p class="eyebrow">الخطوة الثالثة</p>
          <h2>الصفوف والمواد</h2>
          <p class="muted">كل سطر يحدد صفًا ومادة وعدد الشعب وحصص الشعبة.</p>
        </div>
        <button class="button secondary" data-action="add-req">إضافة متطلب</button>
      </div>
      <div class="table-wrap compact-table">
        <table>
          <thead><tr><th>الصف</th><th>المادة</th><th>الشعب</th><th>حصص الشعبة</th><th>الإجمالي</th><th></th></tr></thead>
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
      <div class="note">بعد تعديل الصفوف أو المواد، راجع قوالب المعلمين التي تعتمد على صف أو مقرر محدد.</div>
    </section>`;
}

function resultsPanel() {
  const scenario = selected();
  const scenarioCards = state.scenarios.map((item) => `
    <button class="scenario-card ${item.id === state.selectedId ? 'selected' : ''}" data-action="select-scenario" data-id="${item.id}">
      <span class="scenario-title">${item.label}</span>
      <span>${item.description}</span>
      <div class="scenario-metrics">
        <small>غير مسند: ${item.unassigned.length}</small>
        <small>أقل من الأدنى: ${item.underMinCount}</small>
        <small>إسناد مرن: ${item.allowedPeriodsCount}</small>
      </div>
    </button>`).join('');

  const unassigned = scenario?.unassigned.length
    ? `<div class="alert error"><strong>تكليفات غير مسندة:</strong><div class="chips top-gap">${scenario.unassigned.map((item) => `<span>${esc(item.grade)} / ${item.section} · ${esc(item.subject)} (${item.periods})</span>`).join('')}</div></div>`
    : '';

  const summary = scenario ? `
    <div class="panel stack-lg print-area">
      <div class="section-heading">
        <div><h2>${scenario.label}</h2><p class="muted">${scenario.description}</p></div>
        <div class="actions no-print">
          <button class="button secondary" data-action="export">تصدير CSV</button>
          <button class="button secondary" data-action="print">طباعة / PDF</button>
        </div>
      </div>
      <div class="kpi-grid four">
        <article class="kpi"><span>الشعب المسندة</span><strong>${scenario.assignments.length}</strong></article>
        <article class="kpi"><span>غير المسندة</span><strong>${scenario.unassigned.length}</strong></article>
        <article class="kpi"><span>خارج التخصص</span><strong>${scenario.outsideSpecialtyCount}</strong></article>
        <article class="kpi"><span>تفاوت الأنصبة</span><strong>${scenario.variance.toFixed(1)}</strong></article>
      </div>
      <div class="assignment-legend"><span class="preferred">مفضّل</span><span class="allowed">مسموح عند الحاجة</span></div>
      ${scenario.warnings.length ? `<div class="alert warning"><ul>${scenario.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div>` : ''}
      ${unassigned}
      <div class="teacher-results">
        ${scenario.summaries.map((summaryItem) => {
    const teacher = state.data.teachers.find((item) => item.id === summaryItem.teacherId);
    if (!teacher) return '';
    const status = summaryItem.load > teacher.maxLoad
      ? 'over'
      : summaryItem.load < teacher.minLoad ? 'under' : 'ok';
    return `
            <article class="teacher-card">
              <header>
                <div><h3>${esc(teacher.name)}</h3><p>${esc(teacher.specialty)}${teacher.isLead ? ' · معلم أول' : ''}</p></div>
                <span class="load-badge ${status}">${summaryItem.load} حصة</span>
              </header>
              <div class="chips">
                ${summaryItem.assignments.map((assignment) => `<span class="${assignment.preference === ASSIGNMENT_STATUS.PREFERRED ? 'preferred' : 'allowed'}">${esc(assignment.grade)} / ${assignment.section} · ${esc(assignment.subject)} (${assignment.periods})</span>`).join('') || '<span>لا توجد شعب مسندة</span>'}
              </div>
            </article>`;
  }).join('')}
      </div>
    </div>` : '';

  const gemini = state.gemini ? `
    <div class="ai-review">
      <h3>${esc(state.gemini.summary)}</h3>
      <div class="review-columns">
        ${[
    ['نقاط القوة', state.gemini.strengths],
    ['تنبيهات', state.gemini.warnings],
    ['إجراءات مقترحة', state.gemini.suggestedActions],
  ].map(([heading, items]) => `<div><strong>${heading}</strong><ul>${(items || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>`).join('')}
      </div>
    </div>` : '';

  return `
    <section class="stack-lg">
      <div class="panel hero-result">
        <div><p class="eyebrow">الخطوة الرابعة</p><h2>التوليد والمراجعة</h2><p class="muted">المحرك يلتزم بنطاقات التدريس التي اخترتها، ثم يولد ثلاثة بدائل.</p></div>
        <button class="button primary" data-action="generate">توليد التوزيع</button>
      </div>
      ${state.errors.length ? `<div class="alert error"><strong>تحقق من البيانات:</strong><ul>${state.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul></div>` : ''}
      ${state.scenarios.length ? `
        <div class="scenario-grid">${scenarioCards}</div>
        ${summary}
        <div class="panel ai-panel no-print">
          <div><p class="eyebrow">مراجعة اختيارية</p><h2>تحليل Gemini</h2><p class="muted">يراجع المؤشرات ويشرح السيناريو الأنسب، ولا يعدل الحسابات.</p></div>
          <details>
            <summary>إعدادات الاتصال الآمن</summary>
            <div class="form-grid two top-gap">
              <label>رابط Supabase<input id="supabase-url" value="${esc(localStorage.getItem('qistas:supabase-url') || '')}"></label>
              <label>مفتاح Supabase anon<input id="supabase-key" type="password" value="${esc(localStorage.getItem('qistas:supabase-anon-key') || '')}"></label>
            </div>
            <button class="button secondary top-gap" data-action="save-ai-settings">حفظ الإعدادات</button>
          </details>
          <button class="button ai" data-action="gemini" ${state.geminiLoading ? 'disabled' : ''}>${state.geminiLoading ? 'جارٍ التحليل…' : 'مراجعة السيناريوهات'}</button>
          ${state.geminiError ? `<div class="alert error">${esc(state.geminiError)}</div>` : ''}
          ${gemini}
        </div>` : ''}
    </section>`;
}

function render() {
  const steps = ['الإعداد', 'المعلمون', 'المتطلبات', 'النتائج'];
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
            <span class="status-pill">الإصدار 0.2 · تحكم مرن</span>
            <h1>وزّع الأنصبة والشعب<br>كما تريد، بلا تعقيد.</h1>
            <p>اختر لكل معلم قالب توزيع واضحًا، ثم دع المحرك يوازن الأنصبة داخل الحدود التي حددتها.</p>
          </div>
          <div class="intro-stat"><span>الحصص المطلوبة</span><strong>${totalPeriods()}</strong><small>${totalSections()} تكليفًا صفّيًا</small></div>
        </section>
        <nav class="step-nav">
          ${steps.map((label, index) => `<button class="step-item ${state.step === index ? 'active' : ''}" data-action="step" data-id="${index}"><span>${index + 1}</span>${label}</button>`).join('')}
        </nav>
        ${state.step === 0
    ? setupPanel()
    : state.step === 1
      ? teachersPanel()
      : state.step === 2 ? reqPanel() : resultsPanel()}
        <div class="footer-nav no-print">
          <button class="button secondary" data-action="prev" ${state.step === 0 ? 'disabled' : ''}>السابق</button>
          <button class="button primary" data-action="next">${state.step < 3 ? 'التالي' : 'تحديث التوزيع'}</button>
        </div>
      </main>
    </div>`;
}

app.addEventListener('input', (event) => {
  if (event.target.dataset.path) input(event.target.dataset.path, event.target.value);
});

app.addEventListener('change', (event) => {
  if (event.target.dataset.path) {
    input(event.target.dataset.path, event.target.value);
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

  if (event.target.dataset.policyRule) {
    const [id, requirementId] = event.target.dataset.policyRule.split(':');
    const teacher = state.data.teachers.find((item) => item.id === id);
    if (!teacher) return;
    teacherPolicy(teacher).customRules[requirementId] = event.target.value;
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
    } else generate();
  }
  if (action === 'reset') {
    clearAppData();
    state = {
      step: 0,
      data: clone(seedData),
      scenarios: [],
      selectedId: 'balanced',
      errors: [],
      gemini: null,
      geminiError: '',
      geminiLoading: false,
      notice: '',
    };
    persistRender();
  }
  if (action === 'add-teacher') {
    state.data.teachers.push({
      id: uid(),
      name: '',
      specialty: '',
      allowedSubjects: [],
      minLoad: 14,
      targetLoad: 16,
      maxLoad: 18,
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
      ? `تم تطبيق نطاق ${source.name || 'المعلم'} على ${matching.length} من معلمي تخصص ${source.specialty}.`
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
  if (action === 'generate') generate();
  if (action === 'select-scenario') {
    state.selectedId = button.dataset.id;
    render();
  }
  if (action === 'export' && selected()) exportScenarioCsv(selected(), state.data.teachers);
  if (action === 'print') window.print();
  if (action === 'save-ai-settings') {
    localStorage.setItem('qistas:supabase-url', document.querySelector('#supabase-url').value.trim());
    localStorage.setItem('qistas:supabase-anon-key', document.querySelector('#supabase-key').value.trim());
    button.textContent = 'تم الحفظ';
  }
  if (action === 'gemini') {
    state.geminiLoading = true;
    state.geminiError = '';
    render();
    try {
      state.gemini = await requestGeminiReview(state.data, state.scenarios);
      if (state.gemini.recommendedScenario !== 'none') {
        state.selectedId = state.gemini.recommendedScenario;
      }
    } catch (error) {
      state.geminiError = error instanceof Error ? error.message : 'تعذرت المراجعة.';
    } finally {
      state.geminiLoading = false;
      render();
    }
  }
});

function generate() {
  state.errors = validateInputs(state.data.teachers, state.data.requirements);
  state.gemini = null;
  state.geminiError = '';
  if (!state.errors.length) {
    state.scenarios = generateAllScenarios(state.data.teachers, state.data.requirements);
    state.selectedId = [...state.scenarios]
      .sort((a, b) => a.score - b.score)[0]?.id || 'balanced';
  }
  render();
}

render();
