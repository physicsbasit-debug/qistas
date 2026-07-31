export const POLICY_MODES = Object.freeze({
  USUAL: 'usual',
  SPECIALTY_ONLY: 'specialty-only',
  SPECIALTY_GRADE: 'specialty-grade',
  SINGLE_REQUIREMENT: 'single-requirement',
  SPECIALTY_PLUS_EXTRA: 'specialty-plus-extra',
  CUSTOM: 'custom',
});

export const ASSIGNMENT_STATUS = Object.freeze({
  PREFERRED: 'preferred',
  ALLOWED: 'allowed',
  FORBIDDEN: 'forbidden',
});

export function createDefaultAssignmentPolicy() {
  return {
    mode: POLICY_MODES.USUAL,
    grade: '',
    requirementId: '',
    extraRequirementId: '',
    customRules: {},
  };
}

export function normalizeAssignmentPolicy(policy) {
  const fallback = createDefaultAssignmentPolicy();
  if (!policy || typeof policy !== 'object') return fallback;
  const validModes = new Set(Object.values(POLICY_MODES));
  return {
    mode: validModes.has(policy.mode) ? policy.mode : fallback.mode,
    grade: String(policy.grade || ''),
    requirementId: String(policy.requirementId || ''),
    extraRequirementId: String(policy.extraRequirementId || ''),
    customRules: policy.customRules && typeof policy.customRules === 'object'
      ? { ...policy.customRules }
      : {},
  };
}

export function requirementLabel(requirement) {
  if (!requirement) return 'متطلب غير محدد';
  return `${String(requirement.subject || '').trim()} · ${String(requirement.grade || '').trim()}`;
}

function usualStatus(teacher, requirement) {
  if (String(teacher.specialty || '').trim() === String(requirement.subject || '').trim()) {
    return ASSIGNMENT_STATUS.PREFERRED;
  }
  const allowed = Array.isArray(teacher.allowedSubjects) ? teacher.allowedSubjects : [];
  return allowed.includes(requirement.subject)
    ? ASSIGNMENT_STATUS.ALLOWED
    : ASSIGNMENT_STATUS.FORBIDDEN;
}

export function getAssignmentStatus(teacher, requirement) {
  if (!teacher?.active) return ASSIGNMENT_STATUS.FORBIDDEN;
  const policy = normalizeAssignmentPolicy(teacher.assignmentPolicy);

  switch (policy.mode) {
    case POLICY_MODES.SPECIALTY_ONLY:
      return teacher.specialty === requirement.subject
        ? ASSIGNMENT_STATUS.PREFERRED
        : ASSIGNMENT_STATUS.FORBIDDEN;

    case POLICY_MODES.SPECIALTY_GRADE:
      return teacher.specialty === requirement.subject && policy.grade === requirement.grade
        ? ASSIGNMENT_STATUS.PREFERRED
        : ASSIGNMENT_STATUS.FORBIDDEN;

    case POLICY_MODES.SINGLE_REQUIREMENT:
      return policy.requirementId === requirement.requirementId || policy.requirementId === requirement.id
        ? ASSIGNMENT_STATUS.PREFERRED
        : ASSIGNMENT_STATUS.FORBIDDEN;

    case POLICY_MODES.SPECIALTY_PLUS_EXTRA:
      if (teacher.specialty === requirement.subject) return ASSIGNMENT_STATUS.PREFERRED;
      return policy.extraRequirementId === requirement.requirementId || policy.extraRequirementId === requirement.id
        ? ASSIGNMENT_STATUS.ALLOWED
        : ASSIGNMENT_STATUS.FORBIDDEN;

    case POLICY_MODES.CUSTOM: {
      const status = policy.customRules[requirement.requirementId]
        ?? policy.customRules[requirement.id];
      return Object.values(ASSIGNMENT_STATUS).includes(status)
        ? status
        : ASSIGNMENT_STATUS.FORBIDDEN;
    }

    case POLICY_MODES.USUAL:
    default:
      return usualStatus(teacher, requirement);
  }
}

export function buildInitialCustomRules(teacher, requirements) {
  return Object.fromEntries(requirements.map((requirement) => [
    requirement.id,
    usualStatus(teacher, requirement),
  ]));
}

export function describeAssignmentPolicy(teacher, requirements) {
  const policy = normalizeAssignmentPolicy(teacher.assignmentPolicy);
  const byId = (id) => requirements.find((requirement) => requirement.id === id);

  switch (policy.mode) {
    case POLICY_MODES.SPECIALTY_ONLY:
      return `تخصص ${teacher.specialty || 'المعلم'} في جميع الصفوف فقط.`;
    case POLICY_MODES.SPECIALTY_GRADE:
      return `تخصص ${teacher.specialty || 'المعلم'} في الصف ${policy.grade || 'غير المحدد'} فقط.`;
    case POLICY_MODES.SINGLE_REQUIREMENT:
      return `${requirementLabel(byId(policy.requirementId))} فقط.`;
    case POLICY_MODES.SPECIALTY_PLUS_EXTRA:
      return `تخصصه في جميع الصفوف، مع السماح بـ ${requirementLabel(byId(policy.extraRequirementId))}.`;
    case POLICY_MODES.CUSTOM:
      return 'نطاق مخصص تحدده لكل صف ومادة.';
    case POLICY_MODES.USUAL:
    default:
      return 'تخصصه أولًا، ثم المواد الإضافية المسموحة عند الحاجة.';
  }
}
