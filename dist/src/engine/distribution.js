import {
  ASSIGNMENT_STATUS,
  getAssignmentStatus,
  normalizeAssignmentPolicy,
  POLICY_MODES,
} from '../domain/assignmentPolicy.js';

const DEFAULT_SETTINGS = Object.freeze({
  teacherMaxLoad: 18,
  leadMaxLoad: 12,
});

const scenarioMeta = {
  balanced: {
    label: 'المقترح المتوازن',
    description: 'يوزّع الحصص بأقرب توازن ممكن داخل الخيارات التي حددتها.',
  },
  specialized: {
    label: 'بديل يقدّم التخصص',
    description: 'يعطي أولوية أكبر لمادة التخصص قبل الإسنادات الإضافية.',
  },
  compact: {
    label: 'بديل أقل تشعبًا',
    description: 'يحاول تقليل تنوع الصفوف والمواد لدى كل معلم.',
  },
};

export function normalizeSettings(settings = {}) {
  return {
    teacherMaxLoad: Number(settings.teacherMaxLoad) > 0
      ? Number(settings.teacherMaxLoad)
      : DEFAULT_SETTINGS.teacherMaxLoad,
    leadMaxLoad: Number(settings.leadMaxLoad) > 0
      ? Number(settings.leadMaxLoad)
      : DEFAULT_SETTINGS.leadMaxLoad,
  };
}

export function teacherMaxLoad(teacher, settings = DEFAULT_SETTINGS) {
  const normalized = normalizeSettings(settings);
  return teacher.isLead ? normalized.leadMaxLoad : normalized.teacherMaxLoad;
}

export function expandRequirements(requirements) {
  return requirements.flatMap((requirement) => Array.from(
    { length: Math.max(0, Number(requirement.sections) || 0) },
    (_, index) => ({
      id: `${requirement.id}-s${index + 1}`,
      requirementId: requirement.id,
      grade: String(requirement.grade || '').trim(),
      subject: String(requirement.subject || '').trim(),
      section: index + 1,
      periods: Math.max(0, Number(requirement.periodsPerSection) || 0),
    }),
  ));
}

function assignmentStatus(teacher, task) {
  return getAssignmentStatus(teacher, task);
}

function isEligible(teacher, task) {
  return teacher.active && assignmentStatus(teacher, task) !== ASSIGNMENT_STATUS.FORBIDDEN;
}

function variance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function scoreCandidate(kind, teacher, task, assignments, currentLoad, maxLoad) {
  const projected = currentLoad + task.periods;
  const status = assignmentStatus(teacher, task);
  const own = assignments.filter((item) => item.teacherId === teacher.id);
  const hasSubject = own.some((item) => item.subject === task.subject);
  const hasGrade = own.some((item) => item.grade === task.grade);
  const utilization = projected / Math.max(1, maxLoad);
  const flexiblePenalty = status === ASSIGNMENT_STATUS.ALLOWED ? 1 : 0;

  if (kind === 'specialized') {
    return flexiblePenalty * 4_000
      + utilization * 1_000
      + (hasGrade ? 0 : 20);
  }

  if (kind === 'compact') {
    return flexiblePenalty * 700
      + (hasSubject || own.length === 0 ? 0 : 850)
      + (hasGrade || own.length === 0 ? 0 : 380)
      + utilization * 260;
  }

  return flexiblePenalty * 500
    + utilization * 1_000
    + (hasGrade || own.length === 0 ? 0 : 15);
}

function buildSummaries(teachers, assignments, settings) {
  return teachers.filter((teacher) => teacher.active).map((teacher) => {
    const own = assignments.filter((item) => item.teacherId === teacher.id);
    const maxLoad = teacherMaxLoad(teacher, settings);
    return {
      teacherId: teacher.id,
      load: own.reduce((sum, item) => sum + item.periods, 0),
      maxLoad,
      assignments: own,
      subjectCount: new Set(own.map((item) => item.subject)).size,
      gradeCount: new Set(own.map((item) => item.grade)).size,
      flexiblePeriods: own
        .filter((item) => item.preference === ASSIGNMENT_STATUS.ALLOWED)
        .reduce((sum, item) => sum + item.periods, 0),
    };
  });
}

function buildWarnings(summaries, unassigned) {
  const warnings = [];
  if (unassigned.length) {
    warnings.push(`تعذر إسناد ${unassigned.length} شعبة بسبب خيارات التدريس أو السعة المتاحة.`);
  }
  for (const summary of summaries) {
    if (summary.load > summary.maxLoad) {
      warnings.push(`يوجد معلم تجاوز النصاب الأعلى المحدد (${summary.maxLoad}).`);
    }
  }
  return [...new Set(warnings)];
}

