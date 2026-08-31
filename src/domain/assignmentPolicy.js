export const POLICY_MODES = Object.freeze({
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
    mode: POLICY_MODES.SPECIALTY_ONLY,
    grade: '',
    requirementId: '',
    extraRequirementId: '',
    selectedRequirementIds: [],
  };
}

export function normalizeAssignmentPolicy(policy) {
  const fallback = createDefaultAssignmentPolicy();
  if (!policy || typeof policy !== 'object') return fallback;

  const legacyMode = policy.mode === 'usual' ? POLICY_MODES.CUSTOM : policy.mode;
  const validModes = new Set(Object.values(POLICY_MODES));
  const legacySelected = policy.customRules && typeof policy.customRules === 'object'
    ? Object.entries(policy.customRules)
      .filter(([, status]) => status !== ASSIGNMENT_STATUS.FORBIDDEN)
      .map(([id]) => id)
    : [];

  return {
    mode: validModes.has(legacyMode) ? legacyMode : fallback.mode,
    grade: String(policy.grade || ''),
    requirementId: String(policy.requirementId || ''),
    extraRequirementId: String(policy.extraRequirementId || ''),
    selectedRequirementIds: Array.isArray(policy.selectedRequirementIds)
      ? [...new Set(policy.selectedRequirementIds.map(String))]
      : legacySelected,
  };
}

export function requirementLabel(requirement) {
  if (!requirement) return 'خيار غير محدد';
  return `${String(requirement.subject || '').trim()} · ${String(requirement.grade || '').trim()}`;
}

function isSameSpecialty(teacher, requirement) {
  return String(teacher.specialty || '').trim() === String(requirement.subject || '').trim();
}

const GRADE_EIGHT_SCIENCE_SPECIALTIES = new Set([
  'العلوم العامة',
  'الفيزياء',
  'الكيمياء',
  'الأحياء',
]);

export function isGradeEightGeneralScience(requirement) {
  return String(requirement?.grade || '').trim() === 'الثامن'
    && String(requirement?.subject || '').trim() === 'العلوم العامة';
}

export function getAssignmentStatus(teacher, requirement) {
  if (!teacher?.active) return ASSIGNMENT_STATUS.FORBIDDEN;
  const policy = normalizeAssignmentPolicy(teacher.assignmentPolicy);

  switch (policy.mode) {
    case POLICY_MODES.SPECIALTY_GRADE:
      return isSameSpecialty(teacher, requirement) && policy.grade === requirement.grade
        ? ASSIGNMENT_STATUS.PREFERRED
        : ASSIGNMENT_STATUS.FORBIDDEN;

    case POLICY_MODES.SINGLE_REQUIREMENT:
      return policy.requirementId === requirement.requirementId
        || policy.requirementId === requirement.id
        ? ASSIGNMENT_STATUS.PREFERRED
        : ASSIGNMENT_STATUS.FORBIDDEN;

    case POLICY_MODES.SPECIALTY_PLUS_EXTRA:
      if (isSameSpecialty(teacher, requirement)) return ASSIGNMENT_STATUS.PREFERRED;
      return policy.extraRequirementId === requirement.requirementId
        || policy.extraRequirementId === requirement.id
        ? ASSIGNMENT_STATUS.ALLOWED
        : ASSIGNMENT_STATUS.FORBIDDEN;

    case POLICY_MODES.CUSTOM: {
      const selected = new Set(policy.selectedRequirementIds);
      const isSelected = selected.has(requirement.requirementId) || selected.has(requirement.id);
      if (!isSelected) return ASSIGNMENT_STATUS.FORBIDDEN;
      return isSameSpecialty(teacher, requirement)
        ? ASSIGNMENT_STATUS.PREFERRED
        : ASSIGNMENT_STATUS.ALLOWED;
    }

    case POLICY_MODES.SPECIALTY_ONLY:
    default:
      return isSameSpecialty(teacher, requirement)
        ? ASSIGNMENT_STATUS.PREFERRED
        : ASSIGNMENT_STATUS.FORBIDDEN;
  }
}

export function getManualTransferStatus(teacher, requirement) {
  const regularStatus = getAssignmentStatus(teacher, requirement);
  if (regularStatus !== ASSIGNMENT_STATUS.FORBIDDEN) return regularStatus;
  if (!teacher?.active || !isGradeEightGeneralScience(requirement)) {
    return ASSIGNMENT_STATUS.FORBIDDEN;
  }

  return GRADE_EIGHT_SCIENCE_SPECIALTIES.has(String(teacher.specialty || '').trim())
    ? ASSIGNMENT_STATUS.ALLOWED
    : ASSIGNMENT_STATUS.FORBIDDEN;
}

export function buildInitialCustomSelection(teacher, requirements) {
  return requirements
    .filter((requirement) => {
      if (isSameSpecialty(teacher, requirement)) return true;
      const legacyAllowed = Array.isArray(teacher.allowedSubjects) ? teacher.allowedSubjects : [];
      return legacyAllowed.includes(requirement.subject);
    })
    .map((requirement) => requirement.id);
}

export function describeAssignmentPolicy(teacher, requirements) {
  const policy = normalizeAssignmentPolicy(teacher.assignmentPolicy);
  const byId = (id) => requirements.find((requirement) => requirement.id === id);

  switch (policy.mode) {
    case POLICY_MODES.SPECIALTY_GRADE:
      return `${teacher.specialty || 'التخصص'} في الصف ${policy.grade || 'غير المحدد'} فقط`;
    case POLICY_MODES.SINGLE_REQUIREMENT:
      return `${requirementLabel(byId(policy.requirementId))} فقط`;
    case POLICY_MODES.SPECIALTY_PLUS_EXTRA:
      return `${teacher.specialty || 'التخصص'} في جميع الصفوف + ${requirementLabel(byId(policy.extraRequirementId))}`;
    case POLICY_MODES.CUSTOM: {
      const selected = requirements.filter((requirement) => policy.selectedRequirementIds.includes(requirement.id));
      return selected.length
        ? selected.map(requirementLabel).join('، ')
        : 'لم تحدد أي صف أو مادة';
    }
    case POLICY_MODES.SPECIALTY_ONLY:
    default:
      return `${teacher.specialty || 'التخصص'} في جميع الصفوف`;
  }
}
