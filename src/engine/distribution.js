import {
  ASSIGNMENT_STATUS,
  getAssignmentStatus,
  normalizeAssignmentPolicy,
  POLICY_MODES,
} from '../domain/assignmentPolicy.js';

const scenarioMeta = {
  balanced: {
    label: 'الأكثر توازنًا',
    description: 'يقلل الفروق بين الأنصبة مع احترام نطاق كل معلم والحد الأعلى.',
  },
  specialized: {
    label: 'الأكثر تخصصًا',
    description: 'يعطي أولوية أعلى للتخصص الأساسي والإسنادات المفضلة.',
  },
  compact: {
    label: 'الأقل تشعبًا',
    description: 'يقلل تنوع الصفوف والمواد لدى المعلم قدر الإمكان.',
  },
};

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

function loadVariance(loads) {
  if (!loads.length) return 0;
  const mean = loads.reduce((sum, load) => sum + load, 0) / loads.length;
  return loads.reduce((sum, load) => sum + (load - mean) ** 2, 0) / loads.length;
}

function statusPenalty(kind, status) {
  if (status === ASSIGNMENT_STATUS.PREFERRED) return 0;
  if (kind === 'specialized') return 4_000;
  if (kind === 'compact') return 900;
  return 650;
}

function scoreCandidate(kind, teacher, task, assignments, currentLoad) {
  const projected = currentLoad + task.periods;
  const status = assignmentStatus(teacher, task);
  const specialtyMismatch = teacher.specialty === task.subject ? 0 : 1;
  const teacherAssignments = assignments.filter((item) => item.teacherId === teacher.id);
  const hasSubject = teacherAssignments.some((item) => item.subject === task.subject);
  const hasGrade = teacherAssignments.some((item) => item.grade === task.grade);
  const newSubjectPenalty = hasSubject || teacherAssignments.length === 0 ? 0 : 1;
  const newGradePenalty = hasGrade || teacherAssignments.length === 0 ? 0 : 1;
  const ratio = projected / Math.max(1, teacher.targetLoad);
  const leadOverTarget = teacher.isLead && projected > teacher.targetLoad ? 1 : 0;
  const minimumDeficitPriority = -Math.max(0, teacher.minLoad - currentLoad) * 1_000;
  const hard = leadOverTarget * 20_000 + minimumDeficitPriority;
  const explicitPreferenceSoftensMismatch = status === ASSIGNMENT_STATUS.PREFERRED ? 0.15 : 1;

  if (kind === 'specialized') {
    return hard
      + statusPenalty(kind, status)
      + specialtyMismatch * 5_000 * explicitPreferenceSoftensMismatch
      + ratio * 1_000
      + newGradePenalty * 15;
  }
  if (kind === 'compact') {
    return hard
      + statusPenalty(kind, status)
      + specialtyMismatch * 1_200 * explicitPreferenceSoftensMismatch
      + newSubjectPenalty * 650
      + newGradePenalty * 280
      + ratio * 260;
  }
  return hard
    + statusPenalty(kind, status)
    + ratio * 1_000
    + specialtyMismatch * 240 * explicitPreferenceSoftensMismatch
    + newGradePenalty * 10;
}

function repairMinimumLoads(teachers, assignments) {
  const loads = new Map(teachers.map((teacher) => [
    teacher.id,
    assignments
      .filter((assignment) => assignment.teacherId === teacher.id)
      .reduce((sum, assignment) => sum + assignment.periods, 0),
  ]));
  let moved = true;
  let guard = 0;

  while (moved && guard < 500) {
    moved = false;
    guard += 1;
    const recipients = teachers
      .filter((teacher) => (loads.get(teacher.id) ?? 0) < teacher.minLoad)
      .sort((a, b) => (
        b.minLoad - (loads.get(b.id) ?? 0)
      ) - (
        a.minLoad - (loads.get(a.id) ?? 0)
      ));

    for (const recipient of recipients) {
      const recipientLoad = loads.get(recipient.id) ?? 0;
      const candidates = assignments
        .map((assignment) => ({
          assignment,
          donor: teachers.find((teacher) => teacher.id === assignment.teacherId),
        }))
        .filter(({ assignment, donor }) => donor
          && donor.id !== recipient.id
          && isEligible(recipient, assignment)
          && recipientLoad + assignment.periods <= recipient.maxLoad
          && (loads.get(donor.id) ?? 0) - assignment.periods >= donor.minLoad)
        .sort((a, b) => {
          const aStatus = assignmentStatus(recipient, a.assignment);
          const bStatus = assignmentStatus(recipient, b.assignment);
          const aPreference = aStatus === ASSIGNMENT_STATUS.PREFERRED ? 0 : 500;
          const bPreference = bStatus === ASSIGNMENT_STATUS.PREFERRED ? 0 : 500;
          const aRecipient = Math.abs(recipient.targetLoad - (recipientLoad + a.assignment.periods));
          const bRecipient = Math.abs(recipient.targetLoad - (recipientLoad + b.assignment.periods));
          const aDonor = Math.abs(a.donor.targetLoad - ((loads.get(a.donor.id) ?? 0) - a.assignment.periods));
          const bDonor = Math.abs(b.donor.targetLoad - ((loads.get(b.donor.id) ?? 0) - b.assignment.periods));
          return (aPreference + aRecipient + aDonor) - (bPreference + bRecipient + bDonor);
        });

      const best = candidates[0];
      if (!best) continue;
      const oldTeacherId = best.assignment.teacherId;
      best.assignment.teacherId = recipient.id;
      best.assignment.preference = assignmentStatus(recipient, best.assignment);
      loads.set(oldTeacherId, (loads.get(oldTeacherId) ?? 0) - best.assignment.periods);
      loads.set(recipient.id, recipientLoad + best.assignment.periods);
      moved = true;
    }
  }
}

