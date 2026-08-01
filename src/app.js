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
  analyzeDistributionFeasibility,
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
  loadPlanLibrary,
  normalizeAppData,
  saveAppData,
  savePlanLibrary,
  saveWorkspace,
} from './services/storage.js';
import { printScenarioReport } from './services/export.js';
import { exportScenarioExcel } from './services/excelExport.js';
import {
  buildRequirementsForScope,
  normalizePlanScope,
  PLAN_SCOPE_MODE,
  planScopeLabel,
  planScopePlanName,
  planScopeSubjects,
  requirementBelongsToScope,
  scopeSignature,
  subjectsAvailableInRange,
} from './domain/planScope.js';
import {
  compareGrades,
  gradeLabel,
  gradeNumber,
  gradeRangeLabel,
  gradesInRange,
  normalizeGradeRange,
} from './domain/grades.js';
import {
  DEPARTMENT_TEMPLATES,
  SUBJECT_CATALOG,
  recommendedPeriods,
  subjectByLabel,
  templateById,
} from './domain/subjects.js';

const app = document.querySelector('#app');
const INITIAL_SEARCH_ATTEMPTS = 8;
const ALTERNATIVE_SEARCH_ATTEMPTS = 12;
const ALTERNATIVE_SEARCH_WAVES = 3;
const REBALANCE_MODEL_LIMIT = 8;
const REBALANCE_SEARCH_ATTEMPTS = 72;
const MAX_DISPLAY_MODELS = 30;

const storedWorkspace = loadWorkspace();
const initialData = loadAppData(seedData);

let state = {
  step: storedWorkspace?.draft ? 2 : 0,
  data: initialData,
  pendingPlanScope: clone(initialData.planScope),
  planLibrary: loadPlanLibrary(),
  selectedPlanId: '',
  scenarios: [],
  selectedId: 'balanced',
  errors: [],
  notice: '',
  noticeType: 'success',
  generating: false,
  generationRound: 0,
  searchStats: { attempts: 0, uniqueFound: 0, completeFound: 0 },
  feasibility: null,
  partialPreview: false,
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

const activeGradeRange = () => normalizeGradeRange(
  state.data.gradeRange,
  state.data.requirements,
  { start: 1, end: 12 },
);
const gradeOptions = (selectedGrade = '') => {
  const available = gradesInRange(activeGradeRange());
  const selectedNumber = gradeNumber(selectedGrade);
  const options = [...available];
  if (Number.isFinite(selectedNumber) && !options.some((grade) => grade.number === selectedNumber)) {
    options.push({ number: selectedNumber, label: gradeLabel(selectedNumber) || selectedGrade });
    options.sort((a, b) => a.number - b.number);
  }
  return options.map((grade) => `
    <option value="${esc(grade.label)}" ${grade.label === selectedGrade ? 'selected' : ''}>
      الصف ${esc(grade.label)}
    </option>`).join('');
};
const outOfRangeRequirements = () => {
  const range = activeGradeRange();
  return state.data.requirements.filter((requirement) => {
    const number = gradeNumber(requirement.grade);
    return Number.isFinite(number) && (number < range.start || number > range.end);
  });
};
const nextRequirementGrade = () => {
  const last = state.data.requirements.at(-1)?.grade;
  const lastNumber = gradeNumber(last);
  const range = activeGradeRange();
  return Number.isFinite(lastNumber) && lastNumber >= range.start && lastNumber <= range.end
    ? gradeLabel(lastNumber)
    : gradeLabel(range.start);
};

const normalizedPendingScope = () => normalizePlanScope(
  state.pendingPlanScope,
  state.data.requirements,
  state.data.teachers,
  activeGradeRange(),
);
const currentScopeSubjects = () => planScopeSubjects(state.data.planScope, activeGradeRange());
const currentScopeLabels = () => currentScopeSubjects().map((item) => item.label);
const allSubjectsInActiveRange = () => subjectsAvailableInRange(
  SUBJECT_CATALOG.map((item) => item.id),
  activeGradeRange(),
);
const requirementsOutsideScope = () => state.data.requirements.filter(
  (requirement) => !requirementBelongsToScope(requirement, state.data.planScope),
);

function savePlanSnapshot(data = state.data) {
  const snapshot = {
    id: String(data.planId || uid()),
    name: planScopePlanName(data.planScope),
    updatedAt: new Date().toISOString(),
    data: clone(data),
  };
  const index = state.planLibrary.findIndex((item) => item.id === snapshot.id);
  if (index >= 0) state.planLibrary[index] = snapshot;
  else state.planLibrary.unshift(snapshot);
  state.planLibrary = state.planLibrary
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 20);
  savePlanLibrary(state.planLibrary);
  return snapshot;
}

function planDefaultName(scope = state.data.planScope) {
  return planScopePlanName(scope);
}

function normalizedSubjectToken(value = '') {
  return String(value || '').trim().replace(/^ال/u, '');
}

function generatedTeacherName(name = '') {
  const normalized = String(name || '').trim();
  if (!normalized) return true;
  if (normalized === 'المعلم الأول') return true;
  if (/^معلم\s+\d+$/u.test(normalized)) return true;
  const match = normalized.match(/^معلم\s+(.+?)\s+\d+$/u);
  if (!match) return false;
  const embedded = normalizedSubjectToken(match[1]);
  return SUBJECT_CATALOG.some((item) => normalizedSubjectToken(item.label) === embedded);
}

function buildTeachersForScope(
  scope,
  count,
  hasLead,
  { preservePolicies = true, preserveNames = true } = {},
) {
  const subjects = planScopeSubjects(scope, activeGradeRange());
  const labels = subjects.map((item) => item.label);
  const fallbackSpecialty = labels[0] || '';
  const existing = [...state.data.teachers].sort((a, b) => Number(b.isLead) - Number(a.isLead));
  const total = Math.max(1, Number(count) || 1);
  const teachers = [];
  const specialtyCounters = new Map();

  for (let index = 0; index < total; index += 1) {
    const previous = existing[index];
    const isLead = Boolean(hasLead && index === 0);
    const specialty = scope.mode === PLAN_SCOPE_MODE.SINGLE
      ? fallbackSpecialty
      : labels.includes(previous?.specialty)
        ? previous.specialty
        : labels[(index - (hasLead ? 1 : 0) + labels.length) % Math.max(1, labels.length)] || fallbackSpecialty;
    const assignmentPolicy = preservePolicies && previous
      ? normalizeAssignmentPolicy(previous.assignmentPolicy)
      : createDefaultAssignmentPolicy();

    const specialtyIndex = isLead
      ? 0
      : (specialtyCounters.get(specialty) || 0) + 1;
    if (!isLead) specialtyCounters.set(specialty, specialtyIndex);
    const automaticName = isLead
      ? 'المعلم الأول'
      : specialty
        ? `معلم ${specialty} ${specialtyIndex}`
        : `معلم ${specialtyIndex}`;
    const canPreserveName = Boolean(
      preserveNames
      && previous?.name
      && previous.autoName !== true
      && !generatedTeacherName(previous.name),
    );

    teachers.push({
      id: previous?.id || uid(),
      name: canPreserveName ? previous.name : automaticName,
      autoName: !canPreserveName,
      specialty,
      isLead,
      active: previous?.active !== false,
      allowedSubjects: [],
      assignmentPolicy,
    });
  }

  return teachers;
}

