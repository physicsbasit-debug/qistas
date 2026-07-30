const scenarioMeta = {
  balanced: { label: 'الأكثر توازنًا', description: 'يقلل الفروق بين الأنصبة مع احترام التخصص والحد الأعلى.' },
  specialized: { label: 'الأكثر تخصصًا', description: 'يعطي أولوية أعلى للتخصص الأساسي حتى لو زاد التفاوت قليلًا.' },
  compact: { label: 'الأقل تشعبًا', description: 'يقلل تنوع الصفوف والمواد لدى المعلم قدر الإمكان.' },
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

function isEligible(teacher, task) {
  if (!teacher.active) return false;
  return teacher.specialty === task.subject || teacher.allowedSubjects.includes(task.subject);
}

function loadVariance(loads) {
  if (!loads.length) return 0;
  const mean = loads.reduce((sum, load) => sum + load, 0) / loads.length;
  return loads.reduce((sum, load) => sum + (load - mean) ** 2, 0) / loads.length;
}

function scoreCandidate(kind, teacher, task, assignments, currentLoad) {
  const projected = currentLoad + task.periods;
  const overload = Math.max(0, projected - teacher.maxLoad);
  const specialtyMismatch = teacher.specialty === task.subject ? 0 : 1;
  const teacherAssignments = assignments.filter((item) => item.teacherId === teacher.id);
  const hasSubject = teacherAssignments.some((item) => item.subject === task.subject);
  const hasGrade = teacherAssignments.some((item) => item.grade === task.grade);
  const newSubjectPenalty = hasSubject || teacherAssignments.length === 0 ? 0 : 1;
  const newGradePenalty = hasGrade || teacherAssignments.length === 0 ? 0 : 1;
  const ratio = projected / Math.max(1, teacher.targetLoad);
  const leadOverTarget = teacher.isLead && projected > teacher.targetLoad ? 1 : 0;
  const minimumDeficitPriority = -Math.max(0, teacher.minLoad - currentLoad) * 1_000;
  const hard = overload * 100_000 + leadOverTarget * 20_000 + minimumDeficitPriority;

  if (kind === 'specialized') {
    return hard + specialtyMismatch * 5_000 + ratio * 1_000 + newGradePenalty * 15;
  }
  if (kind === 'compact') {
    return hard + specialtyMismatch * 1_200 + newSubjectPenalty * 650 + newGradePenalty * 280 + ratio * 260;
  }
  return hard + ratio * 1_000 + specialtyMismatch * 240 + newGradePenalty * 10;
}

function repairMinimumLoads(teachers, assignments) {
  const loads = new Map(teachers.map((teacher) => [teacher.id, assignments.filter((a) => a.teacherId === teacher.id).reduce((sum, a) => sum + a.periods, 0)]));
  let moved = true;
  let guard = 0;
  while (moved && guard < 500) {
    moved = false;
    guard += 1;
    const recipients = teachers
      .filter((teacher) => (loads.get(teacher.id) ?? 0) < teacher.minLoad)
      .sort((a, b) => (b.minLoad - (loads.get(b.id) ?? 0)) - (a.minLoad - (loads.get(a.id) ?? 0)));
    for (const recipient of recipients) {
      const recipientLoad = loads.get(recipient.id) ?? 0;
      const candidates = assignments
        .map((assignment, index) => ({ assignment, index, donor: teachers.find((teacher) => teacher.id === assignment.teacherId) }))
        .filter(({ assignment, donor }) => donor && donor.id !== recipient.id
          && isEligible(recipient, assignment)
          && recipientLoad + assignment.periods <= recipient.maxLoad
          && (loads.get(donor.id) ?? 0) - assignment.periods >= donor.minLoad)
        .sort((a, b) => {
          const aRecipient = Math.abs(recipient.targetLoad - (recipientLoad + a.assignment.periods));
          const bRecipient = Math.abs(recipient.targetLoad - (recipientLoad + b.assignment.periods));
          const aDonor = Math.abs(a.donor.targetLoad - ((loads.get(a.donor.id) ?? 0) - a.assignment.periods));
          const bDonor = Math.abs(b.donor.targetLoad - ((loads.get(b.donor.id) ?? 0) - b.assignment.periods));
          return (aRecipient + aDonor) - (bRecipient + bDonor);
        });
      const best = candidates[0];
      if (!best) continue;
      const oldTeacherId = best.assignment.teacherId;
      best.assignment.teacherId = recipient.id;
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
      outsidePrimarySpecialty: own.filter((item) => item.subject !== teacher.specialty).reduce((sum, item) => sum + item.periods, 0),
    };
  });
}