function buildSummaries(teachers, assignments) {
  return teachers.filter((teacher) => teacher.active).map((teacher) => {
    const own = assignments.filter((item) => item.teacherId === teacher.id);
    return {
      teacherId: teacher.id,
      load: own.reduce((sum, item) => sum + item.periods, 0),
      assignments: own,
      subjectCount: new Set(own.map((item) => item.subject)).size,
      gradeCount: new Set(own.map((item) => item.grade)).size,
      outsidePrimarySpecialty: own
        .filter((item) => item.subject !== teacher.specialty)
        .reduce((sum, item) => sum + item.periods, 0),
      preferredPeriods: own
        .filter((item) => item.preference === ASSIGNMENT_STATUS.PREFERRED)
        .reduce((sum, item) => sum + item.periods, 0),
      allowedPeriods: own
        .filter((item) => item.preference === ASSIGNMENT_STATUS.ALLOWED)
        .reduce((sum, item) => sum + item.periods, 0),
    };
  });
}

function buildWarnings(teachers, summaries, unassigned) {
  const warnings = [];
  if (unassigned.length) {
    warnings.push(`توجد ${unassigned.length} شعبة/مقرر لم تُسند بسبب نطاقات التدريس أو السعة المتاحة.`);
  }
  for (const summary of summaries) {
    const teacher = teachers.find((item) => item.id === summary.teacherId);
    if (!teacher) continue;
    if (summary.load > teacher.maxLoad) warnings.push(`${teacher.name}: تجاوز الحد الأعلى للنصاب.`);
    if (summary.load < teacher.minLoad) warnings.push(`${teacher.name}: أقل من الحد الأدنى للنصاب.`);
  }
  return warnings;
}

export function generateScenario(kind, teachers, requirements) {
  const activeTeachers = teachers.filter((teacher) => teacher.active);
  const assignments = [];
  const unassigned = [];
  const loads = new Map(activeTeachers.map((teacher) => [teacher.id, 0]));
  const tasks = expandRequirements(requirements)
    .filter((task) => task.periods > 0 && task.subject && task.grade)
    .sort((a, b) => {
      const eligibleA = activeTeachers.filter((teacher) => isEligible(teacher, a)).length;
      const eligibleB = activeTeachers.filter((teacher) => isEligible(teacher, b)).length;
      const preferredA = activeTeachers.filter(
        (teacher) => assignmentStatus(teacher, a) === ASSIGNMENT_STATUS.PREFERRED,
      ).length;
      const preferredB = activeTeachers.filter(
        (teacher) => assignmentStatus(teacher, b) === ASSIGNMENT_STATUS.PREFERRED,
      ).length;
      return eligibleA - eligibleB
        || preferredA - preferredB
        || b.periods - a.periods
        || a.subject.localeCompare(b.subject, 'ar');
    });

  for (const task of tasks) {
    const eligible = activeTeachers
      .filter((teacher) => isEligible(teacher, task))
      .filter((teacher) => (loads.get(teacher.id) ?? 0) + task.periods <= teacher.maxLoad)
      .map((teacher) => ({
        teacher,
        status: assignmentStatus(teacher, task),
        score: scoreCandidate(
          kind,
          teacher,
          task,
          assignments,
          loads.get(teacher.id) ?? 0,
        ),
      }))
      .sort((a, b) => a.score - b.score || a.teacher.name.localeCompare(b.teacher.name, 'ar'));

    const best = eligible[0];
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
    loads.set(best.teacher.id, (loads.get(best.teacher.id) ?? 0) + task.periods);
  }

  repairMinimumLoads(activeTeachers, assignments);
  const summaries = buildSummaries(activeTeachers, assignments);
  const variance = loadVariance(summaries.map((item) => item.load));
  const overloadCount = summaries.filter((summary) => (
    summary.load > activeTeachers.find((teacher) => teacher.id === summary.teacherId).maxLoad
  )).length;
  const underMinCount = summaries.filter((summary) => (
    summary.load < activeTeachers.find((teacher) => teacher.id === summary.teacherId).minLoad
  )).length;
  const outsideSpecialtyCount = summaries.reduce(
    (sum, item) => sum + item.outsidePrimarySpecialty,
    0,
  );
  const allowedPeriodsCount = summaries.reduce((sum, item) => sum + item.allowedPeriods, 0);
  const score = variance
    + overloadCount * 10_000
    + underMinCount * 5_000
    + unassigned.length * 20_000
    + outsideSpecialtyCount * 20
    + allowedPeriodsCount * 5;

  return {
    id: kind,
    ...scenarioMeta[kind],
    assignments,
    unassigned,
    summaries,
    variance,
    overloadCount,
    underMinCount,
    outsideSpecialtyCount,
    allowedPeriodsCount,
    score,
    warnings: buildWarnings(activeTeachers, summaries, unassigned),
  };
}

