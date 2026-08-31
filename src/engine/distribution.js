import {
  ASSIGNMENT_STATUS,
  getAssignmentStatus,
  getManualTransferStatus,
  normalizeAssignmentPolicy,
  POLICY_MODES,
} from '../domain/assignmentPolicy.js';
import { compareGrades } from '../domain/grades.js';

const DEFAULT_SETTINGS = Object.freeze({
  teacherMaxLoad: 18,
  leadMaxLoad: 12,
});

const MAX_RELOCATION_DEPTH = 4;
const MAX_RELOCATION_SUBSETS = 120;
const MAX_RELOCATION_ITEMS = 6;
const MODEL_STYLES = ['balanced', 'specialized', 'compact'];

const scenarioMeta = {
  balanced: {
    description: 'يوازن الأنصبة مع احترام نطاق كل معلم وسقف نصابه.',
  },
  specialized: {
    description: 'يعطي أولوية أكبر لمادة التخصص ثم يوازن السعة المتبقية.',
  },
  compact: {
    description: 'يقلل تشعب الصفوف والمواد قدر الإمكان مع بقاء الخطة صحيحة.',
  },
};

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed, key) {
  let value = hashString(`${seed}:${key}`) || 1;
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function createVariant(seed = 0, attempt = 0) {
  const mode = attempt % 5;
  return {
    seed,
    taskOrderMode: mode,
    taskJitter: attempt === 0 ? 0 : 0.9,
    candidateJitter: attempt === 0 ? 0 : 220 + (attempt % 7) * 55,
    mutationSteps: attempt < 3 ? 0 : 3 + (attempt % 9),
  };
}

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

function scoreCandidate(kind, teacher, task, assignments, currentLoad, maxLoad, variant) {
  const projected = currentLoad + task.periods;
  const status = assignmentStatus(teacher, task);
  const own = assignments.filter((item) => item.teacherId === teacher.id);
  const hasSubject = own.some((item) => item.subject === task.subject);
  const hasGrade = own.some((item) => item.grade === task.grade);
  const utilization = projected / Math.max(1, maxLoad);
  const flexiblePenalty = status === ASSIGNMENT_STATUS.ALLOWED ? 1 : 0;
  const jitter = seededUnit(variant.seed, `candidate:${task.id}:${teacher.id}`)
    * variant.candidateJitter;

  if (kind === 'specialized') {
    return flexiblePenalty * 4_000
      + utilization * 1_000
      + (hasGrade ? 0 : 20)
      + jitter;
  }

  if (kind === 'compact') {
    return flexiblePenalty * 700
      + (hasSubject || own.length === 0 ? 0 : 850)
      + (hasGrade || own.length === 0 ? 0 : 380)
      + utilization * 260
      + jitter;
  }

  return flexiblePenalty * 500
    + utilization * 1_000
    + (hasGrade || own.length === 0 ? 0 : 15)
    + jitter;
}

function assignmentFromTask(
  task,
  teacher,
  preference = assignmentStatus(teacher, task),
  { manualOverride = false } = {},
) {
  return {
    taskId: task.id,
    requirementId: task.requirementId,
    teacherId: teacher.id,
    grade: task.grade,
    subject: task.subject,
    section: task.section,
    periods: task.periods,
    preference,
    ...(manualOverride ? { manualOverride: true } : {}),
  };
}

function assignmentFromTaskWithManualOverride(task, teacher, requestedManualOverride = false) {
  const regularStatus = assignmentStatus(teacher, task);
  const manualStatus = requestedManualOverride
    ? getManualTransferStatus(teacher, task)
    : regularStatus;
  const manualOverride = Boolean(
    requestedManualOverride
    && regularStatus === ASSIGNMENT_STATUS.FORBIDDEN
    && manualStatus !== ASSIGNMENT_STATUS.FORBIDDEN
  );
  return assignmentFromTask(
    task,
    teacher,
    manualOverride ? manualStatus : regularStatus,
    { manualOverride },
  );
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
    warnings.push(`تعذر إسناد ${unassigned.length} شعبة بعد فحص بدائل النقل وإعادة الموازنة.`);
  }
  for (const summary of summaries) {
    if (summary.load > summary.maxLoad) {
      warnings.push(`يوجد معلم تجاوز النصاب الأعلى المحدد (${summary.maxLoad}).`);
    }
  }
  return [...new Set(warnings)];
}

function taskOrderValue(task, activeTeachers, variant) {
  const eligible = activeTeachers.filter((teacher) => isEligible(teacher, task)).length;
  const flexible = activeTeachers.filter(
    (teacher) => assignmentStatus(teacher, task) === ASSIGNMENT_STATUS.ALLOWED,
  ).length;
  const jitter = seededUnit(variant.seed, `task:${task.id}`) * variant.taskJitter;

  if (variant.taskOrderMode === 1) {
    return [eligible, flexible, task.periods, jitter];
  }
  if (variant.taskOrderMode === 2) {
    return [eligible, flexible, seededUnit(variant.seed, `subject:${task.subject}`), -task.periods + jitter];
  }
  if (variant.taskOrderMode === 3) {
    return [eligible, flexible, seededUnit(variant.seed, `grade:${task.grade}`), -task.periods + jitter];
  }
  if (variant.taskOrderMode === 4) {
    return [eligible, flexible, jitter, -task.periods];
  }
  return [eligible, flexible, -task.periods, jitter];
}

