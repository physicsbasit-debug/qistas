import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../src/data/seed.js';
import {
  expandRequirements,
  generateDistributionModels,
  generateScenario,
  modelDistance,
  scenarioSignature,
  teacherMaxLoad,
  validateInputs,
} from '../src/engine/distribution.js';
import {
  ASSIGNMENT_STATUS,
  getAssignmentStatus,
  POLICY_MODES,
} from '../src/domain/assignmentPolicy.js';
import { compareGrades } from '../src/domain/grades.js';

const settings = seedData.settings;
const seedSearch = generateDistributionModels(
  seedData.teachers,
  seedData.requirements,
  settings,
  { limit: 20, attempts: 100 },
);

function sampleTeacher(overrides = {}) {
  return {
    id: 't1',
    name: 'معلم تجريبي',
    specialty: 'الأحياء',
    isLead: false,
    active: true,
    assignmentPolicy: {
      mode: POLICY_MODES.SPECIALTY_ONLY,
      grade: '',
      requirementId: '',
      extraRequirementId: '',
      selectedRequirementIds: [],
    },
    ...overrides,
  };
}

test('expands sections and totals 138 periods', () => {
  const tasks = expandRequirements(seedData.requirements);
  assert.equal(tasks.length, 53);
  assert.equal(tasks.reduce((sum, task) => sum + task.periods, 0), 138);
});

test('generates twenty distinct logical models for the science seed', () => {
  assert.equal(seedSearch.models.length, 20);
  assert.ok(seedSearch.uniqueFound >= 20);
  assert.equal(new Set(seedSearch.models.map((model) => model.signature)).size, 20);
});


test('one-at-a-time generation respects the requested limit and excludes the previous model', () => {
  const first = generateDistributionModels(
    seedData.teachers,
    seedData.requirements,
    settings,
    { limit: 1, attempts: 8, seedOffset: 0 },
  );
  assert.equal(first.models.length, 1);

  const alternative = generateDistributionModels(
    seedData.teachers,
    seedData.requirements,
    settings,
    {
      limit: 1,
      attempts: 12,
      seedOffset: 1,
      excludeSignatures: [first.models[0].signature],
    },
  );
  assert.equal(alternative.models.length, 1);
  assert.notEqual(alternative.models[0].signature, first.models[0].signature);
});

test('all displayed science models are complete', () => {
  for (const model of seedSearch.models) assert.equal(model.unassigned.length, 0);
});

test('does not lose periods in any displayed model', () => {
  for (const model of seedSearch.models) {
    const assigned = model.assignments.reduce((sum, item) => sum + item.periods, 0);
    const unassigned = model.unassigned.reduce((sum, item) => sum + item.periods, 0);
    assert.equal(assigned + unassigned, 138);
  }
});

test('generated models differ meaningfully from the first model', () => {
  assert.ok(seedSearch.models.slice(1).some((model) => (
    modelDistance(seedSearch.models[0], model) >= 0.2
  )));
});

test('additional search excludes models already shown', () => {
  const excluded = seedSearch.models.map((model) => model.signature);
  const more = generateDistributionModels(
    seedData.teachers,
    seedData.requirements,
    settings,
    { limit: 10, attempts: 60, seedOffset: 1, excludeSignatures: excluded },
  );
  assert.ok(more.models.length > 0);
  assert.ok(more.models.every((model) => !excluded.includes(model.signature)));
});

test('scenario signatures are stable regardless of assignment order', () => {
  const model = seedSearch.models[0];
  assert.equal(
    scenarioSignature(model.assignments, model.unassigned),
    scenarioSignature([...model.assignments].reverse(), model.unassigned),
  );
});

test('invalid global maximum load is rejected', () => {
  const errors = validateInputs(seedData.teachers, seedData.requirements, {
    teacherMaxLoad: 0,
    leadMaxLoad: 12,
  });
  assert.match(errors.join(' '), /النصاب الأعلى/);
});

test('all generated loads respect the global role caps', () => {
  for (const model of seedSearch.models) {
    assert.equal(model.overloadCount, 0);
    for (const summary of model.summaries) assert.ok(summary.load <= summary.maxLoad);
  }
});

