import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../src/data/seed.js';
import { expandRequirements, generateAllScenarios, validateInputs } from '../src/engine/distribution.js';

test('expands sections and totals 138 periods', () => {
  const tasks=expandRequirements(seedData.requirements);
  assert.equal(tasks.length,53);
  assert.equal(tasks.reduce((s,x)=>s+x.periods,0),138);
});
test('generates three scenarios',()=>assert.equal(generateAllScenarios(seedData.teachers,seedData.requirements).length,3));
test('science seed has no unassigned tasks',()=>{for(const s of generateAllScenarios(seedData.teachers,seedData.requirements)) assert.equal(s.unassigned.length,0);});
test('does not lose periods',()=>{const s=generateAllScenarios(seedData.teachers,seedData.requirements)[0];assert.equal(s.assignments.reduce((n,x)=>n+x.periods,0)+s.unassigned.reduce((n,x)=>n+x.periods,0),138);});
test('invalid load bounds are rejected',()=>{const bad=[{...seedData.teachers[0],minLoad:20,targetLoad:16,maxLoad:18}];assert.match(validateInputs(bad,seedData.requirements).join(' '),/الحد الأدنى/);});

test('balanced science scenario respects maximum loads',()=>{const s=generateAllScenarios(seedData.teachers,seedData.requirements)[0];assert.equal(s.overloadCount,0);});
test('balanced science scenario satisfies minimum loads when feasible',()=>{const s=generateAllScenarios(seedData.teachers,seedData.requirements)[0];assert.equal(s.underMinCount,0);});
test('all science scenarios stay within configured bounds',()=>{for(const s of generateAllScenarios(seedData.teachers,seedData.requirements)){assert.equal(s.overloadCount,0);assert.equal(s.underMinCount,0);}});

import { ASSIGNMENT_STATUS, getAssignmentStatus, POLICY_MODES } from '../src/domain/assignmentPolicy.js';

function sampleTeacher(overrides = {}) {
  return {
    id: 't1',
    name: 'معلم تجريبي',
    specialty: 'الأحياء',
    allowedSubjects: ['الأحياء', 'العلوم العامة'],
    minLoad: 0,
    targetLoad: 12,
    maxLoad: 24,
    isLead: false,
    active: true,
    assignmentPolicy: { mode: POLICY_MODES.USUAL, grade: '', requirementId: '', extraRequirementId: '', customRules: {} },
    ...overrides,
  };
}

test('specialty-grade policy forbids the same specialty in other grades', () => {
  const teacher = sampleTeacher({
    assignmentPolicy: { mode: POLICY_MODES.SPECIALTY_GRADE, grade: 'التاسع', requirementId: '', extraRequirementId: '', customRules: {} },
  });
  assert.equal(getAssignmentStatus(teacher, { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء' }), ASSIGNMENT_STATUS.PREFERRED);
  assert.equal(getAssignmentStatus(teacher, { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء' }), ASSIGNMENT_STATUS.FORBIDDEN);
});

test('single requirement policy can dedicate a teacher to general science only', () => {
  const teacher = sampleTeacher({
    assignmentPolicy: { mode: POLICY_MODES.SINGLE_REQUIREMENT, grade: '', requirementId: 'g8-science', extraRequirementId: '', customRules: {} },
  });
  assert.equal(getAssignmentStatus(teacher, { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة' }), ASSIGNMENT_STATUS.PREFERRED);
  assert.equal(getAssignmentStatus(teacher, { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء' }), ASSIGNMENT_STATUS.FORBIDDEN);
});

test('specialty plus extra policy permits one extra grade-subject requirement', () => {
  const teacher = sampleTeacher({
    assignmentPolicy: { mode: POLICY_MODES.SPECIALTY_PLUS_EXTRA, grade: '', requirementId: '', extraRequirementId: 'g8-science', customRules: {} },
  });
  assert.equal(getAssignmentStatus(teacher, { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء' }), ASSIGNMENT_STATUS.PREFERRED);
  assert.equal(getAssignmentStatus(teacher, { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة' }), ASSIGNMENT_STATUS.ALLOWED);
  assert.equal(getAssignmentStatus(teacher, { id: 'g9-chem', grade: 'التاسع', subject: 'الكيمياء' }), ASSIGNMENT_STATUS.FORBIDDEN);
});

test('generator never violates a forbidden grade scope', () => {
  const requirements = [
    { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء', sections: 2, periodsPerSection: 2 },
    { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء', sections: 2, periodsPerSection: 2 },
  ];
  const gradeNineTeacher = sampleTeacher({
    id: 'g9-teacher',
    maxLoad: 8,
    assignmentPolicy: { mode: POLICY_MODES.SPECIALTY_GRADE, grade: 'التاسع', requirementId: '', extraRequirementId: '', customRules: {} },
  });
  const gradeTenTeacher = sampleTeacher({
    id: 'g10-teacher',
    maxLoad: 8,
    assignmentPolicy: { mode: POLICY_MODES.SPECIALTY_GRADE, grade: 'العاشر', requirementId: '', extraRequirementId: '', customRules: {} },
  });
  const scenario = generateAllScenarios([gradeNineTeacher, gradeTenTeacher], requirements)[0];
  assert.equal(scenario.unassigned.length, 0);
  assert.ok(scenario.assignments.filter((item) => item.teacherId === 'g9-teacher').every((item) => item.grade === 'التاسع'));
  assert.ok(scenario.assignments.filter((item) => item.teacherId === 'g10-teacher').every((item) => item.grade === 'العاشر'));
});