function compareTuple(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function sortTasksForGreedy(tasks, activeTeachers, variant) {
  return [...tasks].sort((a, b) => compareTuple(
    taskOrderValue(a, activeTeachers, variant),
    taskOrderValue(b, activeTeachers, variant),
  ) || a.subject.localeCompare(b.subject, 'ar') || a.section - b.section);
}

function greedyAssign(
  kind,
  activeTeachers,
  tasks,
  settings,
  variant,
  fixedAssignments = [],
  frozenTeacherIds = new Set(),
) {
  const assignments = [...fixedAssignments];
  const unassigned = [];
  const loads = new Map(activeTeachers.map((teacher) => [teacher.id, 0]));
  const fixedTaskIds = new Set(fixedAssignments.map((assignment) => assignment.taskId));

  for (const assignment of fixedAssignments) {
    loads.set(assignment.teacherId, (loads.get(assignment.teacherId) ?? 0) + assignment.periods);
  }

  const pendingTasks = tasks.filter((task) => !fixedTaskIds.has(task.id));
  for (const task of sortTasksForGreedy(pendingTasks, activeTeachers, variant)) {
    const candidates = activeTeachers
      .filter((teacher) => !frozenTeacherIds.has(teacher.id) && isEligible(teacher, task))
      .map((teacher) => {
        const currentLoad = loads.get(teacher.id) ?? 0;
        const maxLoad = teacherMaxLoad(teacher, settings);
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
          variant,
        ),
      }))
      .sort((a, b) => a.score - b.score || a.teacher.name.localeCompare(b.teacher.name, 'ar'));

    const best = candidates[0];
    if (!best) {
      unassigned.push(task);
      continue;
    }

    assignments.push(assignmentFromTask(task, best.teacher, best.status));
    loads.set(best.teacher.id, best.currentLoad + task.periods);
  }

  return { assignments, unassigned };
}