test('lead teacher uses the global reduced cap', () => {
  const lead = seedData.teachers.find((teacher) => teacher.isLead);
  assert.equal(teacherMaxLoad(lead, settings), 12);
});

test('regular teacher uses the global teacher cap', () => {
  const regular = seedData.teachers.find((teacher) => !teacher.isLead);
  assert.equal(teacherMaxLoad(regular, settings), 18);
});

test('specialty-grade policy forbids the same specialty in other grades', () => {
  const teacher = sampleTeacher({
    assignmentPolicy: {
      mode: POLICY_MODES.SPECIALTY_GRADE,
      grade: 'التاسع',
      requirementId: '',
      extraRequirementId: '',
      selectedRequirementIds: [],
    },
  });
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء' }),
    ASSIGNMENT_STATUS.PREFERRED,
  );
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء' }),
    ASSIGNMENT_STATUS.FORBIDDEN,
  );
});

test('single requirement policy can dedicate a teacher to general science only', () => {
  const teacher = sampleTeacher({
    assignmentPolicy: {
      mode: POLICY_MODES.SINGLE_REQUIREMENT,
      grade: '',
      requirementId: 'g8-science',
      extraRequirementId: '',
      selectedRequirementIds: [],
    },
  });
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة' }),
    ASSIGNMENT_STATUS.PREFERRED,
  );
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء' }),
    ASSIGNMENT_STATUS.FORBIDDEN,
  );
});

test('specialty plus extra allows general science without treating it as forbidden', () => {
  const teacher = sampleTeacher({
    assignmentPolicy: {
      mode: POLICY_MODES.SPECIALTY_PLUS_EXTRA,
      grade: '',
      requirementId: '',
      extraRequirementId: 'g8-science',
      selectedRequirementIds: [],
    },
  });
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء' }),
    ASSIGNMENT_STATUS.PREFERRED,
  );
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة' }),
    ASSIGNMENT_STATUS.ALLOWED,
  );
});

