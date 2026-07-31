import { gradeNumber, gradesInRange, normalizeGradeRange } from './grades.js';
import {
  DEPARTMENT_TEMPLATES,
  recommendedPeriods,
  SCHOOL_SHIFT,
  subjectById,
  subjectByLabel,
  templateById,
} from './subjects.js';

export const PLAN_SCOPE_MODE = Object.freeze({
  SINGLE: 'single',
  DEPARTMENT: 'department',
});

const unique = (values) => [...new Set(values.filter(Boolean).map(String))];

function subjectIdsFromRequirements(requirements = []) {
  return unique(requirements.map((item) => subjectByLabel(item.subject)?.id));
}

function bestTemplateForSubjectIds(subjectIds = []) {
  const wanted = new Set(subjectIds);
  if (!wanted.size) return templateById('science');
  const exactOrContaining = DEPARTMENT_TEMPLATES
    .map((template) => ({
      template,
      overlap: template.subjectIds.filter((id) => wanted.has(id)).length,
      containsAll: [...wanted].every((id) => template.subjectIds.includes(id)),
    }))
    .sort((a, b) => Number(b.containsAll) - Number(a.containsAll) || b.overlap - a.overlap);
  return exactOrContaining[0]?.template || templateById('science');
}

export function subjectsAvailableInRange(subjectIds, range) {
  const normalized = normalizeGradeRange(range, [], { start: 1, end: 12 });
  const allowedGrades = new Set(gradesInRange(normalized).map((grade) => grade.number));
  return unique(subjectIds)
    .map(subjectById)
    .filter((item) => item && item.grades.some((grade) => allowedGrades.has(grade)));
}

export function inferPlanScope(requirements = [], teachers = [], range = { start: 1, end: 12 }) {
  const ids = subjectIdsFromRequirements(requirements);
  const mode = ids.length === 1 ? PLAN_SCOPE_MODE.SINGLE : PLAN_SCOPE_MODE.DEPARTMENT;
  const template = bestTemplateForSubjectIds(ids);
  const selectedSubjectIds = mode === PLAN_SCOPE_MODE.SINGLE
    ? ids.slice(0, 1)
    : ids.filter((id) => template.subjectIds.includes(id));
  const fallbackSubjects = subjectsAvailableInRange(template.subjectIds, range).map((item) => item.id);

  return {
    mode,
    templateId: template.id,
    subjectId: mode === PLAN_SCOPE_MODE.SINGLE ? (ids[0] || fallbackSubjects[0] || '') : '',
    selectedSubjectIds: mode === PLAN_SCOPE_MODE.DEPARTMENT
      ? (selectedSubjectIds.length ? selectedSubjectIds : fallbackSubjects)
      : [],
    teacherCount: Math.max(1, Number(teachers.length) || 1),
    hasLead: teachers.some((teacher) => teacher.isLead),
  };
}

export function normalizePlanScope(scope, requirements = [], teachers = [], range = { start: 1, end: 12 }) {
  const inferred = inferPlanScope(requirements, teachers, range);
  const mode = scope?.mode === PLAN_SCOPE_MODE.SINGLE
    ? PLAN_SCOPE_MODE.SINGLE
    : scope?.mode === PLAN_SCOPE_MODE.DEPARTMENT
      ? PLAN_SCOPE_MODE.DEPARTMENT
      : inferred.mode;
  const template = templateById(scope?.templateId || inferred.templateId);
  const availableTemplateSubjects = subjectsAvailableInRange(template.subjectIds, range).map((item) => item.id);
  const requestedSelected = unique(scope?.selectedSubjectIds);
  const selectedSubjectIds = requestedSelected.filter((id) => availableTemplateSubjects.includes(id));
  const inferredSingle = scope?.subjectId || inferred.subjectId;
  const singleSubject = subjectById(inferredSingle)
    && subjectsAvailableInRange([inferredSingle], range).length
    ? inferredSingle
    : availableTemplateSubjects[0] || '';

  return {
    mode,
    templateId: template.id,
    subjectId: mode === PLAN_SCOPE_MODE.SINGLE ? singleSubject : '',
    selectedSubjectIds: mode === PLAN_SCOPE_MODE.DEPARTMENT
      ? (selectedSubjectIds.length ? selectedSubjectIds : availableTemplateSubjects)
      : [],
    teacherCount: Math.max(1, Number(scope?.teacherCount) || Number(teachers.length) || 1),
    hasLead: scope?.hasLead === undefined ? inferred.hasLead : Boolean(scope.hasLead),
  };
}

export function planScopeSubjectIds(scope) {
  if (!scope) return [];
  return scope.mode === PLAN_SCOPE_MODE.SINGLE
    ? unique([scope.subjectId])
    : unique(scope.selectedSubjectIds);
}

export function planScopeSubjects(scope, range = { start: 1, end: 12 }) {
  return subjectsAvailableInRange(planScopeSubjectIds(scope), range);
}

export function planScopeLabel(scope) {
  if (!scope) return 'خطة توزيع';
  if (scope.mode === PLAN_SCOPE_MODE.SINGLE) {
    return subjectById(scope.subjectId)?.label || 'مادة واحدة';
  }
  return templateById(scope.templateId)?.label || 'قسم متعدد المواد';
}

export function scopeSignature(scope) {
  return `${scope?.mode || ''}|${scope?.templateId || ''}|${scope?.subjectId || ''}|${unique(scope?.selectedSubjectIds).sort().join(',')}`;
}

export function buildRequirementsForScope(
  scope,
  range,
  shift = SCHOOL_SHIFT.SINGLE,
  previousRequirements = [],
) {
  const normalizedRange = normalizeGradeRange(range, [], { start: 1, end: 12 });
  const selectedSubjects = planScopeSubjects(scope, normalizedRange);
  const previousBySignature = new Map(previousRequirements.map((item) => [
    `${gradeNumber(item.grade)}::${String(item.subject || '').trim()}`,
    item,
  ]));
  const rows = [];

  for (const grade of gradesInRange(normalizedRange)) {
    for (const item of selectedSubjects) {
      if (!item.grades.includes(grade.number)) continue;
      const previous = previousBySignature.get(`${grade.number}::${item.label}`);
      rows.push({
        id: previous?.id || `req-${grade.number}-${item.id}`,
        grade: grade.label,
        subject: item.label,
        sections: Math.max(1, Number(previous?.sections) || 1),
        periodsPerSection: Math.max(
          1,
          Number(previous?.periodsPerSection)
            || recommendedPeriods(grade.number, item.label, shift),
        ),
      });
    }
  }

  return rows;
}

export function requirementBelongsToScope(requirement, scope) {
  const id = subjectByLabel(requirement?.subject)?.id;
  return Boolean(id && planScopeSubjectIds(scope).includes(id));
}