function applyPlanConfiguration() {
  const pending = normalizedPendingScope();
  const currentSignature = scopeSignature(state.data.planScope);
  const pendingSignature = scopeSignature(pending);
  const scopeChanged = currentSignature !== pendingSignature;

  if (scopeChanged && (state.data.requirements.length || state.data.teachers.length)) {
    savePlanSnapshot();
  }

  const requirements = buildRequirementsForScope(
    pending,
    activeGradeRange(),
    undefined,
    scopeChanged ? [] : state.data.requirements,
  );
  const teachers = buildTeachersForScope(
    pending,
    pending.teacherCount,
    pending.hasLead,
    {
      preservePolicies: !scopeChanged,
      preserveNames: !scopeChanged,
    },
  );
  const planName = planDefaultName(pending);

  state.data = {
    ...state.data,
    planId: scopeChanged ? uid() : state.data.planId,
    planName,
    departmentName: scopeChanged || !state.data.departmentName
      ? pending.mode === PLAN_SCOPE_MODE.SINGLE
        ? planScopeLabel(pending)
        : `قسم ${planScopeLabel(pending)}`
      : state.data.departmentName,
    planScope: clone(pending),
    teachers,
    requirements,
  };
  state.pendingPlanScope = clone(pending);
  state.notice = scopeChanged
    ? `تم إعداد خطة مستقلة لـ«${planScopeLabel(pending)}» وتهيئة ${teachers.length} معلمين لها.`
    : `تم تحديث متطلبات ${planScopeLabel(pending)} وعدد المعلمين مع الحفاظ على الأسماء المدخلة.`;
  state.noticeType = 'success';
  invalidateResults();
  saveAppData(state.data);
  render();
}

function openSavedPlan(planId) {
  const record = state.planLibrary.find((item) => item.id === planId);
  if (!record) return;
  savePlanSnapshot();
  state.data = normalizeAppData(record.data, seedData);
  state.pendingPlanScope = clone(state.data.planScope);
  state.selectedPlanId = '';
  state.step = 0;
  state.notice = `تم فتح الخطة: ${record.name}.`;
  state.noticeType = 'success';
  invalidateResults();
  saveAppData(state.data);
  render();
}

function createNewPlan() {
  savePlanSnapshot();
  const base = clone(seedData);
  const range = activeGradeRange();
  state.data = normalizeAppData({
    ...base,
    planId: uid(),
    planName: planScopePlanName({ mode: PLAN_SCOPE_MODE.SINGLE, subjectId: 'arabic' }),
    schoolName: state.data.schoolName,
    academicYear: state.data.academicYear,
    gradeRange: range,
    settings: clone(state.data.settings),
    departmentName: '',
    planScope: {
      mode: PLAN_SCOPE_MODE.SINGLE,
      templateId: 'arabic',
      subjectId: 'arabic',
      selectedSubjectIds: [],
      teacherCount: 1,
      hasLead: false,
    },
    teachers: [],
    requirements: [],
  }, seedData);
  state.pendingPlanScope = clone(state.data.planScope);
  state.step = 0;
  state.notice = 'تم إنشاء خطة جديدة نظيفة. اختر المادة أو القسم ثم اضغط تهيئة الخطة.';
  state.noticeType = 'success';
  invalidateResults();
  saveAppData(state.data);
  render();
}