function createRepairState(
  activeTeachers,
  tasks,
  assignments,
  settings,
  variant,
  lockedTaskIds = new Set(),
  frozenTeacherIds = new Set(),
) {
  const teacherById = new Map(activeTeachers.map((teacher) => [teacher.id, teacher]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const placements = new Map(assignments.map((assignment) => [assignment.taskId, assignment.teacherId]));
  const manualOverrideTaskIds = new Set(
    assignments.filter((assignment) => assignment.manualOverride).map((assignment) => assignment.taskId),
  );
  const loads = new Map(activeTeachers.map((teacher) => [teacher.id, 0]));

  for (const [taskId, teacherId] of placements) {
    const task = taskById.get(taskId);
    if (task) loads.set(teacherId, (loads.get(teacherId) ?? 0) + task.periods);
  }

  return {
    activeTeachers,
    teacherById,
    taskById,
    placements,
    manualOverrideTaskIds,
    loads,
    settings,
    variant,
    lockedTaskIds,
    frozenTeacherIds,
  };
}

function snapshotRepairState(state) {
  return {
    placements: new Map(state.placements),
    loads: new Map(state.loads),
  };
}

function restoreRepairState(state, snapshot) {
  state.placements = snapshot.placements;
  state.loads = snapshot.loads;
}

function assignedTasksForTeacher(state, teacherId) {
  const tasks = [];
  for (const [taskId, assignedTeacherId] of state.placements) {
    if (assignedTeacherId === teacherId) {
      const task = state.taskById.get(taskId);
      if (task) tasks.push(task);
    }
  }
  return tasks;
}

function repairAssignmentsView(state) {
  const assignments = [];
  for (const [taskId, teacherId] of state.placements) {
    const task = state.taskById.get(taskId);
    const teacher = state.teacherById.get(teacherId);
    if (task && teacher) {
      assignments.push(assignmentFromTaskWithManualOverride(
        task,
        teacher,
        state.manualOverrideTaskIds.has(taskId),
      ));
    }
  }
  return assignments;
}

function assignTask(state, task, teacherId) {
  const previousTeacherId = state.placements.get(task.id);
  if (previousTeacherId) {
    state.loads.set(
      previousTeacherId,
      Math.max(0, (state.loads.get(previousTeacherId) ?? 0) - task.periods),
    );
  }
  state.placements.set(task.id, teacherId);
  state.loads.set(teacherId, (state.loads.get(teacherId) ?? 0) + task.periods);
}

function unassignTask(state, task) {
  const teacherId = state.placements.get(task.id);
  if (!teacherId) return;
  state.placements.delete(task.id);
  state.loads.set(teacherId, Math.max(0, (state.loads.get(teacherId) ?? 0) - task.periods));
}

function candidateInfos(kind, task, state, excludedTeacherIds = new Set()) {
  const assignments = repairAssignmentsView(state);
  return state.activeTeachers
    .filter((teacher) => (
      !excludedTeacherIds.has(teacher.id)
      && !state.frozenTeacherIds.has(teacher.id)
      && isEligible(teacher, task)
    ))
    .map((teacher) => {
      const currentLoad = state.loads.get(teacher.id) ?? 0;
      const maxLoad = teacherMaxLoad(teacher, state.settings);
      return {
        teacher,
        currentLoad,
        maxLoad,
        shortage: Math.max(0, currentLoad + task.periods - maxLoad),
        score: scoreCandidate(
          kind,
          teacher,
          task,
          assignments,
          currentLoad,
          maxLoad,
          state.variant,
        ),
      };
    })
    .sort((a, b) => a.shortage - b.shortage
      || a.score - b.score
      || a.teacher.name.localeCompare(b.teacher.name, 'ar'));
}

function alternativeTeacherCount(task, state, excludedTeacherId) {
  return state.activeTeachers.filter((teacher) => (
    teacher.id !== excludedTeacherId
    && !state.frozenTeacherIds.has(teacher.id)
    && isEligible(teacher, task)
  )).length;
}

function relocationSubsets(tasks, neededPeriods, state, targetTeacherId) {
  const movable = tasks
    .filter((task) => !state.lockedTaskIds.has(task.id))
    .map((task) => ({
      task,
      alternatives: alternativeTeacherCount(task, state, targetTeacherId),
    }))
    .filter((item) => item.alternatives > 0)
    .sort((a, b) => b.alternatives - a.alternatives
      || a.task.periods - b.task.periods
      || seededUnit(state.variant.seed, `relocate:${a.task.id}`)
        - seededUnit(state.variant.seed, `relocate:${b.task.id}`));

  const results = [];

  function visit(index, picked, total, flexibility) {
    if (results.length >= MAX_RELOCATION_SUBSETS) return;
    if (total >= neededPeriods) {
      results.push({
        tasks: picked.map((item) => item.task),
        total,
        flexibility,
      });
      return;
    }
    if (index >= movable.length || picked.length >= MAX_RELOCATION_ITEMS) return;

    for (let next = index; next < movable.length; next += 1) {
      const item = movable[next];
      picked.push(item);
      visit(
        next + 1,
        picked,
        total + item.task.periods,
        flexibility + item.alternatives,
      );
      picked.pop();
      if (results.length >= MAX_RELOCATION_SUBSETS) return;
    }
  }

  visit(0, [], 0, 0);
  return results.sort((a, b) => (a.total - neededPeriods) - (b.total - neededPeriods)
    || a.tasks.length - b.tasks.length
    || b.flexibility - a.flexibility);
}

function tryPlaceTask(
  kind,
  task,
  state,
  depth,
  excludedTeacherIds = new Set(),
  chainTaskIds = new Set(),
) {
  const candidates = candidateInfos(kind, task, state, excludedTeacherIds);
  const direct = candidates.find((candidate) => candidate.shortage === 0);
  if (direct) {
    assignTask(state, task, direct.teacher.id);
    return true;
  }

  if (depth <= 0) return false;

  for (const candidate of candidates) {
    if (candidate.shortage <= 0) continue;

    const assignedTasks = assignedTasksForTeacher(state, candidate.teacher.id)
      .filter((assignedTask) => !chainTaskIds.has(assignedTask.id));
    const subsets = relocationSubsets(
      assignedTasks,
      candidate.shortage,
      state,
      candidate.teacher.id,
    );

    for (const subset of subsets) {
      const snapshot = snapshotRepairState(state);
      for (const displacedTask of subset.tasks) unassignTask(state, displacedTask);

      const available = candidate.maxLoad - (state.loads.get(candidate.teacher.id) ?? 0);
      if (available < task.periods) {
        restoreRepairState(state, snapshot);
        continue;
      }

      assignTask(state, task, candidate.teacher.id);
      let relocated = true;
      const displacedSorted = [...subset.tasks].sort((a, b) => (
        alternativeTeacherCount(a, state, candidate.teacher.id)
        - alternativeTeacherCount(b, state, candidate.teacher.id)
      ) || b.periods - a.periods);

      for (const displacedTask of displacedSorted) {
        const nextExcluded = new Set(excludedTeacherIds);
        nextExcluded.add(candidate.teacher.id);
        const nextChain = new Set(chainTaskIds);
        nextChain.add(task.id);
        nextChain.add(displacedTask.id);

        if (!tryPlaceTask(
          kind,
          displacedTask,
          state,
          depth - 1,
          nextExcluded,
          nextChain,
        )) {
          relocated = false;
          break;
        }
      }

      if (relocated) return true;
      restoreRepairState(state, snapshot);
    }
  }

  return false;
}

function repairUnassigned(
  kind,
  activeTeachers,
  tasks,
  initialAssignments,
  initialUnassigned,
  settings,
  variant,
  lockedTaskIds = new Set(),
  frozenTeacherIds = new Set(),
) {
  const state = createRepairState(
    activeTeachers,
    tasks,
    initialAssignments,
    settings,
    variant,
    lockedTaskIds,
    frozenTeacherIds,
  );
  const initialPlacements = new Map(
    initialAssignments.map((assignment) => [assignment.taskId, assignment.teacherId]),
  );
  const remaining = [];
  const pending = [...initialUnassigned].sort((a, b) => b.periods - a.periods);

  for (const task of pending) {
    const snapshot = snapshotRepairState(state);
    if (!tryPlaceTask(kind, task, state, MAX_RELOCATION_DEPTH)) {
      restoreRepairState(state, snapshot);
      remaining.push(task);
    }
  }

  const assignments = repairAssignmentsView(state).sort((a, b) => (
    a.teacherId.localeCompare(b.teacherId)
    || compareGrades(a.grade, b.grade)
    || a.subject.localeCompare(b.subject, 'ar')
    || a.section - b.section
  ));
  const relocationCount = [...initialPlacements].filter(([taskId, teacherId]) => (
    state.placements.get(taskId) !== teacherId
  )).length;
  const repairedCount = initialUnassigned.filter((task) => state.placements.has(task.id)).length;

  return {
    assignments,
    unassigned: remaining,
    relocationCount,
    repairedCount,
  };
}

function mutateAssignments(
  activeTeachers,
  tasks,
  assignments,
  settings,
  variant,
  lockedTaskIds = new Set(),
  frozenTeacherIds = new Set(),
) {
  if (!assignments.length || variant.mutationSteps <= 0) return assignments;

  const teacherById = new Map(activeTeachers.map((teacher) => [teacher.id, teacher]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const placements = new Map(assignments.map((item) => [item.taskId, item.teacherId]));
  const manualOverrideTaskIds = new Set(
    assignments.filter((item) => item.manualOverride).map((item) => item.taskId),
  );
  const loads = new Map(activeTeachers.map((teacher) => [teacher.id, 0]));
  for (const assignment of assignments) {
    loads.set(assignment.teacherId, (loads.get(assignment.teacherId) ?? 0) + assignment.periods);
  }

  const assignedTaskIds = [...placements.keys()].filter((taskId) => !lockedTaskIds.has(taskId));
  for (let step = 0; step < variant.mutationSteps; step += 1) {
    const firstIndex = Math.floor(
      seededUnit(variant.seed, `mutation:first:${step}`) * assignedTaskIds.length,
    );
    const taskA = taskById.get(assignedTaskIds[firstIndex]);
    if (!taskA) continue;
    const teacherAId = placements.get(taskA.id);
    const teacherA = teacherById.get(teacherAId);
    if (!teacherA) continue;

    const trySwap = seededUnit(variant.seed, `mutation:type:${step}`) < 0.72;
    if (trySwap) {
      const compatible = assignedTaskIds
        .map((taskId) => taskById.get(taskId))
        .filter((taskB) => {
          if (!taskB || taskB.id === taskA.id || lockedTaskIds.has(taskB.id)) return false;
          const teacherBId = placements.get(taskB.id);
          if (!teacherBId || teacherBId === teacherAId) return false;
          const teacherB = teacherById.get(teacherBId);
          if (!teacherB) return false;
          const loadA = loads.get(teacherAId) ?? 0;
          const loadB = loads.get(teacherBId) ?? 0;
          return isEligible(teacherA, taskB)
            && isEligible(teacherB, taskA)
            && loadA - taskA.periods + taskB.periods <= teacherMaxLoad(teacherA, settings)
            && loadB - taskB.periods + taskA.periods <= teacherMaxLoad(teacherB, settings);
        });

      if (compatible.length) {
        const taskB = compatible[Math.floor(
          seededUnit(variant.seed, `mutation:second:${step}`) * compatible.length,
        )];
        const teacherBId = placements.get(taskB.id);
        placements.set(taskA.id, teacherBId);
        placements.set(taskB.id, teacherAId);
        loads.set(
          teacherAId,
          (loads.get(teacherAId) ?? 0) - taskA.periods + taskB.periods,
        );
        loads.set(
          teacherBId,
          (loads.get(teacherBId) ?? 0) - taskB.periods + taskA.periods,
        );
        continue;
      }
    }

    const destinationCandidates = activeTeachers.filter((teacher) => {
      if (
        teacher.id === teacherAId
        || frozenTeacherIds.has(teacher.id)
        || !isEligible(teacher, taskA)
      ) return false;
      return (loads.get(teacher.id) ?? 0) + taskA.periods <= teacherMaxLoad(teacher, settings);
    });
    if (!destinationCandidates.length) continue;
    const destination = destinationCandidates[Math.floor(
      seededUnit(variant.seed, `mutation:destination:${step}`) * destinationCandidates.length,
    )];
    placements.set(taskA.id, destination.id);
    loads.set(teacherAId, Math.max(0, (loads.get(teacherAId) ?? 0) - taskA.periods));
    loads.set(destination.id, (loads.get(destination.id) ?? 0) + taskA.periods);
  }

  return [...placements].map(([taskId, teacherId]) => {
    const task = taskById.get(taskId);
    const teacher = teacherById.get(teacherId);
    return assignmentFromTaskWithManualOverride(
      task,
      teacher,
      manualOverrideTaskIds.has(taskId),
    );
  }).sort((a, b) => a.taskId.localeCompare(b.taskId));
}

export function scenarioSignature(scenarioOrAssignments, unassigned = []) {
  const assignments = Array.isArray(scenarioOrAssignments)
    ? scenarioOrAssignments
    : scenarioOrAssignments.assignments;
  const missing = Array.isArray(scenarioOrAssignments)
    ? unassigned
    : scenarioOrAssignments.unassigned;
  return [
    ...assignments.map((item) => `${item.taskId}:${item.teacherId}`).sort(),
    ...missing.map((item) => `${item.id}:unassigned`).sort(),
  ].join('|');
}

function modelId(signature) {
  return `model-${hashString(signature).toString(36)}`;
}

function assignmentMap(scenario) {
  return new Map(scenario.assignments.map((assignment) => [assignment.taskId, assignment.teacherId]));
}

export function modelDistance(first, second) {
  const firstMap = assignmentMap(first);
  const secondMap = assignmentMap(second);
  const taskIds = new Set([...firstMap.keys(), ...secondMap.keys()]);
  if (!taskIds.size) return 0;
  let different = 0;
  for (const taskId of taskIds) {
    if (firstMap.get(taskId) !== secondMap.get(taskId)) different += 1;
  }
  return different / taskIds.size;
}

function scenarioMetrics(activeTeachers, assignments, unassigned, settings) {
  const summaries = buildSummaries(activeTeachers, assignments, settings);
  const loads = summaries.map((item) => item.load);
  const utilizationVariance = variance(summaries.map((item) => (
    item.load / Math.max(1, item.maxLoad)
  )));
  const rawLoadVariance = variance(loads);
  const overloadCount = summaries.filter((summary) => summary.load > summary.maxLoad).length;
  const flexiblePeriodsCount = summaries.reduce((sum, item) => sum + item.flexiblePeriods, 0);
  const unassignedPeriods = unassigned.reduce((sum, item) => sum + item.periods, 0);
  const compactness = summaries.reduce(
    (sum, item) => sum + item.subjectCount + item.gradeCount,
    0,
  );
  const highestLoad = loads.length ? Math.max(...loads) : 0;
  const lowestLoad = loads.length ? Math.min(...loads) : 0;
  const loadSpread = highestLoad - lowestLoad;
  const rankScore = unassignedPeriods * 100_000
    + unassigned.length * 30_000
    + overloadCount * 20_000
    + utilizationVariance * 4_000
    + loadSpread * 120
    + flexiblePeriodsCount * 1.5
    + compactness * 2;

  return {
    summaries,
    variance: rawLoadVariance,
    utilizationVariance,
    overloadCount,
    flexiblePeriodsCount,
    compactness,
    highestLoad,
    lowestLoad,
    loadSpread,
    unassignedPeriods,
    rankScore,
  };
}


function prepareFixedAssignments(activeTeachers, tasks, settings, fixedAssignments = []) {
  const teacherById = new Map(activeTeachers.map((teacher) => [teacher.id, teacher]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const seenTaskIds = new Set();
  const loads = new Map(activeTeachers.map((teacher) => [teacher.id, 0]));
  const assignments = [];
  const errors = [];

  for (const fixed of fixedAssignments) {
    const task = taskById.get(fixed.taskId);
    const teacher = teacherById.get(fixed.teacherId);
    if (!task) {
      errors.push(`تعذر تثبيت تكليف غير موجود: ${fixed.taskId}.`);
      continue;
    }
    if (!teacher) {
      errors.push(`تعذر تثبيت ${task.grade} / ${task.section}: المعلم غير موجود أو غير نشط.`);
      continue;
    }
    if (seenTaskIds.has(task.id)) {
      errors.push(`التكليف ${task.grade} / ${task.section} مثبت أكثر من مرة.`);
      continue;
    }
    const regularStatus = assignmentStatus(teacher, task);
    const fixedStatus = fixed.manualOverride
      ? getManualTransferStatus(teacher, task)
      : regularStatus;
    if (fixedStatus === ASSIGNMENT_STATUS.FORBIDDEN) {
      errors.push(`${teacher.name}: التكليف المثبت ${task.grade} / ${task.section} خارج نطاقه.`);
      continue;
    }
    const nextLoad = (loads.get(teacher.id) ?? 0) + task.periods;
    if (nextLoad > teacherMaxLoad(teacher, settings)) {
      errors.push(`${teacher.name}: التكليفات المثبتة تتجاوز سقف النصاب.`);
      continue;
    }
    seenTaskIds.add(task.id);
    loads.set(teacher.id, nextLoad);
    assignments.push(assignmentFromTask(task, teacher, fixedStatus, {
      manualOverride: Boolean(
        fixed.manualOverride
        && regularStatus === ASSIGNMENT_STATUS.FORBIDDEN
        && fixedStatus !== ASSIGNMENT_STATUS.FORBIDDEN
      ),
    }));
  }

  return {
    assignments,
    lockedTaskIds: seenTaskIds,
    errors,
  };
}

export function evaluateScenario(
  teachers,
  requirements,
  settings = DEFAULT_SETTINGS,
  assignments = [],
  unassigned = [],
  options = {},
) {
  const normalizedSettings = normalizeSettings(settings);
  const activeTeachers = teachers.filter((teacher) => teacher.active);
  const taskById = new Map(expandRequirements(requirements).map((task) => [task.id, task]));
  const teacherById = new Map(activeTeachers.map((teacher) => [teacher.id, teacher]));
  const normalizedAssignments = assignments.flatMap((assignment) => {
    const task = taskById.get(assignment.taskId) ?? assignment;
    const teacher = teacherById.get(assignment.teacherId);
    if (!task || !teacher) return [];
    const regularStatus = assignmentStatus(teacher, task);
    const manualStatus = assignment.manualOverride
      ? getManualTransferStatus(teacher, task)
      : regularStatus;
    const manualOverride = Boolean(
      assignment.manualOverride
      && regularStatus === ASSIGNMENT_STATUS.FORBIDDEN
      && manualStatus !== ASSIGNMENT_STATUS.FORBIDDEN
    );
    return [assignmentFromTask(
      task,
      teacher,
      manualOverride ? manualStatus : regularStatus,
      { manualOverride },
    )];
  });
  const normalizedUnassigned = unassigned.map((item) => taskById.get(item.id) ?? item);
  const metrics = scenarioMetrics(
    activeTeachers,
    normalizedAssignments,
    normalizedUnassigned,
    normalizedSettings,
  );
  const signature = scenarioSignature(normalizedAssignments, normalizedUnassigned);

  return {
    id: options.id ?? modelId(signature),
    style: options.style ?? 'balanced',
    label: options.label ?? 'الخطة قيد التعديل',
    tag: options.tag ?? 'مسودة',
    description: options.description ?? 'خطة قابلة للتثبيت والنقل وإعادة توزيع الجزء غير المثبت.',
    assignments: normalizedAssignments,
    unassigned: normalizedUnassigned,
    relocationCount: Number(options.relocationCount) || 0,
    repairedCount: Number(options.repairedCount) || 0,
    signature,
    ...metrics,
    score: metrics.rankScore,
    warnings: buildWarnings(metrics.summaries, normalizedUnassigned),
  };
}

export function validateFixedAssignments(
  teachers,
  requirements,
  settings = DEFAULT_SETTINGS,
  fixedAssignments = [],
) {
  const normalizedSettings = normalizeSettings(settings);
  const activeTeachers = teachers.filter((teacher) => teacher.active);
  const tasks = expandRequirements(requirements)
    .filter((task) => task.periods > 0 && task.subject && task.grade);
  return prepareFixedAssignments(
    activeTeachers,
    tasks,
    normalizedSettings,
    fixedAssignments,
  ).errors;
}

export function generateScenario(
  kind,
  teachers,
  requirements,
  settings = DEFAULT_SETTINGS,
  options = {},
) {
  const normalizedSettings = normalizeSettings(settings);
  const activeTeachers = teachers.filter((teacher) => teacher.active);
  const tasks = expandRequirements(requirements)
    .filter((task) => task.periods > 0 && task.subject && task.grade);
  const variant = options.variant ?? createVariant(options.seed ?? 0, options.attempt ?? 0);
  const frozenTeacherIds = new Set(options.frozenTeacherIds || []);
  const fixed = prepareFixedAssignments(
    activeTeachers,
    tasks,
    normalizedSettings,
    options.fixedAssignments || [],
  );

  const greedy = greedyAssign(
    kind,
    activeTeachers,
    tasks,
    normalizedSettings,
    variant,
    fixed.assignments,
    frozenTeacherIds,
  );
  const optimized = options.skipRepair
    ? {
      assignments: greedy.assignments,
      unassigned: greedy.unassigned,
      relocationCount: 0,
      repairedCount: 0,
    }
    : repairUnassigned(
      kind,
      activeTeachers,
      tasks,
      greedy.assignments,
      greedy.unassigned,
      normalizedSettings,
      variant,
      fixed.lockedTaskIds,
      frozenTeacherIds,
    );
  const diversifiedAssignments = options.skipMutation
    ? optimized.assignments
    : mutateAssignments(
      activeTeachers,
      tasks,
      optimized.assignments,
      normalizedSettings,
      variant,
      fixed.lockedTaskIds,
      frozenTeacherIds,
    );
  const metrics = scenarioMetrics(
    activeTeachers,
    diversifiedAssignments,
    optimized.unassigned,
    normalizedSettings,
  );
  const signature = scenarioSignature(diversifiedAssignments, optimized.unassigned);

  return {
    id: modelId(signature),
    style: kind,
    label: '',
    tag: '',
    description: scenarioMeta[kind]?.description ?? scenarioMeta.balanced.description,
    assignments: diversifiedAssignments,
    unassigned: optimized.unassigned,
    relocationCount: optimized.relocationCount,
    repairedCount: optimized.repairedCount,
    signature,
    ...metrics,
    score: metrics.rankScore,
    warnings: [...new Set([
      ...fixed.errors,
      ...buildWarnings(metrics.summaries, optimized.unassigned),
    ])],
  };
}

function deduplicateModels(candidates) {
  const bySignature = new Map();
  for (const candidate of candidates) {
    const previous = bySignature.get(candidate.signature);
    if (!previous || candidate.rankScore < previous.rankScore) {
      bySignature.set(candidate.signature, candidate);
    }
  }
  return [...bySignature.values()];
}

function displayTag(model, winners) {
  const tags = [];
  if (model.signature === winners.balanced) tags.push('الأكثر توازنًا');
  if (model.signature === winners.specialized) tags.push('الأكثر تخصصًا');
  if (model.signature === winners.compact) tags.push('الأقل تشعبًا');
  return tags.join(' · ') || 'بديل مختلف';
}

export function rankDistributionModels(candidates, limit = 20) {
  const unique = deduplicateModels(candidates);
  const complete = unique.filter((model) => model.unassigned.length === 0 && model.overloadCount === 0);
  const source = complete.length ? complete : unique;
  if (!source.length) return [];

  const balancedWinner = [...source].sort((a, b) => (
    a.unassigned.length - b.unassigned.length
    || a.utilizationVariance - b.utilizationVariance
    || a.loadSpread - b.loadSpread
    || a.rankScore - b.rankScore
  ))[0];
  const specializedWinner = [...source].sort((a, b) => (
    a.unassigned.length - b.unassigned.length
    || a.flexiblePeriodsCount - b.flexiblePeriodsCount
    || a.rankScore - b.rankScore
  ))[0];
  const compactWinner = [...source].sort((a, b) => (
    a.unassigned.length - b.unassigned.length
    || a.compactness - b.compactness
    || a.rankScore - b.rankScore
  ))[0];
  const winners = {
    balanced: balancedWinner.signature,
    specialized: specializedWinner.signature,
    compact: compactWinner.signature,
  };

  const ordered = [...source].sort((a, b) => a.rankScore - b.rankScore);
  const selected = [];
  const winnerSignatures = [...new Set(Object.values(winners))];
  for (const signature of winnerSignatures) {
    if (selected.length >= limit) break;
    const model = ordered.find((item) => item.signature === signature);
    if (model && !selected.some((item) => item.signature === signature)) selected.push(model);
  }

  while (selected.length < Math.min(limit, ordered.length)) {
    let best = null;
    let bestValue = -Infinity;
    for (const candidate of ordered) {
      if (selected.some((item) => item.signature === candidate.signature)) continue;
      const minimumDistance = selected.length
        ? Math.min(...selected.map((item) => modelDistance(item, candidate)))
        : 1;
      const qualityPenalty = candidate.rankScore - ordered[0].rankScore;
      const value = minimumDistance * 12_000 - qualityPenalty;
      if (value > bestValue) {
        best = candidate;
        bestValue = value;
      }
    }
    if (!best) break;
    selected.push(best);
  }

  return selected.map((model, index) => ({
    ...model,
    label: `النموذج ${index + 1}`,
    tag: displayTag(model, winners),
    description: index === 0
      ? 'أفضل نتيجة عامة وجدها المحرك ضمن البحث الحالي.'
      : `يختلف عن النموذج الأول في ${Math.round(modelDistance(selected[0], model) * model.assignments.length)} تكليفات.`,
  }));
}

export function generateDistributionModels(
  teachers,
  requirements,
  settings = DEFAULT_SETTINGS,
  options = {},
) {
  const limit = Math.max(1, Number(options.limit) || 20);
  const attempts = Math.max(limit * 4, Number(options.attempts) || 100);
  const seedOffset = Math.max(0, Number(options.seedOffset) || 0);
  const excluded = new Set(options.excludeSignatures || []);
  const candidates = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const style = MODEL_STYLES[attempt % MODEL_STYLES.length];
    const seed = seedOffset * 100_003 + attempt + 1;
    const scenario = generateScenario(style, teachers, requirements, settings, {
      seed,
      attempt,
      variant: createVariant(seed, attempt),
      fixedAssignments: options.fixedAssignments || [],
      frozenTeacherIds: options.frozenTeacherIds || [],
      skipRepair: Boolean(options.skipRepair),
      skipMutation: Boolean(options.skipMutation),
    });
    if (!excluded.has(scenario.signature)) candidates.push(scenario);
  }

  const uniqueCandidates = deduplicateModels(candidates);
  const models = rankDistributionModels(uniqueCandidates, limit);
  return {
    models,
    attempts,
    uniqueFound: uniqueCandidates.length,
    completeFound: uniqueCandidates.filter(
      (model) => model.unassigned.length === 0 && model.overloadCount === 0,
    ).length,
  };
}

export function generateAllScenarios(teachers, requirements, settings = DEFAULT_SETTINGS) {
  return generateDistributionModels(teachers, requirements, settings, {
    limit: 20,
    attempts: 100,
  }).models;
}

function minimumTaskCountForShortage(tasks, shortagePeriods) {
  let remaining = Math.max(0, Number(shortagePeriods) || 0);
  if (!remaining) return 0;
  const ordered = [...tasks].sort((a, b) => b.periods - a.periods);
  let count = 0;
  for (const task of ordered) {
    remaining -= task.periods;
    count += 1;
    if (remaining <= 0) return count;
  }
  return count;
}

function eligibleTeacherIds(teachers, requirement) {
  return teachers
    .filter((teacher) => getAssignmentStatus(teacher, requirement) !== ASSIGNMENT_STATUS.FORBIDDEN)
    .map((teacher) => teacher.id);
}

export function analyzeDistributionFeasibility(
  teachers,
  requirements,
  settings = DEFAULT_SETTINGS,
) {
  const normalizedSettings = normalizeSettings(settings);
  const activeTeachers = teachers.filter((teacher) => teacher.active);
  const tasks = expandRequirements(requirements)
    .filter((task) => task.periods > 0 && task.subject && task.grade);
  const teacherById = new Map(activeTeachers.map((teacher) => [teacher.id, teacher]));
  const capacityById = new Map(activeTeachers.map((teacher) => [
    teacher.id,
    teacherMaxLoad(teacher, normalizedSettings),
  ]));

  const requiredPeriods = tasks.reduce((sum, task) => sum + task.periods, 0);
  const availablePeriods = [...capacityById.values()].reduce((sum, load) => sum + load, 0);
  const issues = [];
  const issueKeys = new Set();

  const addIssue = (issue) => {
    const key = issue.key || `${issue.type}:${issue.shortagePeriods}:${issue.teacherIds?.join(',') || ''}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push({ ...issue, key });
  };

  const totalShortage = Math.max(0, requiredPeriods - availablePeriods);
  if (totalShortage > 0) {
    addIssue({
      type: 'total-capacity',
      title: 'الطاقة التدريسية الإجمالية غير كافية',
      requiredPeriods,
      availablePeriods,
      shortagePeriods: totalShortage,
      uncoveredSections: minimumTaskCountForShortage(tasks, totalShortage),
      message: `تحتاج الخطة إلى ${requiredPeriods} حصة، بينما الطاقة القصوى للمعلمين ${availablePeriods} حصة.`,
    });
  }

  for (const requirement of requirements) {
    const requirementTasks = tasks.filter((task) => task.requirementId === requirement.id);
    const demand = requirementTasks.reduce((sum, task) => sum + task.periods, 0);
    const teacherIds = eligibleTeacherIds(activeTeachers, requirement);
    const capacity = teacherIds.reduce((sum, id) => sum + (capacityById.get(id) || 0), 0);
    if (demand > capacity) {
      const shortage = demand - capacity;
      addIssue({
        type: 'requirement-capacity',
        title: `تغطية غير كافية: ${requirement.subject} · ${requirement.grade}`,
        requirementId: requirement.id,
        teacherIds,
        requiredPeriods: demand,
        availablePeriods: capacity,
        shortagePeriods: shortage,
        uncoveredSections: minimumTaskCountForShortage(requirementTasks, shortage),
        message: teacherIds.length
          ? `حصص هذا المقرر ${demand}، والطاقة القصوى للمعلمين المسموح لهم به ${capacity} حصة.`
          : 'لا يوجد معلم مسموح له بتدريس هذا الصف والمقرر.',
      });
    }
  }

  // Necessary Hall-style checks catch combined restrictions that a row-by-row check misses.
  // Enumeration stays deliberately bounded so the precheck remains instant on ordinary school data.
  if (activeTeachers.length > 0 && activeTeachers.length <= 12) {
    const teacherIndex = new Map(activeTeachers.map((teacher, index) => [teacher.id, index]));
    const taskMasks = tasks.map((task) => {
      const requirement = requirements.find((item) => item.id === task.requirementId) || task;
      const ids = eligibleTeacherIds(activeTeachers, requirement);
      const mask = ids.reduce((value, id) => value | (1 << teacherIndex.get(id)), 0);
      return { task, mask };
    });
    const fullMask = (1 << activeTeachers.length) - 1;
    const candidates = [];
    for (let mask = 1; mask < fullMask; mask += 1) {
      let capacity = 0;
      const teacherIds = [];
      for (let index = 0; index < activeTeachers.length; index += 1) {
        if ((mask & (1 << index)) === 0) continue;
        const teacher = activeTeachers[index];
        teacherIds.push(teacher.id);
        capacity += capacityById.get(teacher.id) || 0;
      }
      const constrained = taskMasks.filter(({ mask: taskMask }) => taskMask !== 0 && (taskMask & ~mask) === 0);
      const demand = constrained.reduce((sum, item) => sum + item.task.periods, 0);
      if (demand > capacity) {
        candidates.push({
          mask,
          teacherIds,
          constrainedTasks: constrained.map((item) => item.task),
          demand,
          capacity,
          shortage: demand - capacity,
        });
      }
    }
    candidates
      .sort((a, b) => b.shortage - a.shortage || a.teacherIds.length - b.teacherIds.length)
      .slice(0, 4)
      .forEach((candidate) => {
        const teacherNames = candidate.teacherIds
          .map((id) => teacherById.get(id)?.name)
          .filter(Boolean);
        addIssue({
          type: 'combined-scope-capacity',
          title: 'قيود الإسناد تمنع تغطية جزء من الخطة',
          teacherIds: candidate.teacherIds,
          requiredPeriods: candidate.demand,
          availablePeriods: candidate.capacity,
          shortagePeriods: candidate.shortage,
          uncoveredSections: minimumTaskCountForShortage(
            candidate.constrainedTasks,
            candidate.shortage,
          ),
          message: `التكليفات المحصورة في ${teacherNames.join('، ') || 'هذا النطاق'} تحتاج ${candidate.demand} حصة، بينما طاقتهم ${candidate.capacity} حصة.`,
        });
      });
  }

  const shortagePeriods = issues.reduce(
    (maximum, issue) => Math.max(maximum, issue.shortagePeriods || 0),
    0,
  );
  const uncoveredSections = issues.reduce(
    (maximum, issue) => Math.max(maximum, issue.uncoveredSections || 0),
    0,
  );
  const regularTeacherCapacity = Math.max(1, normalizedSettings.teacherMaxLoad);

  return {
    feasible: issues.length === 0,
    requiredPeriods,
    availablePeriods,
    shortagePeriods,
    uncoveredSections,
    minimumAdditionalTeachers: shortagePeriods > 0
      ? Math.ceil(shortagePeriods / regularTeacherCapacity)
      : 0,
    issues,
  };
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
