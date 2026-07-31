import { seedData } from './data/seed.js';
import {
  ASSIGNMENT_STATUS,
  buildInitialCustomSelection,
  getAssignmentStatus,
  createDefaultAssignmentPolicy,
  describeAssignmentPolicy,
  normalizeAssignmentPolicy,
  POLICY_MODES,
  requirementLabel,
} from './domain/assignmentPolicy.js';
import {
  evaluateScenario,
  generateDistributionModels,
  rankDistributionModels,
  teacherMaxLoad,
  validateFixedAssignments,
  validateInputs,
} from './engine/distribution.js';
import {
  clearAppData,
  clearWorkspace,
  clone,
  loadAppData,
  loadWorkspace,
  saveAppData,
  saveWorkspace,
} from './services/storage.js';
import { printScenarioReport } from './services/export.js';
import { exportScenarioExcel } from './services/excelExport.js';

const app = document.querySelector('#app');
const MODEL_BATCH_SIZE = 20;
const MAX_DISPLAY_MODELS = 100;

const storedWorkspace = loadWorkspace();

let state = {
  step: storedWorkspace?.draft ? 3 : 0,
  data: loadAppData(seedData),
  scenarios: [],
  selectedId: 'balanced',
  errors: [],
  notice: '',
  generating: false,
  generationRound: 0,
  searchStats: { attempts: 0, uniqueFound: 0, completeFound: 0 },
  resultView: storedWorkspace?.draft ? 'draft' : 'models',
  draft: storedWorkspace?.draft ?? null,
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
  state.resultView = 'models';
  state.draft = null;
  clearWorkspace();
}

function persistDraft() {
  if (!state.draft) {
    clearWorkspace();
    return;
  }
  saveWorkspace({ draft: state.draft });
}