function invalidateResults() {
  state.scenarios = [];
  state.errors = [];
  state.generationRound = 0;
  state.searchStats = { attempts: 0, uniqueFound: 0, completeFound: 0 };
  state.feasibility = null;
  state.partialPreview = false;
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

  if (kind === 'gradeRange') {
    const range = activeGradeRange();
    range[field] = Number(value);
    if (field === 'start' && range.start > range.end) range.end = range.start;
    if (field === 'end' && range.end < range.start) range.start = range.end;
    state.data.gradeRange = normalizeGradeRange(range, state.data.requirements, { start: 1, end: 12 });
    state.pendingPlanScope = normalizePlanScope(
      state.pendingPlanScope,
      state.data.requirements,
      state.data.teachers,
      state.data.gradeRange,
    );
  }

  if (kind === 'settings') {
    state.data.settings[field] = Number(value);
  }

  if (kind === 'teacher') {
    const teacher = state.data.teachers.find((item) => item.id === id);
    if (!teacher) return;
    if (field === 'isLead') {
      teacher[field] = value === 'true';
      state.data.planScope.hasLead = state.data.teachers.some((item) => item.isLead);
      state.pendingPlanScope.hasLead = state.data.planScope.hasLead;
    } else {
      teacher[field] = value;
      if (field === 'name') teacher.autoName = false;
      if (field === 'specialty' && teacher.autoName === true) {
        const sameSpecialtyBefore = state.data.teachers
          .slice(0, state.data.teachers.indexOf(teacher))
          .filter((item) => !item.isLead && item.specialty === value).length;
        teacher.name = teacher.isLead ? 'المعلم الأول' : `معلم ${value} ${sameSpecialtyBefore + 1}`;
      }
    }
  }

  if (kind === 'req') {
    const requirement = state.data.requirements.find((item) => item.id === id);
    if (!requirement) return;
    requirement[field] = ['sections', 'periodsPerSection'].includes(field)
      ? Number(value)
      : value;
    if (field === 'grade' && subjectByLabel(requirement.subject)) {
      requirement.periodsPerSection = recommendedPeriods(
        requirement.grade,
        requirement.subject,
      );
    }
    if (field === 'subject' && subjectByLabel(value)) {
      requirement.periodsPerSection = recommendedPeriods(
        requirement.grade,
        value,
      );
    }
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

function planLibraryPanel() {
  const plans = state.planLibrary;
  return `
    <div class="plan-library-bar">
      <div class="current-plan-copy">
        <span class="plan-dot" aria-hidden="true"></span>
        <div><small>الخطة الحالية</small><strong>${esc(planDefaultName())}</strong></div>
      </div>
      <div class="plan-library-actions">
        <label class="saved-plan-select">الخطط المحفوظة
          <select data-plan-library-select ${plans.length ? '' : 'disabled'}>
            <option value="">${plans.length ? 'اختر خطة محفوظة' : 'لا توجد خطط محفوظة بعد'}</option>
            ${plans.map((item) => `<option value="${esc(item.id)}" ${state.selectedPlanId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
          </select>
        </label>
        <button class="button secondary compact" data-action="open-plan" ${state.selectedPlanId ? '' : 'disabled'}>فتح</button>
        <button class="button secondary compact" data-action="save-plan">حفظ الخطة</button>
        <button class="button secondary compact" data-action="new-plan">خطة جديدة</button>
        <button class="button ghost-danger compact" data-action="delete-saved-plan" ${state.selectedPlanId ? '' : 'disabled'}>حذف المحفوظة</button>
      </div>
    </div>`;
}

function scopeSetupCard() {
  const pending = normalizedPendingScope();
  const activeSubjects = allSubjectsInActiveRange();
  const template = templateById(pending.templateId);
  const templateSubjects = subjectsAvailableInRange(template.subjectIds, activeGradeRange());
  const selectedIds = new Set(pending.selectedSubjectIds);
  const currentChanged = scopeSignature(pending) !== scopeSignature(state.data.planScope);

  return `
    <div class="scope-setup-card">
      <div class="scope-heading">
        <div>
          <p class="eyebrow">نطاق الخطة</p>
          <h3>ماذا تريد أن توزّع؟</h3>
          <p class="muted">اختر مادة واحدة أو قسمًا متعدد المواد. لن تدخل أي مادة أخرى في المعلمين أو النتائج أو التقارير.</p>
        </div>
        <span class="scope-status ${currentChanged ? 'changed' : ''}">${currentChanged ? 'تغييرات غير مطبقة' : 'النطاق مطبق'}</span>
      </div>

      <div class="scope-choice-grid">
        <label>نوع الخطة
          <select data-plan-scope="mode">
            <option value="single" ${pending.mode === PLAN_SCOPE_MODE.SINGLE ? 'selected' : ''}>مادة واحدة</option>
            <option value="department" ${pending.mode === PLAN_SCOPE_MODE.DEPARTMENT ? 'selected' : ''}>قسم متعدد المواد</option>
          </select>
        </label>

        ${pending.mode === PLAN_SCOPE_MODE.SINGLE ? `
          <label>المادة
            <select data-plan-scope="subjectId">
              ${activeSubjects.map((item) => `<option value="${esc(item.id)}" ${item.id === pending.subjectId ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
            </select>
          </label>` : `
          <label>القسم
            <select data-plan-scope="templateId">
              ${DEPARTMENT_TEMPLATES.map((item) => `<option value="${esc(item.id)}" ${item.id === pending.templateId ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
            </select>
          </label>`}
      </div>

      ${pending.mode === PLAN_SCOPE_MODE.SINGLE ? '' : `
        <div class="department-scope-grid">
          <div class="department-subjects">
            <span>المواد الداخلة في الخطة</span>
            <div class="scope-subject-chips">
              ${templateSubjects.map((item) => `
                <label class="scope-subject-chip ${selectedIds.has(item.id) ? 'selected' : ''}">
                  <input type="checkbox" data-plan-subject-id="${esc(item.id)}" ${selectedIds.has(item.id) ? 'checked' : ''}>
                  <span>${esc(item.label)}</span>
                </label>`).join('') || '<small class="muted">لا توجد مواد من هذا القسم ضمن نطاق الصفوف الحالي.</small>'}
            </div>
          </div>
        </div>`}

      <div class="teacher-count-strip">
        <div>
          <strong>فريق المادة أو القسم</strong>
          <p class="muted">أدخل العدد الإجمالي. المعلم الأول، إن وجد، محسوب ضمن العدد.</p>
        </div>
        <label>عدد المعلمين
          <input type="number" min="1" max="100" data-plan-scope="teacherCount" value="${pending.teacherCount}">
        </label>
        <label class="lead-toggle"><input type="checkbox" data-plan-scope-check="hasLead" ${pending.hasLead ? 'checked' : ''}><span>يوجد معلم أول ضمن العدد</span></label>
      </div>

      <div class="scope-actions">
        <button class="button primary" data-action="apply-plan-configuration">اعتماد إعداد الخطة</button>
        <small>يطبّق المادة والشعب وعدد المعلمين معًا. عند تغيير المادة أو القسم تُحفظ الخطة السابقة تلقائيًا.</small>
      </div>
    </div>`;
}

function requirementSubjectOptions(requirement) {
  const labels = currentScopeLabels();
  const options = labels.includes(requirement.subject) ? labels : [requirement.subject, ...labels].filter(Boolean);
  return options.map((label) => `<option value="${esc(label)}" ${label === requirement.subject ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function requirementsSetupSection() {
  return `
    <details class="requirements-details" open>
      <summary>
        <div><strong>الشعب والحصص</strong><small>عدّل عدد الشعب وحصص الشعبة فقط. المواد محصورة في نطاق الخطة.</small></div>
        <span>${state.data.requirements.length} مقرر</span>
      </summary>
      <div class="requirements-details-body">
        <div class="section-heading compact-heading">
          <div><h3>متطلبات التوزيع</h3><p class="muted">تُنشأ تلقائيًا بحسب المادة ونطاق الصفوف، ويمكن تعديل الأرقام يدويًا.</p></div>
          <button class="button secondary compact" data-action="add-req"><span aria-hidden="true">＋</span> إضافة صف</button>
        </div>
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>الصف</th><th>المادة</th><th>عدد الشعب</th><th>حصص الشعبة</th><th>الإجمالي</th><th></th></tr></thead>
            <tbody>
              ${state.data.requirements.map((requirement) => `
                <tr>
                  <td data-label="الصف"><select data-path="req:${requirement.id}:grade">${gradeOptions(requirement.grade)}</select></td>
                  <td data-label="المادة" class="subject-cell"><select data-path="req:${requirement.id}:subject">${requirementSubjectOptions(requirement)}</select></td>
                  <td data-label="عدد الشعب"><input class="number" type="number" min="1" data-path="req:${requirement.id}:sections" value="${requirement.sections}"></td>
                  <td data-label="حصص الشعبة"><input class="number" type="number" min="1" data-path="req:${requirement.id}:periodsPerSection" value="${requirement.periodsPerSection}"></td>
                  <td data-label="الإجمالي"><strong class="row-total">${Number(requirement.sections) * Number(requirement.periodsPerSection)}</strong></td>
                  <td class="row-action"><button class="icon-button danger" data-action="delete-req" data-id="${requirement.id}">×</button></td>
                </tr>`).join('') || '<tr><td colspan="6"><div class="empty-table-state">اختر المادة أو القسم ثم اضغط «اعتماد إعداد الخطة».</div></td></tr>'}
            </tbody>
          </table>
        </div>
        ${outOfRangeRequirements().length ? `<div class="alert warning">يوجد ${outOfRangeRequirements().length} مقرر خارج نطاق المدرسة الحالي.</div>` : ''}
        ${requirementsOutsideScope().length ? `<div class="alert error">يوجد ${requirementsOutsideScope().length} مقرر من خارج مادة أو قسم الخطة. اضغط «اعتماد إعداد الخطة» لتنظيفها.</div>` : ''}
      </div>
    </details>`;
}

function setupPanel() {
  return `
    <section class="panel page-panel stack-lg">
      <div class="panel-intro">
        <span class="panel-icon" aria-hidden="true">١</span>
        <div>
          <p class="eyebrow">الخطوة الأولى</p>
          <h2>إعداد خطة التوزيع</h2>
          <p class="muted">بيانات المدرسة، المادة، عدد المعلمين، الشعب والحصص في مكان واحد منظم.</p>
        </div>
      </div>

      ${planLibraryPanel()}
      ${state.notice ? `<div class="alert ${state.noticeType === 'error' ? 'error' : state.noticeType === 'warning' ? 'warning' : 'success'}">${esc(state.notice)}</div>` : ''}

      <div class="form-grid two">
        <label>اسم المدرسة
          <input data-path="root::schoolName" value="${esc(state.data.schoolName)}">
        </label>
        <label>السنة الدراسية
          <input data-path="root::academicYear" value="${esc(state.data.academicYear || '')}" placeholder="2026/2027">
        </label>
      </div>
      <div class="auto-plan-name">
        <span>اسم الخطة تلقائيًا</span>
        <strong>${esc(planDefaultName(normalizedPendingScope()))}</strong>
      </div>

      <div class="grade-range-card">
        <div class="grade-range-copy">
          <span class="range-icon" aria-hidden="true">١٢</span>
          <div><strong>الصفوف التي تخدمها المدرسة</strong><p class="muted">اختر نطاق المدرسة مرة واحدة من الأول إلى الثاني عشر.</p></div>
        </div>
        <div class="grade-range-fields">
          <label>من الصف<select data-path="gradeRange::start">${Array.from({ length: 12 }, (_, index) => index + 1).map((number) => `<option value="${number}" ${activeGradeRange().start === number ? 'selected' : ''}>${esc(gradeLabel(number))}</option>`).join('')}</select></label>
          <label>إلى الصف<select data-path="gradeRange::end">${Array.from({ length: 12 }, (_, index) => index + 1).map((number) => `<option value="${number}" ${activeGradeRange().end === number ? 'selected' : ''}>${esc(gradeLabel(number))}</option>`).join('')}</select></label>
        </div>
        <div class="grade-presets" aria-label="نطاقات جاهزة">
          ${[[1, 4, '1-4'], [5, 8, '5-8'], [8, 10, '8-10'], [9, 12, '9-12'], [1, 12, '1-12']].map(([start, end, label]) => `<button class="range-preset ${activeGradeRange().start === start && activeGradeRange().end === end ? 'active' : ''}" data-action="set-grade-range" data-start="${start}" data-end="${end}">${label}</button>`).join('')}
        </div>
        <div class="grade-range-summary"><span>النطاق الحالي</span><strong>${esc(gradeRangeLabel(activeGradeRange()))}</strong></div>
      </div>

      <div class="simple-settings curriculum-settings compact-settings">
        <div><strong>سقف الأنصبة</strong><p class="muted">حدّد السقف مرة واحدة، ثم يتولى قِسطاس الموازنة.</p></div>
        <label>سقف المعلم<input type="number" min="1" data-path="settings::teacherMaxLoad" value="${state.data.settings.teacherMaxLoad}"></label>
        <label>سقف المعلم الأول<input type="number" min="1" data-path="settings::leadMaxLoad" value="${state.data.settings.leadMaxLoad}"></label>
      </div>

      ${scopeSetupCard()}
      ${requirementsSetupSection()}

      <div class="kpi-grid">
        <article class="kpi kpi-teachers"><span>المعلمون النشطون</span><strong>${state.data.teachers.filter((teacher) => teacher.active).length}</strong><small>ضمن الخطة الحالية</small></article>
        <article class="kpi kpi-sections"><span>الشعب والمقررات</span><strong>${totalSections()}</strong><small>تكليفًا مطلوبًا</small></article>
        <article class="kpi kpi-periods"><span>إجمالي الحصص</span><strong>${totalPeriods()}</strong><small>حصة أسبوعية</small></article>
      </div>

      <div class="note"><span class="note-icon" aria-hidden="true">✓</span><span>تُحفظ بياناتك تلقائيًا، وتبقى كل خطة معزولة عن مواد الخطط الأخرى.</span></div>
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

function teacherEditor(teacher, index) {
  const policy = teacherPolicy(teacher);
  return `
    <article class="teacher-editor ${teacher.active ? '' : 'inactive'}">
      <header class="teacher-editor-header">
        <div class="teacher-title">
          <span class="teacher-avatar">${esc((teacher.name || 'م').trim().slice(0, 1))}<small>${index + 1}</small></span>
          <div>
            <strong>${esc(teacher.name || 'معلم جديد')}</strong>
            <div class="teacher-meta"><span>${esc(teacher.specialty || 'لم يحدد التخصص')}</span><span class="role-badge ${teacher.isLead ? 'lead' : ''}">${teacher.isLead ? 'معلم أول' : 'معلم'}</span></div>
          </div>
        </div>
        <div class="teacher-header-actions">
          <label class="switch-label"><input type="checkbox" data-check="teacher:${teacher.id}:active" ${teacher.active ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>نشط</span></label>
          <button class="icon-button danger" title="حذف المعلم" aria-label="حذف المعلم" data-action="delete-teacher" data-id="${teacher.id}">×</button>
        </div>
      </header>

      <div class="teacher-simple-grid">
        <label>اسم المعلم
          <input data-path="teacher:${teacher.id}:name" value="${esc(teacher.name)}">
        </label>
        <label>التخصص
          ${state.data.planScope.mode === PLAN_SCOPE_MODE.SINGLE
    ? `<input value="${esc(currentScopeLabels()[0] || teacher.specialty || '')}" readonly aria-readonly="true">`
    : `<select data-path="teacher:${teacher.id}:specialty">${currentScopeLabels().map((label) => `<option value="${esc(label)}" ${label === teacher.specialty ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`}
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
          ${state.data.planScope.mode === PLAN_SCOPE_MODE.DEPARTMENT
    && state.data.teachers.filter((item) => item.id !== teacher.id && item.specialty === teacher.specialty).length
    ? `<button class="text-button compact copy-policy-button" data-action="copy-policy" data-id="${teacher.id}">نسخ الإعداد لزملاء التخصص</button>`
    : ''}
        </div>
        ${policyContext(teacher)}
      </div>
    </article>`;
}

function teachersPanel() {
  return `
    <section class="panel page-panel stack-lg">
      <div class="section-heading">
        <div class="panel-intro">
          <span class="panel-icon" aria-hidden="true">٢</span>
          <div>
            <p class="eyebrow">الخطوة الثانية</p>
            <h2>المعلمون</h2>
            <p class="muted">اختر لكل معلم نطاقًا واضحًا، وقِسطاس يتولى الموازنة ضمنه.</p>
          </div>
        </div>
        <button class="button secondary" data-action="add-teacher"><span aria-hidden="true">＋</span> إضافة معلم</button>
      </div>
      ${state.notice ? `<div class="alert success">${esc(state.notice)}</div>` : ''}
      <div class="teacher-editor-list">
        ${state.data.teachers.map(teacherEditor).join('')}
      </div>
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
          ${state.generating ? 'جارٍ إنشاء بديل…' : 'نموذج بديل'}
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
            <button class="button secondary" data-action="export-draft"><span aria-hidden="true">⇩</span> تصدير Excel</button>
            <button class="button secondary" data-action="print"><span aria-hidden="true">▤</span> تقرير PDF</button>
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
      compareGrades(a.grade, b.grade)
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

function feasibilityPanel() {
  const check = state.feasibility;
  if (!check || check.feasible) return '';
  const primaryIssue = check.issues[0];
  const suggestions = [
    check.minimumAdditionalTeachers
      ? `إضافة ${check.minimumAdditionalTeachers === 1 ? 'معلم واحد على الأقل' : `${check.minimumAdditionalTeachers} معلمين على الأقل`} بسقف مناسب.`
      : '',
    'رفع سقف بعض المعلمين بما يغطي مقدار العجز.',
    'تقليل عدد الشعب أو حصص الشعبة إذا كانت البيانات المدخلة غير صحيحة.',
    check.issues.some((issue) => issue.type !== 'total-capacity')
      ? 'توسيع نطاق الإسناد للمعلمين الذين يمكنهم تدريس الصف أو المادة المتأثرة.'
      : '',
  ].filter(Boolean);

  return `
    <div class="panel feasibility-panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">فحص الجاهزية</p>
          <h2>لا يمكن إنشاء توزيع مكتمل بالبيانات الحالية</h2>
          <p class="muted">أوقف قِسطاس البحث قبل تشغيل المحرك لأن الخطة تحتوي عجزًا واضحًا.</p>
        </div>
        <span class="feasibility-status">تحتاج تعديلًا</span>
      </div>
      <div class="kpi-grid four feasibility-kpis">
        <article class="kpi"><span>الحصص المطلوبة</span><strong>${check.requiredPeriods}</strong></article>
        <article class="kpi"><span>الطاقة المتاحة</span><strong>${check.availablePeriods}</strong></article>
        <article class="kpi danger-kpi"><span>العجز</span><strong>${check.shortagePeriods}</strong></article>
        <article class="kpi danger-kpi"><span>شعب غير قابلة للتغطية</span><strong>${check.uncoveredSections}</strong></article>
      </div>
      <div class="alert error">
        <strong>${esc(primaryIssue?.title || 'الخطة غير قابلة للتغطية')}</strong>
        <p>${esc(primaryIssue?.message || '')}</p>
      </div>
      ${check.issues.length > 1 ? `
        <div class="feasibility-issues">
          <strong>قيود إضافية تحتاج مراجعة:</strong>
          <ul>${check.issues.slice(1, 5).map((issue) => `<li>${esc(issue.message)}</li>`).join('')}</ul>
        </div>` : ''}
      <div class="feasibility-suggestions">
        <strong>الحلول الأقرب:</strong>
        <ul>${suggestions.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </div>
      <div class="actions no-print">
        ${state.partialPreview ? '' : '<button class="button secondary" data-action="generate-partial">عرض توزيع جزئي للتشخيص</button>'}
        <button class="button ghost" data-action="step" data-id="0">تعديل الإعدادات</button>
      </div>
      <p class="muted feasibility-note">التوزيع الجزئي لا يمكن اعتماده أو تصديره كتقرير نهائي.</p>
    </div>`;
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
          ${state.partialPreview
    ? '<button class="button secondary" data-action="generate">إعادة فحص الخطة</button>'
    : '<button class="button primary" data-action="adopt-model">اعتماد مبدئي وتعديل</button><button class="button secondary" data-action="export"><span aria-hidden="true">⇩</span> تصدير Excel</button><button class="button secondary" data-action="print"><span aria-hidden="true">▤</span> تقرير PDF</button>'}
        </div>
      </div>

      ${state.partialPreview ? '' : modelNavigator(scenario)}

      <div class="kpi-grid four">
        <article class="kpi"><span>الحصص المسندة</span><strong>${assignedPeriods}</strong></article>
        <article class="kpi"><span>أعلى نصاب</span><strong>${scenario.highestLoad}</strong></article>
        <article class="kpi"><span>أقل نصاب</span><strong>${scenario.lowestLoad}</strong></article>
        <article class="kpi"><span>الفرق</span><strong>${scenario.loadSpread}</strong></article>
      </div>

      ${state.partialPreview
    ? '<div class="alert error"><strong>توزيع جزئي للتشخيص فقط.</strong> لا يمكن اعتماد هذه النتيجة أو تصديرها حتى تعالج العجز.</div>'
    : scenario.warnings.length ? `<div class="alert warning"><ul>${scenario.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div>` : '<div class="alert success">اكتمل توزيع جميع الشعب داخل الخيارات التي حددتها.</div>'}
      ${scenario.repairedCount ? `<div class="alert success smart-repair-note">أعاد قِسطاس موازنة ${scenario.relocationCount} تكليفات لتغطية ${scenario.repairedCount} شعبة كان يمكن أن تبقى غير مسندة في التوزيع التسلسلي.</div>` : ''}
      ${unassigned}

      <div class="teacher-results">
        ${scenario.summaries.map((summaryItem) => {
    const teacher = state.data.teachers.find((item) => item.id === summaryItem.teacherId);
    if (!teacher) return '';
    const sortedAssignments = [...summaryItem.assignments].sort((a, b) => (
      compareGrades(a.grade, b.grade)
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

      ${state.partialPreview ? '' : modelComparison()}
    </div>` : '';

  const modelCount = state.scenarios.length;
  const modelCountText = modelCount === 1
    ? `نموذج واحد مختلف${state.searchStats?.completeFound ? ' ومكتمل' : ''}`
    : modelCount === 2
      ? `نموذجين مختلفين${state.searchStats?.completeFound ? ' ومكتملين' : ''}`
      : modelCount >= 3 && modelCount <= 10
        ? `${modelCount} نماذج مختلفة${state.searchStats?.completeFound ? ' ومكتملة' : ''}`
        : `${modelCount} نموذجًا مختلفًا${state.searchStats?.completeFound ? ' ومكتملًا' : ''}`;
  const searchMessage = modelCount && !state.partialPreview
    ? `<div class="models-found"><strong>عثر قِسطاس على ${modelCountText}.</strong><span>تُحفظ البدائل التي طلبتها، ويمنع قِسطاس تكرار النموذج نفسه.</span></div>`
    : '';

  return `
    <section class="stack-lg">
      <div class="panel page-panel hero-result">
        <div class="panel-intro">
          <span class="panel-icon" aria-hidden="true">٣</span>
          <div>
            <p class="eyebrow">الخطوة الثالثة</p>
            <h2>نماذج التوزيع</h2>
            <p class="muted">يعرض أفضل توزيع أولًا. اطلب بديلًا جديدًا فقط عندما تحتاجه.</p>
          </div>
        </div>
        <div class="actions no-print">
          ${state.draft ? '<button class="button secondary" data-action="view-draft">فتح الخطة قيد التعديل</button>' : ''}
          <button class="button primary" data-action="generate" ${state.generating ? 'disabled' : ''}>${state.generating ? 'جارٍ إنشاء التوزيع…' : '✦ أنشئ التوزيع'}</button>
        </div>
      </div>

      ${state.errors.length ? `<div class="alert error"><strong>راجع هذه النقاط:</strong><ul>${state.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul></div>` : ''}
      ${feasibilityPanel()}
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
  if (state.partialPreview) {
    state.notice = 'التوزيع الجزئي للتشخيص فقط ولا يمكن اعتماده.';
    state.noticeType = 'warning';
    render();
    return;
  }
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
  state.step = 2;
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
        limit: REBALANCE_MODEL_LIMIT,
        attempts: REBALANCE_SEARCH_ATTEMPTS,
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
  const steps = ['إعداد الخطة', 'المعلمون', 'التوزيع'];
  const stepDescriptions = ['المادة والشعب والحصص', 'الأسماء وضوابط الإسناد', 'النماذج والمراجعة والاعتماد'];
  app.innerHTML = `
    <div class="app-shell step-${state.step}">
      <header class="app-header">
        <div class="brand-lockup">
          <div class="brand-mark">ق</div>
          <div class="brand-copy"><p>قِسطاس</p><span>أنصبة موزونة، توزيع أذكى</span></div>
        </div>
        <div class="header-actions">
          <span class="save-status"><i></i> محفوظ تلقائيًا</span>
          <button class="text-button reset-button" data-action="reset"><span aria-hidden="true">↻</span> استعادة المثال</button>
        </div>
      </header>
      <main>
        <section class="intro">
          <div class="intro-content">
            <span class="status-pill">الإصدار 1.3.1 · فحص الجاهزية قبل التوزيع</span>
            <h1>خطّط الأنصبة بوضوح،<br><em>واعتمد التوزيع بثقة.</em></h1>
            <p>حدّد المادة أو القسم، أدخل بيانات الشعب والمعلمين، ثم راجع توزيعًا متوازنًا واطلب بديلًا عند الحاجة.</p>
            <div class="hero-features"><span>✓ تهيئة حسب المادة</span><span>✓ الصفوف من 1 إلى 12</span><span>✓ بدائل محفوظة عند الطلب</span></div>
          </div>
          <div class="intro-stat">
            <span>إجمالي الحصص الأسبوعية</span>
            <strong>${totalPeriods()}</strong>
            <small>${totalSections()} تكليفًا تدريسيًا</small>
            <div class="intro-progress"><i style="width:${Math.min(100, ((state.step + 1) / 3) * 100)}%"></i></div>
            <b>المرحلة ${state.step + 1} من 3</b>
          </div>
        </section>
        <nav class="step-nav" aria-label="مراحل إعداد الخطة">
          ${steps.map((label, index) => `<button class="step-item ${state.step === index ? 'active' : index < state.step ? 'completed' : ''}" data-action="step" data-id="${index}" ${state.step === index ? 'aria-current="step"' : ''}><span>${index < state.step ? '✓' : index + 1}</span><b>${label}</b><small>${stepDescriptions[index]}</small></button>`).join('')}
        </nav>
        ${state.step === 0 ? setupPanel() : state.step === 1 ? teachersPanel() : resultsPanel()}
        <div class="footer-nav no-print">
          <div class="footer-progress"><span>الخطوة ${state.step + 1} من 3</span><strong>${steps[state.step]}</strong></div>
          <div class="footer-actions">
            <button class="button secondary" data-action="prev" ${state.step === 0 ? 'disabled' : ''}><span aria-hidden="true">→</span> السابق</button>
            <button class="button primary" data-action="next">${state.step < 2 ? 'التالي <span aria-hidden="true">←</span>' : state.resultView === 'draft' && state.draft ? 'اعتماد الخطة' : '✦ أنشئ التوزيع'}</button>
          </div>
        </div>
      </main>
    </div>`;
}

app.addEventListener('input', (event) => {
  if (event.target.dataset.path) updateData(event.target.dataset.path, event.target.value);
});

app.addEventListener('change', (event) => {
  if (event.target.dataset.planScope !== undefined) {
    const field = event.target.dataset.planScope;
    const pending = normalizedPendingScope();
    if (field === 'teacherCount') pending[field] = Math.max(1, Number(event.target.value) || 1);
    else pending[field] = event.target.value;

    if (field === 'mode') {
      if (pending.mode === PLAN_SCOPE_MODE.SINGLE && !pending.subjectId) {
        pending.subjectId = allSubjectsInActiveRange()[0]?.id || '';
      }
      if (pending.mode === PLAN_SCOPE_MODE.DEPARTMENT) {
        const template = templateById(pending.templateId);
        pending.selectedSubjectIds = subjectsAvailableInRange(template.subjectIds, activeGradeRange()).map((item) => item.id);
      }
    }

    if (field === 'templateId') {
      const template = templateById(pending.templateId);
      pending.selectedSubjectIds = subjectsAvailableInRange(template.subjectIds, activeGradeRange()).map((item) => item.id);
    }

    state.pendingPlanScope = normalizePlanScope(
      pending,
      state.data.requirements,
      state.data.teachers,
      activeGradeRange(),
    );
    render();
    return;
  }

  if (event.target.dataset.planScopeCheck !== undefined) {
    const pending = normalizedPendingScope();
    pending[event.target.dataset.planScopeCheck] = event.target.checked;
    state.pendingPlanScope = pending;
    render();
    return;
  }

  if (event.target.dataset.planSubjectId !== undefined) {
    const pending = normalizedPendingScope();
    const selectedIds = new Set(pending.selectedSubjectIds);
    if (event.target.checked) selectedIds.add(event.target.dataset.planSubjectId);
    else selectedIds.delete(event.target.dataset.planSubjectId);
    pending.selectedSubjectIds = [...selectedIds];
    state.pendingPlanScope = pending;
    render();
    return;
  }

  if (event.target.dataset.planLibrarySelect !== undefined) {
    state.selectedPlanId = event.target.value;
    render();
    return;
  }

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
    if (state.step === 0) {
      const setupNeedsApply = scopeSignature(normalizedPendingScope()) !== scopeSignature(state.data.planScope)
        || !state.data.requirements.length
        || !state.data.teachers.length;
      if (setupNeedsApply) {
        state.notice = 'اضغط «اعتماد إعداد الخطة» أولًا لتطبيق المادة وعدد المعلمين والشعب قبل الانتقال.';
        state.noticeType = 'warning';
        render();
        return;
      }
      state.step = 1;
      render();
    } else if (state.step === 1) {
      state.step = 2;
      render();
    } else if (state.resultView === 'draft' && state.draft) approveDraft();
    else await generate(false);
  }

  if (action === 'reset') {
    clearAppData();
    const data = normalizeAppData(clone(seedData), seedData);
    state = {
      step: 0,
      data,
      pendingPlanScope: clone(data.planScope),
      planLibrary: loadPlanLibrary(),
      selectedPlanId: '',
      scenarios: [],
      selectedId: 'balanced',
      errors: [],
      notice: 'تمت استعادة مثال العلوم دون حذف الخطط المحفوظة.',
      noticeType: 'success',
      generating: false,
      generationRound: 0,
      searchStats: { attempts: 0, uniqueFound: 0, completeFound: 0 },
      feasibility: null,
      partialPreview: false,
      resultView: 'models',
      draft: null,
    };
    persistRender();
  }

  if (action === 'add-teacher') {
    state.data.teachers.push({
      id: uid(),
      name: '',
      specialty: currentScopeLabels()[0] || '',
      isLead: false,
      active: true,
      assignmentPolicy: createDefaultAssignmentPolicy(),
    });
    state.data.planScope.teacherCount = state.data.teachers.length;
    state.pendingPlanScope = clone(state.data.planScope);
    invalidateResults();
    persistRender();
  }

  if (action === 'delete-teacher') {
    state.data.teachers = state.data.teachers.filter((item) => item.id !== button.dataset.id);
    state.data.planScope.teacherCount = Math.max(1, state.data.teachers.length);
    state.data.planScope.hasLead = state.data.teachers.some((teacher) => teacher.isLead);
    state.pendingPlanScope = clone(state.data.planScope);
    invalidateResults();
    persistRender();
  }

  if (action === 'apply-plan-configuration') applyPlanConfiguration();

  if (action === 'save-plan') {
    const snapshot = savePlanSnapshot();
    state.notice = `تم حفظ الخطة «${snapshot.name}» ضمن الخطط المحفوظة.`;
    state.noticeType = 'success';
    render();
  }

  if (action === 'open-plan' && state.selectedPlanId) openSavedPlan(state.selectedPlanId);
  if (action === 'new-plan') createNewPlan();
  if (action === 'delete-saved-plan' && state.selectedPlanId) {
    const record = state.planLibrary.find((item) => item.id === state.selectedPlanId);
    const accepted = globalThis.confirm?.(`حذف الخطة المحفوظة «${record?.name || 'الخطة'}»؟ لن تُحذف الخطة المفتوحة حاليًا.`) ?? true;
    if (accepted) {
      state.planLibrary = state.planLibrary.filter((item) => item.id !== state.selectedPlanId);
      savePlanLibrary(state.planLibrary);
      state.selectedPlanId = '';
      state.notice = 'تم حذف النسخة المحفوظة من مكتبة الخطط، وبقيت الخطة المفتوحة دون تغيير.';
      state.noticeType = 'success';
      render();
    }
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

  if (action === 'set-grade-range') {
    state.data.gradeRange = normalizeGradeRange({
      start: Number(button.dataset.start),
      end: Number(button.dataset.end),
    }, state.data.requirements, { start: 1, end: 12 });
    state.pendingPlanScope = normalizePlanScope(
      state.pendingPlanScope,
      state.data.requirements,
      state.data.teachers,
      activeGradeRange(),
    );
    invalidateResults();
    persistRender();
  }

  if (action === 'add-req') {
    const grade = nextRequirementGrade();
    const firstSubject = currentScopeLabels()[0] || '';
    if (!firstSubject) {
      state.notice = 'هيّئ المادة أو القسم أولًا قبل إضافة صف.';
      state.noticeType = 'warning';
      render();
    } else {
      state.data.requirements.push({
        id: uid(),
        grade,
        subject: firstSubject,
        sections: 1,
        periodsPerSection: recommendedPeriods(grade, firstSubject),
      });
      invalidateResults();
      persistRender();
    }
  }

  if (action === 'delete-req') {
    state.data.requirements = state.data.requirements.filter((item) => item.id !== button.dataset.id);
    invalidateResults();
    persistRender();
  }

  if (action === 'generate') await generate(false);
  if (action === 'generate-partial') await generate(false, true);

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

  if (action === 'generate-more' && !state.partialPreview) await generate(true);

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
    if (state.partialPreview) {
      state.notice = 'لا يمكن تصدير توزيع جزئي. عالج العجز أولًا.';
      state.noticeType = 'warning';
      render();
      return;
    }
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
    if (state.partialPreview) {
      state.notice = 'لا يمكن إنشاء تقرير رسمي لتوزيع جزئي.';
      state.noticeType = 'warning';
      render();
      return;
    }
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

async function generate(more = false, allowPartial = false) {
  state.errors = validateInputs(
    state.data.teachers,
    state.data.requirements,
    state.data.settings,
  );
  const outsideRange = outOfRangeRequirements();
  if (outsideRange.length) {
    state.errors.push(`يوجد ${outsideRange.length} مقرر خارج نطاق صفوف المدرسة الحالي. عدّل الصف أو وسّع النطاق أولًا.`);
  }
  const outsideScope = requirementsOutsideScope();
  if (outsideScope.length) {
    state.errors.push(`يوجد ${outsideScope.length} مقرر من خارج مادة أو قسم الخطة. أعد تهيئة الخطة أولًا.`);
  }
  const allowedSpecialties = new Set(currentScopeLabels());
  const invalidTeachers = state.data.teachers.filter((teacher) => (
    teacher.active && !allowedSpecialties.has(teacher.specialty)
  ));
  if (invalidTeachers.length) {
    state.errors.push(`يوجد ${invalidTeachers.length} معلم بتخصص خارج مواد الخطة الحالية.`);
  }

  if (state.errors.length) {
    state.feasibility = null;
    state.partialPreview = false;
    render();
    return;
  }

  const feasibility = analyzeDistributionFeasibility(
    state.data.teachers,
    state.data.requirements,
    state.data.settings,
  );
  state.feasibility = feasibility;

  if (!feasibility.feasible && !allowPartial) {
    state.scenarios = [];
    state.selectedId = '';
    state.searchStats = { attempts: 0, uniqueFound: 0, completeFound: 0 };
    state.partialPreview = false;
    state.notice = '';
    state.noticeType = 'warning';
    render();
    return;
  }

  state.generating = true;
  state.notice = '';
  render();
  await new Promise((resolve) => setTimeout(resolve, 10));

  try {
    if (!more) {
      const result = generateDistributionModels(
        state.data.teachers,
        state.data.requirements,
        state.data.settings,
        {
          limit: 1,
          attempts: allowPartial ? 1 : INITIAL_SEARCH_ATTEMPTS,
          seedOffset: 0,
          skipRepair: allowPartial,
          skipMutation: allowPartial,
        },
      );
      state.partialPreview = allowPartial && !feasibility.feasible;
      state.scenarios = state.partialPreview
        ? result.models.map((model) => ({
          ...model,
          label: 'توزيع جزئي للتشخيص',
          tag: 'غير صالح للاعتماد',
          description: 'يعرض أقصى تغطية أولية ممكنة دون بحث مطوّل، لتحديد موضع العجز فقط.',
        }))
        : result.models;
      state.generationRound = 0;
      state.searchStats = {
        attempts: result.attempts,
        uniqueFound: state.scenarios.length,
        completeFound: state.scenarios.filter(
          (scenario) => scenario.unassigned.length === 0 && scenario.overloadCount === 0,
        ).length,
      };
      state.selectedId = state.scenarios[0]?.id || '';
      state.notice = state.partialPreview
        ? 'تم إنشاء معاينة جزئية سريعة. هذه النتيجة للتشخيص فقط.'
        : state.scenarios.length
          ? ''
          : 'لم يتمكن قِسطاس من إنشاء توزيع ضمن القيود الحالية.';
      state.noticeType = state.partialPreview ? 'warning' : 'success';
      return;
    }

    if (state.partialPreview || !feasibility.feasible) return;

    const excluded = state.scenarios.map((scenario) => scenario.signature);
    let foundModel = null;
    let attemptsUsed = 0;
    let nextRound = state.generationRound;

    for (let wave = 0; wave < ALTERNATIVE_SEARCH_WAVES && !foundModel; wave += 1) {
      nextRound += 1;
      const result = generateDistributionModels(
        state.data.teachers,
        state.data.requirements,
        state.data.settings,
        {
          limit: 1,
          attempts: ALTERNATIVE_SEARCH_ATTEMPTS,
          seedOffset: nextRound,
          excludeSignatures: excluded,
        },
      );
      attemptsUsed += result.attempts;
      foundModel = result.models[0] || null;
      if (!foundModel && wave < ALTERNATIVE_SEARCH_WAVES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    state.generationRound = nextRound;
    state.searchStats.attempts += attemptsUsed;

    if (!foundModel) {
      state.notice = 'لم يتم العثور على توزيع جديد مختلف ضمن القيود الحالية.';
      state.noticeType = 'warning';
      return;
    }

    const newSignature = foundModel.signature;
    state.scenarios = rankDistributionModels(
      [...state.scenarios, foundModel],
      MAX_DISPLAY_MODELS,
    );
    const selectedAlternative = state.scenarios.find(
      (scenario) => scenario.signature === newSignature,
    );
    state.selectedId = selectedAlternative?.id || state.scenarios.at(-1)?.id || '';
    state.searchStats.uniqueFound = state.scenarios.length;
    state.searchStats.completeFound = state.scenarios.filter(
      (scenario) => scenario.unassigned.length === 0 && scenario.overloadCount === 0,
    ).length;
    state.notice = `تم إنشاء نموذج بديل مختلف وحفظه مع النماذج السابقة.`;
    state.noticeType = 'success';
  } finally {
    state.generating = false;
    render();
  }
}


function repairCurrentTeacherPlaceholders() {
  if (!state.data.teachers.length) return;
  const repaired = buildTeachersForScope(
    state.data.planScope,
    state.data.teachers.length,
    state.data.planScope.hasLead,
    { preservePolicies: true, preserveNames: true },
  );
  const changed = repaired.some((teacher, index) => (
    teacher.name !== state.data.teachers[index]?.name
    || teacher.specialty !== state.data.teachers[index]?.specialty
    || teacher.isLead !== state.data.teachers[index]?.isLead
  ));
  if (!changed) return;
  state.data.teachers = repaired;
  saveAppData(state.data);
}

repairCurrentTeacherPlaceholders();
render();
