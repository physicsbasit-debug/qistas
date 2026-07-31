import {
  buildInitialCustomSelection,
  createDefaultAssignmentPolicy,
  normalizeAssignmentPolicy,
  POLICY_MODES,
} from '../domain/assignmentPolicy.js';
import { normalizeGradeRange } from '../domain/grades.js';

const STORAGE_KEY = 'qistas:v1';
const WORKSPACE_KEY = 'qistas:workspace:v1';

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
    assignmentPolicy,
  };
}

export function normalizeAppData(data, fallback) {
  const source = data && typeof data === 'object' ? data : fallback;
  const requirements = normalizeRequirements(source, fallback);
  const sourceSettings = source.settings && typeof source.settings === 'object'
    ? source.settings
    : {};

  return {
    ...clone(fallback),
    ...source,
    gradeRange: normalizeGradeRange(source.gradeRange, requirements, fallback.gradeRange || { start: 1, end: 12 }),
    settings: {
      teacherMaxLoad: Number(sourceSettings.teacherMaxLoad) || 18,
      leadMaxLoad: Number(sourceSettings.leadMaxLoad) || 12,
    },
    teachers: Array.isArray(source.teachers)
      ? source.teachers.map((teacher) => normalizeTeacher(teacher, requirements))
      : clone(fallback.teachers),
    requirements,
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
