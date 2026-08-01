import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  analyzeDistributionFeasibility,
  generateDistributionModels,
} from '../src/engine/distribution.js';
import {
  getAssignmentStatus,
  POLICY_MODES,
  ASSIGNMENT_STATUS,
} from '../src/domain/assignmentPolicy.js';

const islamicRequirements = [
  { id: 'islamic-8', grade: 'الثامن', subject: 'التربية الإسلامية', sections: 9, periodsPerSection: 5 },
  { id: 'islamic-9', grade: 'التاسع', subject: 'التربية الإسلامية', sections: 9, periodsPerSection: 5 },
  { id: 'islamic-10', grade: 'العاشر', subject: 'التربية الإسلامية', sections: 8, periodsPerSection: 5 },
];

function policy(mode, overrides = {}) {
  return {
    mode,
    grade: '',
    requirementId: '',
    extraRequirementId: '',
    selectedRequirementIds: [],
    ...overrides,
  };
}

function islamicTeachers(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    id: `islamic-t${index + 1}`,
    name: index === 0 ? 'المعلم الأول' : `معلم التربية الإسلامية ${index}`,
    specialty: 'التربية الإسلامية',
    isLead: index === 0,
    active: true,
    assignmentPolicy: index === 0
      ? policy(POLICY_MODES.SPECIALTY_GRADE, { grade: 'الثامن' })
      : policy(POLICY_MODES.SPECIALTY_ONLY),
  }));
}

test('feasibility precheck catches the exact 130 vs 115 Islamic Education shortage instantly', () => {
  const started = performance.now();
  const result = analyzeDistributionFeasibility(
    islamicTeachers(5),
    islamicRequirements,
    { teacherMaxLoad: 25, leadMaxLoad: 15 },
  );
  const elapsed = performance.now() - started;

  assert.equal(result.feasible, false);
  assert.equal(result.requiredPeriods, 130);
  assert.equal(result.availablePeriods, 115);
  assert.equal(result.shortagePeriods, 15);
  assert.equal(result.uncoveredSections, 3);
  assert.equal(result.minimumAdditionalTeachers, 1);
  assert.ok(elapsed < 200, `precheck took ${elapsed.toFixed(1)}ms`);
});

test('adding a sixth teacher makes the same Islamic Education plan capacity-ready', () => {
  const result = analyzeDistributionFeasibility(
    islamicTeachers(6),
    islamicRequirements,
    { teacherMaxLoad: 25, leadMaxLoad: 15 },
  );
  assert.equal(result.feasible, true);
  assert.equal(result.requiredPeriods, 130);
  assert.equal(result.availablePeriods, 140);
  assert.equal(result.shortagePeriods, 0);
});

test('precheck detects a grade with no eligible teacher even when total capacity is enough', () => {
  const requirements = [
    { id: 'islamic-10-only', grade: 'العاشر', subject: 'التربية الإسلامية', sections: 4, periodsPerSection: 5 },
  ];
  const teachers = Array.from({ length: 2 }, (_, index) => ({
    id: `grade9-${index}`,
    name: `معلم ${index + 1}`,
    specialty: 'التربية الإسلامية',
    isLead: false,
    active: true,
    assignmentPolicy: policy(POLICY_MODES.SPECIALTY_GRADE, { grade: 'التاسع' }),
  }));
  const result = analyzeDistributionFeasibility(
    teachers,
    requirements,
    { teacherMaxLoad: 25, leadMaxLoad: 15 },
  );
  assert.equal(result.feasible, false);
  assert.ok(result.issues.some((issue) => issue.type === 'requirement-capacity'));
  assert.match(result.issues.map((issue) => issue.message).join(' '), /لا يوجد معلم/);
});