function markDraftChanged(notice = '') {
  if (!state.draft) return;
  state.draft.approved = false;
  state.draft.approvedAt = '';
  if (state.draft.scenario) state.draft.scenario.tag = 'مسودة';
  state.draft.notice = notice;
  state.draft.noticeType = 'success';
  persistDraft();
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

      <div class="form-grid three">
        <label>اسم المدرسة
          <input data-path="root::schoolName" value="${esc(state.data.schoolName)}">
        </label>
        <label>القسم أو المجال
          <input data-path="root::departmentName" value="${esc(state.data.departmentName)}">
        </label>
        <label>السنة الدراسية
          <input data-path="root::academicYear" value="${esc(state.data.academicYear || '')}" placeholder="2026/2027">
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


function ensureDraftShape() {
  if (!state.draft) return null;
  state.draft.lockedTeacherIds = Array.isArray(state.draft.lockedTeacherIds)
    ? [...new Set(state.draft.lockedTeacherIds)]
    : [];
  state.draft.pinnedTaskIds = Array.isArray(state.draft.pinnedTaskIds)
    ? [...new Set(state.draft.pinnedTaskIds)]
    : [];
  state.draft.selectedTaskId = String(state.draft.selectedTaskId || '');
  state.draft.notice = String(state.draft.notice || '');
  state.draft.noticeType = String(state.draft.noticeType || 'success');
  state.draft.approved = Boolean(state.draft.approved);
  state.draft.approvedAt = String(state.draft.approvedAt || '');
  return state.draft;
}

function lockedTeacherSet() {
  return new Set(ensureDraftShape()?.lockedTeacherIds || []);
}

function pinnedTaskSet() {
  return new Set(ensureDraftShape()?.pinnedTaskIds || []);
}

function refreshDraftScenario(assignments, unassigned, notice = '') {
  if (!state.draft) return;
  const previous = state.draft.scenario || {};
  state.draft.approved = false;
  state.draft.approvedAt = '';
  state.draft.scenario = evaluateScenario(
    state.data.teachers,
    state.data.requirements,
    state.data.settings,
    assignments,
    unassigned,
    {
      id: 'draft-plan',
      label: 'الخطة قيد التعديل',
      tag: 'مسودة',
      description: 'ثبّت التوزيع المقبول، وانقل شعبة عند الحاجة، ثم أعد توزيع الجزء المتبقي فقط.',
      relocationCount: previous.relocationCount,
      repairedCount: previous.repairedCount,
    },
  );
  state.draft.notice = notice;
  state.draft.noticeType = 'success';
  persistDraft();
}

function draftFixedAssignments() {
  const draft = ensureDraftShape();
  if (!draft?.scenario) return [];
  const lockedTeachers = lockedTeacherSet();
  const pinnedTasks = pinnedTaskSet();
  return draft.scenario.assignments
    .filter((assignment) => (
      lockedTeachers.has(assignment.teacherId) || pinnedTasks.has(assignment.taskId)
    ))
    .map((assignment) => ({
      taskId: assignment.taskId,
      teacherId: assignment.teacherId,
    }));
}

function transferCandidates(assignment) {
  if (!assignment || !state.draft?.scenario) return [];
  const lockedTeachers = lockedTeacherSet();
  const summaryByTeacher = new Map(
    state.draft.scenario.summaries.map((summary) => [summary.teacherId, summary]),
  );

  return state.data.teachers
    .filter((teacher) => (
      teacher.active
      && teacher.id !== assignment.teacherId
      && !lockedTeachers.has(teacher.id)
      && getAssignmentStatus(teacher, assignment) !== ASSIGNMENT_STATUS.FORBIDDEN
    ))
    .map((teacher) => {
      const currentLoad = summaryByTeacher.get(teacher.id)?.load || 0;
      const maxLoad = teacherMaxLoad(teacher, state.data.settings);
      return {
        teacher,
        currentLoad,
        projectedLoad: currentLoad + assignment.periods,
        maxLoad,
      };
    })
    .filter((candidate) => candidate.projectedLoad <= candidate.maxLoad)
    .sort((a, b) => a.projectedLoad - b.projectedLoad
      || a.teacher.name.localeCompare(b.teacher.name, 'ar'));
}

function draftTransferPanel() {
  const draft = ensureDraftShape();
  const scenario = draft?.scenario;
  if (!draft?.selectedTaskId || !scenario) return '';
  const assignment = scenario.assignments.find((item) => item.taskId === draft.selectedTaskId);
  if (!assignment) return '';
  const currentTeacher = state.data.teachers.find((teacher) => teacher.id === assignment.teacherId);
  const candidates = transferCandidates(assignment);
  const pinned = pinnedTaskSet().has(assignment.taskId);

  return `
    <section class="transfer-panel no-print">
      <div class="transfer-heading">
        <div>
          <p class="eyebrow">نقل شعبة</p>
          <h3>${esc(assignment.subject)} · ${esc(assignment.grade)} / ${assignment.section}</h3>
          <p class="muted">حاليًا لدى ${esc(currentTeacher?.name || 'معلم غير معروف')} · ${assignment.periods} حصص.</p>
        </div>
        <button class="icon-button" data-action="cancel-transfer" title="إغلاق">×</button>
      </div>
      ${candidates.length ? `
        <div class="transfer-candidates">
          ${candidates.map((candidate) => `
            <button class="transfer-candidate" data-action="move-task" data-task-id="${assignment.taskId}" data-teacher-id="${candidate.teacher.id}">
              <strong>${esc(candidate.teacher.name)}</strong>
              <span>${candidate.currentLoad} ← ${candidate.projectedLoad} من ${candidate.maxLoad}</span>
            </button>`).join('')}
        </div>` : '<div class="alert warning">لا يوجد معلم بديل مسموح له بهذه الشعبة ولديه سعة كافية.</div>'}
      <div class="transfer-footer">
        <span>${pinned ? 'هذه الشعبة مثبتة ولن تتغير عند إعادة التوزيع.' : 'عند نقل الشعبة ستُثبت تلقائيًا حتى لا يعيد المحرك إرجاعها.'}</span>
        ${pinned ? `<button class="text-button" data-action="unpin-task" data-task-id="${assignment.taskId}">فك تثبيت الشعبة</button>` : ''}
      </div>
    </section>`;
}

function draftPanel() {
  const draft = ensureDraftShape();
  const scenario = draft?.scenario;
  if (!scenario) {
    state.resultView = 'models';
    return modelResultsPanel();
  }
  const assignedPeriods = scenario.assignments.reduce((sum, item) => sum + item.periods, 0);
  const lockedTeachers = lockedTeacherSet();
  const pinnedTasks = pinnedTaskSet();
  const approvedDate = draft.approvedAt
    ? new Date(draft.approvedAt).toLocaleString('ar-OM', { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  return `
    <section class="stack-lg">
      <div class="panel draft-hero">
        <div>
          <p class="eyebrow">مساحة العمل</p>
          <h2>الخطة قيد التعديل ${draft.approved ? '<span class="approval-badge">معتمدة</span>' : ''}</h2>
          <p class="muted">ثبّت المعلمين الذين أعجبك توزيعهم، وانقل أي شعبة بنقرة، ثم دع قِسطاس يعيد توزيع الباقي فقط.</p>
          ${approvedDate ? `<small class="approved-date">آخر اعتماد: ${esc(approvedDate)}</small>` : ''}
        </div>
        <div class="actions no-print">
          <button class="button secondary" data-action="view-models">العودة للنماذج</button>
          <button class="button secondary" data-action="rebalance-draft" ${state.generating ? 'disabled' : ''}>${state.generating ? 'جارٍ إعادة التوزيع…' : 'أعد توزيع غير المثبت'}</button>
          <button class="button primary" data-action="approve-draft">${draft.approved ? 'إعادة اعتماد الخطة' : 'اعتماد الخطة'}</button>
        </div>
      </div>

      ${draft.notice ? `<div class="alert ${draft.noticeType === 'warning' ? 'warning' : draft.noticeType === 'error' ? 'error' : 'success'}">${esc(draft.notice)}</div>` : ''}
      ${draftTransferPanel()}

      <div class="panel stack-lg print-area">
        <div class="section-heading">
          <div>
            <p class="eyebrow">الخطة الحالية</p>
            <h2>${esc(state.data.schoolName)} · ${esc(state.data.departmentName)}</h2>
          </div>
          <div class="actions no-print">
            <button class="button secondary" data-action="export-draft">تصدير Excel منسق</button>
            <button class="button secondary" data-action="print">تقرير PDF رسمي</button>
          </div>
        </div>

        <div class="kpi-grid four">
          <article class="kpi"><span>الحصص المسندة</span><strong>${assignedPeriods}</strong></article>
          <article class="kpi"><span>المعلمون المثبتون</span><strong>${lockedTeachers.size}</strong></article>
          <article class="kpi"><span>الشعب المثبتة</span><strong>${pinnedTasks.size}</strong></article>
          <article class="kpi"><span>فرق الأنصبة</span><strong>${scenario.loadSpread}</strong></article>
        </div>

        ${scenario.unassigned.length
    ? `<div class="alert error">توجد ${scenario.unassigned.length} شعبة غير مسندة. خفف بعض القيود أو فك تثبيت جزء من الخطة.</div>`
    : '<div class="alert success">جميع الشعب مسندة داخل القيود الحالية.</div>'}

        <div class="teacher-results editable-results">
          ${scenario.summaries.map((summaryItem) => {
    const teacher = state.data.teachers.find((item) => item.id === summaryItem.teacherId);
    if (!teacher) return '';
    const locked = lockedTeachers.has(teacher.id);
    const sortedAssignments = [...summaryItem.assignments].sort((a, b) => (
      a.grade.localeCompare(b.grade, 'ar')
      || a.subject.localeCompare(b.subject, 'ar')
      || a.section - b.section
    ));
    return `
              <article class="teacher-card editable-teacher-card ${locked ? 'locked' : ''}">
                <header>
                  <div>
                    <h3>${esc(teacher.name)}</h3>
                    <p>${esc(teacher.specialty)}${teacher.isLead ? ' · معلم أول' : ''}</p>
                  </div>
                  <div class="teacher-result-actions no-print">
                    <span class="load-badge">${summaryItem.load} / ${summaryItem.maxLoad} حصة</span>
                    <button class="lock-button ${locked ? 'active' : ''}" data-action="toggle-teacher-lock" data-id="${teacher.id}">
                      ${locked ? 'مثبت · فك' : 'تثبيت التوزيع'}
                    </button>
                  </div>
                </header>
                <div class="assignment-buttons">
                  ${sortedAssignments.map((assignment) => {
    const pinned = pinnedTasks.has(assignment.taskId);
    return `
                    <button class="assignment-button ${pinned ? 'pinned' : ''}" data-action="select-transfer" data-task-id="${assignment.taskId}" ${locked ? 'disabled' : ''}>
                      <span>${esc(assignment.grade)} / ${assignment.section} · ${esc(assignment.subject)}</span>
                      <small>${pinned ? 'مثبتة' : 'نقل'} · ${assignment.periods}</small>
                    </button>`;
  }).join('') || '<span class="empty-assignment">لا توجد شعب مسندة</span>'}
                </div>
              </article>`;
  }).join('')}
        </div>
      </div>
    </section>`;
}

function modelResultsPanel() {
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
          <button class="button primary" data-action="adopt-model">اعتماد مبدئي وتعديل</button>
          <button class="button secondary" data-action="export">تصدير Excel منسق</button>
          <button class="button secondary" data-action="print">تقرير PDF رسمي</button>
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
        <div class="actions no-print">
          ${state.draft ? '<button class="button secondary" data-action="view-draft">فتح الخطة قيد التعديل</button>' : ''}
          <button class="button primary" data-action="generate" ${state.generating ? 'disabled' : ''}>${state.generating ? 'جارٍ البحث عن النماذج…' : 'ولّد نماذج التوزيع'}</button>
        </div>
      </div>

      ${state.errors.length ? `<div class="alert error"><strong>راجع هذه النقاط:</strong><ul>${state.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul></div>` : ''}
      ${searchMessage}
      ${result}

    </section>`;
}

function resultsPanel() {
  return state.resultView === 'draft' && state.draft
    ? draftPanel()
    : modelResultsPanel();
}


function adoptSelectedModel() {
  const scenario = selected();
  if (!scenario) return;
  state.draft = {
    sourceScenarioId: scenario.id,
    scenario: evaluateScenario(
      state.data.teachers,
      state.data.requirements,
      state.data.settings,
      scenario.assignments,
      scenario.unassigned,
      {
        id: 'draft-plan',
        label: 'الخطة قيد التعديل',
        tag: 'مسودة',
        description: 'خطة مأخوذة من أحد النماذج، ويمكن تثبيت أجزاء منها أو نقل الشعب.',
        relocationCount: scenario.relocationCount,
        repairedCount: scenario.repairedCount,
      },
    ),
    lockedTeacherIds: [],
    pinnedTaskIds: [],
    selectedTaskId: '',
    approved: false,
    approvedAt: '',
    notice: `تم فتح ${scenario.label} للتعديل. ثبّت المقبول ثم أعد توزيع الباقي.`,
    noticeType: 'success',
    rebalanceRound: 0,
  };
  state.resultView = 'draft';
  state.step = 3;
  persistDraft();
  render();
}

function approveDraft() {
  const draft = ensureDraftShape();
  if (!draft?.scenario) return;
  if (draft.scenario.unassigned.length) {
    draft.approved = false;
    draft.notice = 'لا يمكن اعتماد الخطة قبل إسناد جميع الشعب.';
    draft.noticeType = 'warning';
    persistDraft();
    render();
    return;
  }
  draft.approved = true;
  draft.approvedAt = new Date().toISOString();
  draft.notice = 'تم اعتماد الخطة وحفظها على هذا الجهاز.';
  draft.noticeType = 'success';
  draft.scenario.tag = 'معتمدة';
  persistDraft();
  render();
}

function moveDraftTask(taskId, teacherId) {
  const draft = ensureDraftShape();
  const scenario = draft?.scenario;
  if (!scenario) return;
  const assignment = scenario.assignments.find((item) => item.taskId === taskId);
  const destination = state.data.teachers.find((teacher) => teacher.id === teacherId);
  if (!assignment || !destination) return;
  const lockedTeachers = lockedTeacherSet();
  if (lockedTeachers.has(assignment.teacherId) || lockedTeachers.has(destination.id)) {
    draft.notice = 'فك تثبيت المعلم أولًا قبل تغيير شعبه.';
    draft.noticeType = 'warning';
    persistDraft();
    render();
    return;
  }
  const candidate = transferCandidates(assignment).find((item) => item.teacher.id === teacherId);
  if (!candidate) {
    draft.notice = 'تعذر النقل: المعلم البديل خارج النطاق أو سيجاوز سقف النصاب.';
    draft.noticeType = 'warning';
    persistDraft();
    render();
    return;
  }

  const assignments = scenario.assignments.map((item) => (
    item.taskId === taskId
      ? {
        ...item,
        teacherId: destination.id,
        preference: getAssignmentStatus(destination, item),
      }
      : item
  ));
  const pinned = pinnedTaskSet();
  pinned.add(taskId);
  draft.pinnedTaskIds = [...pinned];
  draft.selectedTaskId = '';
  refreshDraftScenario(
    assignments,
    scenario.unassigned,
    `تم نقل ${assignment.subject} · ${assignment.grade} / ${assignment.section} إلى ${destination.name} وتثبيت الشعبة.`,
  );
  render();
}

async function rebalanceDraft() {
  const draft = ensureDraftShape();
  if (!draft?.scenario) return;
  const fixedAssignments = draftFixedAssignments();
  const frozenTeacherIds = [...lockedTeacherSet()];
  const fixedErrors = validateFixedAssignments(
    state.data.teachers,
    state.data.requirements,
    state.data.settings,
    fixedAssignments,
  );
  if (fixedErrors.length) {
    draft.notice = fixedErrors.join(' ');
    draft.noticeType = 'warning';
    persistDraft();
    render();
    return;
  }

  state.generating = true;
  draft.notice = '';
  persistDraft();
  render();
  await new Promise((resolve) => setTimeout(resolve, 20));

  try {
    const round = Number(draft.rebalanceRound) || 0;
    const result = generateDistributionModels(
      state.data.teachers,
      state.data.requirements,
      state.data.settings,
      {
        limit: MODEL_BATCH_SIZE,
        attempts: 120,
        seedOffset: 10_000 + round,
        fixedAssignments,
        frozenTeacherIds,
      },
    );
    const complete = result.models.find((model) => (
      model.unassigned.length === 0 && model.overloadCount === 0
    ));
    if (!complete) {
      draft.notice = 'لم يجد قِسطاس توزيعًا مكتملًا مع التثبيت الحالي. فك تثبيت معلم أو شعبة ثم أعد المحاولة.';
      draft.noticeType = 'warning';
    } else {
      draft.scenario = evaluateScenario(
        state.data.teachers,
        state.data.requirements,
        state.data.settings,
        complete.assignments,
        complete.unassigned,
        {
          id: 'draft-plan',
          label: 'الخطة قيد التعديل',
          tag: 'مسودة',
          description: 'أعيد توزيع الجزء غير المثبت مع الحفاظ على قراراتك.',
          relocationCount: complete.relocationCount,
          repairedCount: complete.repairedCount,
        },
      );
      draft.approved = false;
      draft.approvedAt = '';
      draft.selectedTaskId = '';
      draft.rebalanceRound = round + 1;
      draft.notice = `حافظ قِسطاس على ${fixedAssignments.length} تكليفات مثبتة، وطبّق أفضل نموذج من ${result.models.length} بدائل للجزء المتبقي.`;
      draft.noticeType = 'success';
    }
  } finally {
    state.generating = false;
    persistDraft();
    render();
  }
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
            <span class="status-pill">الإصدار 0.7.0 · تقرير رسمي منظم</span>
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
          <button class="button primary" data-action="next">${state.step < 3 ? 'التالي' : state.resultView === 'draft' && state.draft ? 'اعتماد الخطة' : 'ولّد نماذج التوزيع'}</button>
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
    } else if (state.resultView === 'draft' && state.draft) approveDraft();
    else await generate(false);
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
      resultView: 'models',
      draft: null,
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

  if (action === 'adopt-model') adoptSelectedModel();

  if (action === 'view-models') {
    state.resultView = 'models';
    render();
  }

  if (action === 'view-draft' && state.draft) {
    state.resultView = 'draft';
    render();
  }

  if (action === 'toggle-teacher-lock' && state.draft) {
    const locked = lockedTeacherSet();
    if (locked.has(button.dataset.id)) locked.delete(button.dataset.id);
    else locked.add(button.dataset.id);
    state.draft.lockedTeacherIds = [...locked];
    state.draft.selectedTaskId = '';
    markDraftChanged(locked.has(button.dataset.id)
      ? 'تم تثبيت توزيع المعلم. لن تتغير شعبه عند إعادة التوزيع.'
      : 'تم فك تثبيت المعلم، ويمكن لقِسطاس إعادة توزيع شعبه.');
    render();
  }

  if (action === 'select-transfer' && state.draft) {
    state.draft.selectedTaskId = button.dataset.taskId || '';
    state.draft.notice = '';
    persistDraft();
    render();
  }

  if (action === 'cancel-transfer' && state.draft) {
    state.draft.selectedTaskId = '';
    persistDraft();
    render();
  }

  if (action === 'move-task') moveDraftTask(button.dataset.taskId, button.dataset.teacherId);

  if (action === 'unpin-task' && state.draft) {
    const pinned = pinnedTaskSet();
    pinned.delete(button.dataset.taskId);
    state.draft.pinnedTaskIds = [...pinned];
    state.draft.selectedTaskId = '';
    markDraftChanged('تم فك تثبيت الشعبة، ويمكن إعادة توزيعها لاحقًا.');
    render();
  }

  if (action === 'rebalance-draft') await rebalanceDraft();
  if (action === 'approve-draft') approveDraft();

  if (action === 'export-draft' && state.draft?.scenario) {
    try {
      await exportScenarioExcel(state.draft.scenario, state.data, {
        approved: Boolean(state.draft.approved),
        approvedAt: state.draft.approvedAt,
        isDraft: !state.draft.approved,
        planLabel: state.draft.scenario.label,
      });
    } catch (error) {
      state.draft.notice = error?.message || 'تعذر إنشاء ملف Excel.';
      state.draft.noticeType = 'error';
      render();
    }
  }

  if (action === 'export' && selected()) {
    try {
      await exportScenarioExcel(selected(), state.data, {
        planLabel: selected().label,
      });
    } catch (error) {
      state.notice = error?.message || 'تعذر إنشاء ملف Excel.';
      render();
    }
  }
  if (action === 'print') {
    const isDraft = state.resultView === 'draft' && state.draft?.scenario;
    const scenario = isDraft ? state.draft.scenario : selected();
    if (scenario) {
      printScenarioReport(scenario, state.data, {
        approved: Boolean(isDraft && state.draft.approved),
        approvedAt: isDraft ? state.draft.approvedAt : '',
        isDraft: Boolean(isDraft && !state.draft.approved),
        planLabel: scenario.label,
      });
    }
  }

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
