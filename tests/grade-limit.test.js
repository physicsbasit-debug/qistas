import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canAssignGrade,
  gradeLimitViolations,
  MAX_GRADES_PER_TEACHER,
} from '../src/domain/gradeLimit.js';
import {
  generateDistributionModels,
  generateScenario,
  validateFixedAssignments,
} from '../src/engine/distribution.js';
import { POLICY_MODES } from '../src/domain/assignmentPolicy.js';

const settings = { teacherMaxLoad: 30, leadMaxLoad: 30 };

function teacher(id) {
  return {
    id,
    name: id,
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
  };
}

const requirements = [
  { id: 'g8-bio', grade: 'الثامن', subject: 'الأحياء', sections: 1, periodsPerSection: 2 },
  { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء', sections: 1, periodsPerSection: 2 },
  { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء', sections: 1, periodsPerSection: 2 },
];

test('grade helper allows sections within two grades and rejects a third grade', () => {
  const assignments = [
    { taskId: 'a', teacherId: 't1', grade: 'التاسع' },
    { taskId: 'b', teacherId: 't1', grade: 'العاشر' },
  ];
  assert.equal(MAX_GRADES_PER_TEACHER, 2);
  assert.equal(canAssignGrade(assignments, 't1', 'التاسع'), true);
  assert.equal(canAssignGrade(assignments, 't1', 'العاشر'), true);
  assert.equal(canAssignGrade(assignments, 't1', 'الثامن'), false);
});

test('single teacher is never assigned a third distinct grade automatically', () => {
  const scenario = generateScenario(
    'balanced',
    [teacher('t1')],
    requirements,
    settings,
    { seed: 3, attempt: 0, skipMutation: true },
  );
  const grades = new Set(scenario.assignments.map((assignment) => assignment.grade));
  assert.ok(grades.size <= 2);
  assert.equal(scenario.gradeLimitViolationCount, 0);
  assert.ok(scenario.unassigned.length >= 1);
});

test('multiple teachers can complete three grades while every teacher stays at two grades or fewer', () => {
  const result = generateDistributionModels(
    [teacher('t1'), teacher('t2')],
    requirements,
    settings,
    { limit: 5, attempts: 20 },
  );
  assert.ok(result.models.length > 0);
  const complete = result.models.find((model) => model.unassigned.length === 0);
  assert.ok(complete);
  assert.equal(complete.gradeLimitViolationCount, 0);
  for (const summary of complete.summaries) assert.ok(summary.gradeCount <= 2);
});

test('fixed assignments reject three distinct grades for the same teacher', () => {
  const errors = validateFixedAssignments(
    [teacher('t1')],
    requirements,
    settings,
    [
      { taskId: 'g8-bio-s1', teacherId: 't1' },
      { taskId: 'g9-bio-s1', teacherId: 't1' },
      { taskId: 'g10-bio-s1', teacherId: 't1' },
    ],
  );
  assert.match(errors.join(' '), /صفين دراسيين/);
});

test('violation helper identifies legacy or malformed three-grade assignments', () => {
  const violations = gradeLimitViolations([
    { taskId: 'a', teacherId: 't1', grade: 'الثامن' },
    { taskId: 'b', teacherId: 't1', grade: 'التاسع' },
    { taskId: 'c', teacherId: 't1', grade: 'العاشر' },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].teacherId, 't1');
  assert.equal(violations[0].grades.length, 3);
});

test('manual draft paths explicitly enforce the two-grade rule', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /canAssignGrade/);
  assert.match(source, /gradeLimitViolations/);
  assert.match(source, /حد الصفين/);
  assert.match(source, /gradeLimitViolationCount/);
  assert.match(source, /discardInvalidStoredDraft/);
  assert.match(source, /تتجاوز سقف النصاب/);
});