test('science assignment-control matrix remains feasible and every generated assignment is allowed', () => {
  const requirements = [
    { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة', sections: 2, periodsPerSection: 6 },
    { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء', sections: 2, periodsPerSection: 2 },
    { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء', sections: 2, periodsPerSection: 2 },
    { id: 'g9-physics', grade: 'التاسع', subject: 'الفيزياء', sections: 2, periodsPerSection: 2 },
    { id: 'g10-physics', grade: 'العاشر', subject: 'الفيزياء', sections: 2, periodsPerSection: 2 },
    { id: 'g9-chemistry', grade: 'التاسع', subject: 'الكيمياء', sections: 2, periodsPerSection: 2 },
    { id: 'g10-chemistry', grade: 'العاشر', subject: 'الكيمياء', sections: 2, periodsPerSection: 2 },
  ];
  const teachers = [
    { id: 'bio9', name: 'أحياء التاسع', specialty: 'الأحياء', isLead: false, active: true, assignmentPolicy: policy(POLICY_MODES.SPECIALTY_GRADE, { grade: 'التاسع' }) },
    { id: 'bio10', name: 'أحياء العاشر', specialty: 'الأحياء', isLead: false, active: true, assignmentPolicy: policy(POLICY_MODES.SPECIALTY_GRADE, { grade: 'العاشر' }) },
    { id: 'science8', name: 'علوم الثامن', specialty: 'الفيزياء', isLead: false, active: true, assignmentPolicy: policy(POLICY_MODES.SINGLE_REQUIREMENT, { requirementId: 'g8-science' }) },
    { id: 'physics9science', name: 'علوم الثامن وفيزياء التاسع', specialty: 'الفيزياء', isLead: false, active: true, assignmentPolicy: policy(POLICY_MODES.CUSTOM, { selectedRequirementIds: ['g8-science', 'g9-physics'] }) },
    { id: 'physics10', name: 'فيزياء العاشر', specialty: 'الفيزياء', isLead: false, active: true, assignmentPolicy: policy(POLICY_MODES.SPECIALTY_GRADE, { grade: 'العاشر' }) },
    { id: 'chemistry', name: 'كيمياء التاسع والعاشر', specialty: 'الكيمياء', isLead: false, active: true, assignmentPolicy: policy(POLICY_MODES.SPECIALTY_ONLY) },
  ];
  const settings = { teacherMaxLoad: 12, leadMaxLoad: 12 };
  assert.equal(analyzeDistributionFeasibility(teachers, requirements, settings).feasible, true);

  const result = generateDistributionModels(teachers, requirements, settings, {
    limit: 1,
    attempts: 8,
  });
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].unassigned.length, 0);
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]));
  for (const assignment of result.models[0].assignments) {
    assert.notEqual(
      getAssignmentStatus(teacherById.get(assignment.teacherId), assignment),
      ASSIGNMENT_STATUS.FORBIDDEN,
      `${assignment.teacherId} received forbidden ${assignment.subject} ${assignment.grade}`,
    );
  }
  assert.ok(result.models[0].assignments
    .filter((assignment) => assignment.teacherId === 'bio9')
    .every((assignment) => assignment.grade === 'التاسع' && assignment.subject === 'الأحياء'));
  assert.ok(result.models[0].assignments
    .filter((assignment) => assignment.teacherId === 'science8')
    .every((assignment) => assignment.requirementId === 'g8-science'));
});

test('partial diagnostic preview is generated in one lightweight attempt and remains incomplete', () => {
  const started = performance.now();
  const result = generateDistributionModels(
    islamicTeachers(5),
    islamicRequirements,
    { teacherMaxLoad: 25, leadMaxLoad: 15 },
    {
      limit: 1,
      attempts: 1,
      skipRepair: true,
      skipMutation: true,
    },
  );
  const elapsed = performance.now() - started;
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].assignments.reduce((sum, item) => sum + item.periods, 0), 115);
  assert.equal(result.models[0].unassigned.reduce((sum, item) => sum + item.periods, 0), 15);
  assert.ok(elapsed < 500, `partial preview took ${elapsed.toFixed(1)}ms`);
});