test('custom mode is a simple selected-or-forbidden list', () => {
  const teacher = sampleTeacher({
    assignmentPolicy: {
      mode: POLICY_MODES.CUSTOM,
      grade: '',
      requirementId: '',
      extraRequirementId: '',
      selectedRequirementIds: ['g8-science', 'g9-bio'],
    },
  });
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة' }),
    ASSIGNMENT_STATUS.ALLOWED,
  );
  assert.equal(
    getAssignmentStatus(teacher, { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء' }),
    ASSIGNMENT_STATUS.FORBIDDEN,
  );
});

test('generator never violates a forbidden grade scope', () => {
  const requirements = [
    { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء', sections: 2, periodsPerSection: 2 },
    { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء', sections: 2, periodsPerSection: 2 },
  ];
  const gradeNineTeacher = sampleTeacher({
    id: 'g9-teacher',
    assignmentPolicy: {
      mode: POLICY_MODES.SPECIALTY_GRADE,
      grade: 'التاسع',
      requirementId: '',
      extraRequirementId: '',
      selectedRequirementIds: [],
    },
  });
  const gradeTenTeacher = sampleTeacher({
    id: 'g10-teacher',
    assignmentPolicy: {
      mode: POLICY_MODES.SPECIALTY_GRADE,
      grade: 'العاشر',
      requirementId: '',
      extraRequirementId: '',
      selectedRequirementIds: [],
    },
  });
  const scenario = generateScenario(
    'balanced',
    [gradeNineTeacher, gradeTenTeacher],
    requirements,
    { teacherMaxLoad: 8, leadMaxLoad: 8 },
    { seed: 1, attempt: 0 },
  );
  assert.equal(scenario.unassigned.length, 0);
  assert.ok(scenario.assignments
    .filter((item) => item.teacherId === 'g9-teacher')
    .every((item) => item.grade === 'التاسع'));
  assert.ok(scenario.assignments
    .filter((item) => item.teacherId === 'g10-teacher')
    .every((item) => item.grade === 'العاشر'));
});

test('smart repair finds the two-eighth-and-three-physics model requested by the user', () => {
  const policy = (mode, grade = '', requirementId = '', extraRequirementId = '') => ({
    mode,
    grade,
    requirementId,
    extraRequirementId,
    selectedRequirementIds: [],
  });
  const teacher = (id, specialty, assignmentPolicy, isLead = false) => ({
    id,
    name: id,
    specialty,
    isLead,
    active: true,
    assignmentPolicy,
  });

  const teachers = [
    teacher('bio-9', 'الأحياء', policy(POLICY_MODES.SPECIALTY_GRADE, 'التاسع')),
    teacher('bio-10', 'الأحياء', policy(POLICY_MODES.SPECIALTY_GRADE, 'العاشر')),
    teacher('bio-8', 'الأحياء', policy(POLICY_MODES.SINGLE_REQUIREMENT, '', 'g8-science')),
    teacher('chem-9', 'الكيمياء', policy(POLICY_MODES.SPECIALTY_GRADE, 'التاسع')),
    teacher('chem-10', 'الكيمياء', policy(POLICY_MODES.SPECIALTY_GRADE, 'العاشر')),
    teacher('chem-8', 'الكيمياء', policy(POLICY_MODES.SINGLE_REQUIREMENT, '', 'g8-science')),
    teacher('physics-1', 'الفيزياء', policy(POLICY_MODES.SPECIALTY_ONLY)),
    teacher('physics-2', 'الفيزياء', policy(POLICY_MODES.SPECIALTY_PLUS_EXTRA, '', '', 'g8-science')),
    teacher('lead', 'الفيزياء', policy(POLICY_MODES.SPECIALTY_ONLY), true),
  ];

  const requirements = [
    { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة', sections: 8, periodsPerSection: 6 },
    { id: 'g9-physics', grade: 'التاسع', subject: 'الفيزياء', sections: 9, periodsPerSection: 2 },
    { id: 'g10-physics', grade: 'العاشر', subject: 'الفيزياء', sections: 8, periodsPerSection: 2 },
    { id: 'g9-chemistry', grade: 'التاسع', subject: 'الكيمياء', sections: 9, periodsPerSection: 2 },
    { id: 'g10-chemistry', grade: 'العاشر', subject: 'الكيمياء', sections: 8, periodsPerSection: 2 },
    { id: 'g9-biology', grade: 'التاسع', subject: 'الأحياء', sections: 9, periodsPerSection: 2 },
    { id: 'g10-biology', grade: 'العاشر', subject: 'الأحياء', sections: 8, periodsPerSection: 2 },
  ];

  const scenario = generateScenario(
    'balanced',
    teachers,
    requirements,
    { teacherMaxLoad: 18, leadMaxLoad: 14 },
    { seed: 1, attempt: 0 },
  );

  assert.equal(scenario.unassigned.length, 0);
  assert.equal(scenario.repairedCount, 1);
  assert.ok(scenario.relocationCount >= 3);

  const physicsTwo = scenario.summaries.find((summary) => summary.teacherId === 'physics-2');
  assert.equal(physicsTwo.load, 18);
  assert.equal(
    physicsTwo.assignments.filter((assignment) => assignment.requirementId === 'g8-science').length,
    2,
  );
  assert.equal(
    physicsTwo.assignments.filter((assignment) => assignment.subject === 'الفيزياء').length,
    3,
  );
});

test('fixed teacher distribution stays exactly unchanged during rebalancing', () => {
  const base = seedSearch.models[0];
  const lockedTeacherId = base.summaries.find((summary) => summary.assignments.length)?.teacherId;
  assert.ok(lockedTeacherId);
  const fixedAssignments = base.assignments
    .filter((assignment) => assignment.teacherId === lockedTeacherId)
    .map((assignment) => ({ taskId: assignment.taskId, teacherId: lockedTeacherId }));
  const expectedTaskIds = fixedAssignments.map((item) => item.taskId).sort();

  const regenerated = generateDistributionModels(
    seedData.teachers,
    seedData.requirements,
    settings,
    {
      limit: 10,
      attempts: 80,
      seedOffset: 77,
      fixedAssignments,
      frozenTeacherIds: [lockedTeacherId],
    },
  );

  assert.ok(regenerated.models.length > 0);
  for (const model of regenerated.models) {
    const actualTaskIds = model.assignments
      .filter((assignment) => assignment.teacherId === lockedTeacherId)
      .map((assignment) => assignment.taskId)
      .sort();
    assert.deepEqual(actualTaskIds, expectedTaskIds);
    assert.equal(model.unassigned.length, 0);
  }
});

test('an individually pinned task remains with its chosen teacher', () => {
  const base = seedSearch.models[0];
  const pinned = base.assignments[0];
  const regenerated = generateDistributionModels(
    seedData.teachers,
    seedData.requirements,
    settings,
    {
      limit: 10,
      attempts: 80,
      seedOffset: 91,
      fixedAssignments: [{ taskId: pinned.taskId, teacherId: pinned.teacherId }],
    },
  );

  assert.ok(regenerated.models.length > 0);
  for (const model of regenerated.models) {
    assert.equal(
      model.assignments.find((assignment) => assignment.taskId === pinned.taskId)?.teacherId,
      pinned.teacherId,
    );
  }
});

test('fixed assignment validation rejects a forbidden manual placement', async () => {
  const { validateFixedAssignments } = await import('../src/engine/distribution.js');
  const biologyTask = seedSearch.models[0].assignments.find((assignment) => assignment.subject === 'الأحياء');
  const chemistryOnly = seedData.teachers.find((teacher) => teacher.specialty === 'الكيمياء');
  const errors = validateFixedAssignments(
    seedData.teachers,
    seedData.requirements,
    settings,
    [{ taskId: biologyTask.taskId, teacherId: chemistryOnly.id }],
  );
  assert.match(errors.join(' '), /خارج نطاقه/);
});

test('scenario evaluation recalculates loads after a manual transfer', async () => {
  const { evaluateScenario } = await import('../src/engine/distribution.js');
  const base = seedSearch.models[0];
  const biologyAssignment = base.assignments.find((assignment) => assignment.subject === 'الأحياء');
  const currentTeacher = seedData.teachers.find((teacher) => teacher.id === biologyAssignment.teacherId);
  const destination = seedData.teachers.find((teacher) => (
    teacher.id !== currentTeacher.id && teacher.specialty === currentTeacher.specialty
  ));
  assert.ok(destination);

  const beforeCurrent = base.summaries.find((summary) => summary.teacherId === currentTeacher.id).load;
  const beforeDestination = base.summaries.find((summary) => summary.teacherId === destination.id).load;
  const movedAssignments = base.assignments.map((assignment) => (
    assignment.taskId === biologyAssignment.taskId
      ? { ...assignment, teacherId: destination.id }
      : assignment
  ));
  const evaluated = evaluateScenario(
    seedData.teachers,
    seedData.requirements,
    settings,
    movedAssignments,
    base.unassigned,
  );

  assert.equal(
    evaluated.summaries.find((summary) => summary.teacherId === currentTeacher.id).load,
    beforeCurrent - biologyAssignment.periods,
  );
  assert.equal(
    evaluated.summaries.find((summary) => summary.teacherId === destination.id).load,
    beforeDestination + biologyAssignment.periods,
  );
});

test('distribution engine supports requirements from grade 1 through grade 12', () => {
  const requirements = [
    { id: 'g1-arabic', grade: 'الأول', subject: 'اللغة العربية', sections: 1, periodsPerSection: 4 },
    { id: 'g12-arabic', grade: 'الثاني عشر', subject: 'اللغة العربية', sections: 1, periodsPerSection: 4 },
  ];
  const teachers = [sampleTeacher({
    id: 'arabic-1',
    name: 'معلم لغة عربية',
    specialty: 'اللغة العربية',
    assignmentPolicy: {
      mode: POLICY_MODES.SPECIALTY_ONLY,
      grade: '',
      requirementId: '',
      extraRequirementId: '',
      selectedRequirementIds: [],
    },
  })];
  const result = generateDistributionModels(teachers, requirements, {
    teacherMaxLoad: 18,
    leadMaxLoad: 12,
  }, { limit: 3, attempts: 10 });
  assert.ok(result.models.length > 0);
  assert.equal(result.models[0].unassigned.length, 0);
  assert.deepEqual(
    result.models[0].assignments.map((assignment) => assignment.grade).sort(compareGrades),
    ['الأول', 'الثاني عشر'],
  );
});