function buildWarnings(teachers, summaries, unassigned) {
  const warnings = [];
  if (unassigned.length) warnings.push(`توجد ${unassigned.length} شعبة/مقرر لم تُسند بسبب نقص الأهلية أو السعة.`);
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
      return eligibleA - eligibleB || b.periods - a.periods || a.subject.localeCompare(b.subject, 'ar');
    });

  for (const task of tasks) {
    const eligible = activeTeachers
      .filter((teacher) => isEligible(teacher, task))
      .map((teacher) => ({ teacher, score: scoreCandidate(kind, teacher, task, assignments, loads.get(teacher.id) ?? 0) }))
      .sort((a, b) => a.score - b.score || a.teacher.name.localeCompare(b.teacher.name, 'ar'));
    const best = eligible[0];
    if (!best) { unassigned.push(task); continue; }
    const assignment = { taskId: task.id, teacherId: best.teacher.id, grade: task.grade, subject: task.subject, section: task.section, periods: task.periods };
    assignments.push(assignment);
    loads.set(best.teacher.id, (loads.get(best.teacher.id) ?? 0) + task.periods);
  }

  repairMinimumLoads(activeTeachers, assignments);
  const summaries = buildSummaries(activeTeachers, assignments);
  const variance = loadVariance(summaries.map((item) => item.load));
  const overloadCount = summaries.filter((summary) => summary.load > activeTeachers.find((t) => t.id === summary.teacherId).maxLoad).length;
  const underMinCount = summaries.filter((summary) => summary.load < activeTeachers.find((t) => t.id === summary.teacherId).minLoad).length;
  const outsideSpecialtyCount = summaries.reduce((sum, item) => sum + item.outsidePrimarySpecialty, 0);
  const score = variance + overloadCount * 10_000 + unassigned.length * 20_000 + outsideSpecialtyCount * 20;
  return { id: kind, ...scenarioMeta[kind], assignments, unassigned, summaries, variance, overloadCount, underMinCount, outsideSpecialtyCount, score, warnings: buildWarnings(activeTeachers, summaries, unassigned) };
}

export function generateAllScenarios(teachers, requirements) {
  return ['balanced', 'specialized', 'compact'].map((kind) => generateScenario(kind, teachers, requirements));
}

export function validateInputs(teachers, requirements) {
  const errors = [];
  const active = teachers.filter((teacher) => teacher.active);
  if (!active.length) errors.push('أضف معلمًا واحدًا نشطًا على الأقل.');
  if (!requirements.length) errors.push('أضف متطلبًا دراسيًا واحدًا على الأقل.');
  for (const teacher of active) {
    if (!String(teacher.name || '').trim()) errors.push('يوجد معلم بلا اسم.');
    if (!String(teacher.specialty || '').trim()) errors.push(`${teacher.name || 'أحد المعلمين'} بلا تخصص.`);
    if ([teacher.minLoad, teacher.targetLoad, teacher.maxLoad].some((value) => Number(value) < 0)) errors.push(`${teacher.name}: لا يمكن أن تكون الأنصبة سالبة.`);
    if (!(Number(teacher.minLoad) <= Number(teacher.targetLoad) && Number(teacher.targetLoad) <= Number(teacher.maxLoad))) errors.push(`${teacher.name}: يجب أن يكون الحد الأدنى ≤ المستهدف ≤ الأعلى.`);
  }
  for (const req of requirements) {
    if (!String(req.grade || '').trim() || !String(req.subject || '').trim()) errors.push('يوجد متطلب بلا صف أو مادة.');
    if (Number(req.sections) <= 0 || Number(req.periodsPerSection) <= 0) errors.push(`${req.grade || 'صف غير مسمى'} / ${req.subject || 'مادة غير مسماة'}: الأعداد يجب أن تكون أكبر من صفر.`);
  }
  return [...new Set(errors)];
}