export function generateAllScenarios(teachers, requirements) {
  return ['balanced', 'specialized', 'compact']
    .map((kind) => generateScenario(kind, teachers, requirements));
}

function requirementExists(requirements, id) {
  return requirements.some((requirement) => requirement.id === id);
}

export function validateInputs(teachers, requirements) {
  const errors = [];
  const active = teachers.filter((teacher) => teacher.active);
  if (!active.length) errors.push('أضف معلمًا واحدًا نشطًا على الأقل.');
  if (!requirements.length) errors.push('أضف متطلبًا دراسيًا واحدًا على الأقل.');

  for (const teacher of active) {
    if (!String(teacher.name || '').trim()) errors.push('يوجد معلم بلا اسم.');
    if (!String(teacher.specialty || '').trim()) {
      errors.push(`${teacher.name || 'أحد المعلمين'} بلا تخصص.`);
    }
    if ([teacher.minLoad, teacher.targetLoad, teacher.maxLoad]
      .some((value) => Number(value) < 0)) {
      errors.push(`${teacher.name}: لا يمكن أن تكون الأنصبة سالبة.`);
    }
    if (!(Number(teacher.minLoad) <= Number(teacher.targetLoad)
      && Number(teacher.targetLoad) <= Number(teacher.maxLoad))) {
      errors.push(`${teacher.name}: يجب أن يكون الحد الأدنى ≤ المستهدف ≤ الأعلى.`);
    }

    const policy = normalizeAssignmentPolicy(teacher.assignmentPolicy);
    if (policy.mode === POLICY_MODES.SPECIALTY_GRADE && !policy.grade) {
      errors.push(`${teacher.name}: اختر الصف في قالب «تخصصه في صف واحد».`);
    }
    if (policy.mode === POLICY_MODES.SINGLE_REQUIREMENT
      && !requirementExists(requirements, policy.requirementId)) {
      errors.push(`${teacher.name}: اختر الصف والمادة في قالب «مقرر واحد فقط».`);
    }
    if (policy.mode === POLICY_MODES.SPECIALTY_PLUS_EXTRA
      && !requirementExists(requirements, policy.extraRequirementId)) {
      errors.push(`${teacher.name}: اختر المقرر الإضافي المسموح.`);
    }
    if (policy.mode === POLICY_MODES.CUSTOM) {
      const hasAllowedRule = requirements.some((requirement) => (
        getAssignmentStatus(teacher, requirement) !== ASSIGNMENT_STATUS.FORBIDDEN
      ));
      if (!hasAllowedRule) errors.push(`${teacher.name}: النطاق المخصص يمنع جميع المتطلبات.`);
    }
  }

  for (const requirement of requirements) {
    if (!String(requirement.grade || '').trim() || !String(requirement.subject || '').trim()) {
      errors.push('يوجد متطلب بلا صف أو مادة.');
    }
    if (Number(requirement.sections) <= 0 || Number(requirement.periodsPerSection) <= 0) {
      errors.push(`${requirement.grade || 'صف غير مسمى'} / ${requirement.subject || 'مادة غير مسماة'}: الأعداد يجب أن تكون أكبر من صفر.`);
    }
  }

  return [...new Set(errors)];
}
