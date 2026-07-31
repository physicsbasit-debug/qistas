import {
  buildInitialCustomSelection,
  createDefaultAssignmentPolicy,
  normalizeAssignmentPolicy,
  POLICY_MODES,
} from '../domain/assignmentPolicy.js';
import { normalizeGradeRange } from '../domain/grades.js';
import { normalizePlanScope, planScopePlanName } from '../domain/planScope.js';

const STORAGE_KEY = 'qistas:v1';
const WORKSPACE_KEY = 'qistas:workspace:v1';
const PLAN_LIBRARY_KEY = 'qistas:plans:v1';

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRequirements(source, fallback) {
  const requirements = Array.isArray(source?.requirements)
    ? source.requirements
    : fallback.requirements;

  return requirements.map((requirement) => ({
    ...requirement,
    sections: Number(requirement.sections) || 0,
    periodsPerSection: Number(requirement.periodsPerSection) || 0,
  }));
}

function normalizeTeacher(teacher, requirements) {
  let assignmentPolicy = teacher.assignmentPolicy
    ? normalizeAssignmentPolicy(teacher.assignmentPolicy)
    : createDefaultAssignmentPolicy();

  if (teacher.assignmentPolicy?.mode === 'usual') {
    assignmentPolicy = {
      ...assignmentPolicy,
      mode: POLICY_MODES.CUSTOM,
      selectedRequirementIds: buildInitialCustomSelection(teacher, requirements),
    };
  }

  if (assignmentPolicy.mode === POLICY_MODES.CUSTOM
    && assignmentPolicy.selectedRequirementIds.length === 0) {
    assignmentPolicy.selectedRequirementIds = buildInitialCustomSelection(teacher, requirements);
  }

  return {
    ...teacher,
    allowedSubjects: Array.isArray(teacher.allowedSubjects) ? teacher.allowedSubjects : [],
    isLead: Boolean(teacher.isLead),
    active: teacher.active !== false,
    autoName: teacher.autoName === true,
    assignmentPolicy,
  };
}

export function normalizeAppData(data, fallback) {
  const source = data && typeof data === 'object' ? data : fallback;
  const requirements = normalizeRequirements(source, fallback);
  const sourceSettings = source.settings && typeof source.settings === 'object'
    ? source.settings
    : {};

  const gradeRange = normalizeGradeRange(source.gradeRange, requirements, fallback.gradeRange || { start: 1, end: 12 });
  const teachers = Array.isArray(source.teachers)
    ? source.teachers.map((teacher) => normalizeTeacher(teacher, requirements))
    : clone(fallback.teachers);

  const planScope = normalizePlanScope(source.planScope, requirements, teachers, gradeRange);

  return {
    ...clone(fallback),
    ...source,
    planId: String(source.planId || fallback.planId || 'legacy-plan'),
    planName: planScopePlanName(planScope),
    gradeRange,
    settings: {
      teacherMaxLoad: Number(sourceSettings.teacherMaxLoad) || 18,
      leadMaxLoad: Number(sourceSettings.leadMaxLoad) || 12,
      // Kept only for backward-compatible stored data. It no longer affects plan setup.
      schoolShift: 'single',
    },
    teachers,
    requirements,
    planScope,
  };
}

export function loadAppData(fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeAppData(fallback, fallback);
    return normalizeAppData(JSON.parse(raw), fallback);
  } catch {
    return normalizeAppData(fallback, fallback);
  }
}

export function saveAppData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearAppData() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_KEY);
}


export function loadWorkspace() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWorkspace(workspace) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
}

export function clearWorkspace() {
  localStorage.removeItem(WORKSPACE_KEY);
}

export function loadPlanLibrary() {
  try {
    const raw = localStorage.getItem(PLAN_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
        .filter((item) => item && typeof item === 'object' && item.id && item.data)
        .map((item) => ({
          ...item,
          name: planScopePlanName(item.data.planScope),
          data: {
            ...item.data,
            planName: planScopePlanName(item.data.planScope),
          },
        }))
      : [];
  } catch {
    return [];
  }
}

export function savePlanLibrary(plans) {
  localStorage.setItem(PLAN_LIBRARY_KEY, JSON.stringify(Array.isArray(plans) ? plans : []));
}
