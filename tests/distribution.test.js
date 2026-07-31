import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../src/data/seed.js';
import {
  expandRequirements,
  generateAllScenarios,
  teacherMaxLoad,
  validateInputs,
} from '../src/engine/distribution.js';
import {
  ASSIGNMENT_STATUS,
  getAssignmentStatus,
  POLICY_MODES,
} from '../src/domain/assignmentPolicy.js';

const settings = seedData.settings;

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

test('generates three internal alternatives', () => {
  assert.equal(generateAllScenarios(seedData.teachers, seedData.requirements, settings).length, 3);
});

test('science seed has no unassigned tasks', () => {
  for (const scenario of generateAllScenarios(seedData.teachers, seedData.requirements, settings)) {
    assert.equal(scenario.unassigned.length, 0);
  }
});

test('does not lose periods', () => {
  const scenario = generateAllScenarios(seedData.teachers, seedData.requirements, settings)[0];
  const assigned = scenario.assignments.reduce((sum, item) => sum + item.periods, 0);
  const unassigned = scenario.unassigned.reduce((sum, item) => sum + item.periods, 0);
  assert.equal(assigned + unassigned, 138);
});

test('invalid global maximum load is rejected', () => {
  const errors = validateInputs(seedData.teachers, seedData.requirements, {
    teacherMaxLoad: 0,
    leadMaxLoad: 12,
  });
  assert.match(errors.join(' '), /النصاب الأعلى/);
});

test('all generated loads respect the global role caps', () => {
  for (const scenario of generateAllScenarios(seedData.teachers, seedData.requirements, settings)) {
    assert.equal(scenario.overloadCount, 0);
    for (const summary of scenario.summaries) {
      assert.ok(summary.load <= summary.maxLoad);
    }
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
  const scenario = generateAllScenarios(
    [gradeNineTeacher, gradeTenTeacher],
    requirements,
    { teacherMaxLoad: 8, leadMaxLoad: 8 },
  )[0];
  assert.equal(scenario.unassigned.length, 0);
  assert.ok(scenario.assignments
    .filter((item) => item.teacherId === 'g9-teacher')
    .every((item) => item.grade === 'التاسع'));
  assert.ok(scenario.assignments
    .filter((item) => item.teacherId === 'g10-teacher')
    .every((item) => item.grade === 'العاشر'));
});
