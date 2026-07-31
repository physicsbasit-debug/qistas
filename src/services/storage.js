import { createDefaultAssignmentPolicy, normalizeAssignmentPolicy } from '../domain/assignmentPolicy.js';

const STORAGE_KEY = 'qistas:v1';

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTeacher(teacher) {
  return {
    ...teacher,
    allowedSubjects: Array.isArray(teacher.allowedSubjects) ? teacher.allowedSubjects : [],
    minLoad: Number(teacher.minLoad) || 0,
    targetLoad: Number(teacher.targetLoad) || 0,
    maxLoad: Number(teacher.maxLoad) || 0,
    isLead: Boolean(teacher.isLead),
    active: teacher.active !== false,
    assignmentPolicy: teacher.assignmentPolicy
      ? normalizeAssignmentPolicy(teacher.assignmentPolicy)
      : createDefaultAssignmentPolicy(),
  };
}

export function normalizeAppData(data, fallback) {
  const source = data && typeof data === 'object' ? data : fallback;
  return {
    ...clone(fallback),
    ...source,
    teachers: Array.isArray(source.teachers)
      ? source.teachers.map(normalizeTeacher)
      : clone(fallback.teachers),
    requirements: Array.isArray(source.requirements)
      ? source.requirements.map((requirement) => ({
        ...requirement,
        sections: Number(requirement.sections) || 0,
        periodsPerSection: Number(requirement.periodsPerSection) || 0,
      }))
      : clone(fallback.requirements),
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
}