export function generateScenario(kind, teachers, requirements, settings = DEFAULT_SETTINGS) {
  const normalizedSettings = normalizeSettings(settings);
  const activeTeachers = teachers.filter((teacher) => teacher.active);
  const assignments = [];
  const unassigned = [];
  const loads = new Map(activeTeachers.map((teacher) => [teacher.id, 0]));
  const tasks = expandRequirements(requirements)
    .filter((task) => task.periods > 0 && task.subject && task.grade)
    .sort((a, b) => {
      const eligibleA = activeTeachers.filter((teacher) => isEligible(teacher, a)).length;
      const eligibleB = activeTeachers.filter((teacher) => isEligible(teacher, b)).length;
      const flexibleA = activeTeachers.filter(
        (teacher) => assignmentStatus(teacher, a) === ASSIGNMENT_STATUS.ALLOWED,
      ).length;
      const flexibleB = activeTeachers.filter(
        (teacher) => assignmentStatus(teacher, b) === ASSIGNMENT_STATUS.ALLOWED,
      ).length;
      return eligibleA - eligibleB
        || flexibleA - flexibleB
        || b.periods - a.periods
        || a.subject.localeCompare(b.subject, 'ar');
    });

  for (const task of tasks) {
    const candidates = activeTeachers
      .filter((teacher) => isEligible(teacher, task))
      .map((teacher) => {
        const currentLoad = loads.get(teacher.id) ?? 0;
        const maxLoad = teacherMaxLoad(teacher, normalizedSettings);
        return {
          teacher,
          currentLoad,
          maxLoad,
          status: assignmentStatus(teacher, task),
        };
      })
      .filter(({ currentLoad, maxLoad }) => currentLoad + task.periods <= maxLoad)
      .map((candidate) => ({
        ...candidate,
        score: scoreCandidate(
          kind,
          candidate.teacher,
          task,
          assignments,
          candidate.currentLoad,
          candidate.maxLoad,
        ),
      }))
      .sort((a, b) => a.score - b.score || a.teacher.name.localeCompare(b.teacher.name, 'ar'));

    const best = candidates[0];
    if (!best) {
      unassigned.push(task);
      continue;
    }

    assignments.push({
      taskId: task.id,
      requirementId: task.requirementId,
      teacherId: best.teacher.id,
      grade: task.grade,
      subject: task.subject,
      section: task.section,
      periods: task.periods,
      preference: best.status,
    });
    loads.set(best.teacher.id, best.currentLoad + task.periods);
  }

  const summaries = buildSummaries(activeTeachers, assignments, normalizedSettings);
  const utilizationVariance = variance(summaries.map((item) => (
    item.load / Math.max(1, item.maxLoad)
  )));
  const rawLoadVariance = variance(summaries.map((item) => item.load));
  const overloadCount = summaries.filter((summary) => summary.load > summary.maxLoad).length;
  const flexiblePeriodsCount = summaries.reduce((sum, item) => sum + item.flexiblePeriods, 0);
  const score = utilizationVariance * 1_000
    + overloadCount * 20_000
    + unassigned.length * 30_000
    + (kind === 'specialized' ? flexiblePeriodsCount * 3 : flexiblePeriodsCount);

  return {
    id: kind,
    ...scenarioMeta[kind],
    assignments,
    unassigned,
    summaries,
    variance: rawLoadVariance,
    utilizationVariance,
    overloadCount,
    flexiblePeriodsCount,
    score,
    warnings: buildWarnings(summaries, unassigned),
  };
}

export function generateAllScenarios(teachers, requirements, settings = DEFAULT_SETTINGS) {
  return ['balanced', 'specialized', 'compact']
    .map((kind) => generateScenario(kind, teachers, requirements, settings));
}

function requirementExists(requirements, id) {
  return requirements.some((requirement) => requirement.id === id);
}

export function validateInputs(teachers, requirements, settings = DEFAULT_SETTINGS) {
  const errors = [];
  const active = teachers.filter((teacher) => teacher.active);

  if (!active.length) errors.push('أضف معلمًا واحدًا نشطًا على الأقل.');
  if (!requirements.length) errors.push('أضف صفًا ومادة واحدًا على الأقل.');
  if (Number(settings?.teacherMaxLoad) <= 0 || Number(settings?.leadMaxLoad) <= 0) {
    errors.push('يجب أن يكون النصاب الأعلى أكبر من صفر.');
  }

  for (const teacher of active) {
    if (!String(teacher.name || '').trim()) errors.push('يوجد معلم بلا اسم.');
    if (!String(teacher.specialty || '').trim()) {
      errors.push(`${teacher.name || 'أحد المعلمين'} بلا تخصص.`);
    }

    const policy = normalizeAssignmentPolicy(teacher.assignmentPolicy);
    if (policy.mode === POLICY_MODES.SPECIALTY_GRADE && !policy.grade) {
      errors.push(`${teacher.name}: اختر الصف المطلوب.`);
    }
    if (policy.mode === POLICY_MODES.SINGLE_REQUIREMENT
      && !requirementExists(requirements, policy.requirementId)) {
      errors.push(`${teacher.name}: اختر الصف والمادة.`);
    }
    if (policy.mode === POLICY_MODES.SPECIALTY_PLUS_EXTRA
      && !requirementExists(requirements, policy.extraRequirementId)) {
      errors.push(`${teacher.name}: اختر الصف والمادة الإضافيين.`);
    }
    if (policy.mode === POLICY_MODES.CUSTOM) {
      const hasAllowedSelection = requirements.some((requirement) => (
        getAssignmentStatus(teacher, requirement) !== ASSIGNMENT_STATUS.FORBIDDEN
      ));
      if (!hasAllowedSelection) errors.push(`${teacher.name}: اختر له صفًا أو مادة واحدة على الأقل.`);
    }
  }

  for (const requirement of requirements) {
    if (!String(requirement.grade || '').trim() || !String(requirement.subject || '').trim()) {
      errors.push('يوجد سطر بلا صف أو مادة.');
    }
    if (Number(requirement.sections) <= 0 || Number(requirement.periodsPerSection) <= 0) {
      errors.push(`${requirement.grade || 'صف غير مسمى'} / ${requirement.subject || 'مادة غير مسماة'}: الأعداد يجب أن تكون أكبر من صفر.`);
    }
  }

  return [...new Set(errors)];
}
