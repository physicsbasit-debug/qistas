import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../src/data/seed.js';
import {
  buildRequirementsForScope,
  inferPlanScope,
  PLAN_SCOPE_MODE,
  requirementBelongsToScope,
} from '../src/domain/planScope.js';

test('legacy science data is inferred as a multi-subject science plan', () => {
  const scope = inferPlanScope(seedData.requirements, seedData.teachers, seedData.gradeRange);
  assert.equal(scope.mode, PLAN_SCOPE_MODE.DEPARTMENT);
  assert.equal(scope.templateId, 'science');
  assert.deepEqual(new Set(scope.selectedSubjectIds), new Set([
    'general-science', 'physics', 'chemistry', 'biology',
  ]));
  assert.equal(scope.teacherCount, 9);
  assert.equal(scope.hasLead, true);
});

test('single-subject requirements never bring in another subject', () => {
  const scope = {
    mode: PLAN_SCOPE_MODE.SINGLE,
    templateId: 'arabic',
    subjectId: 'arabic',
    selectedSubjectIds: [],
    teacherCount: 4,
    hasLead: true,
  };
  const rows = buildRequirementsForScope(scope, { start: 8, end: 10 }, 'single');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.grade), ['الثامن', 'التاسع', 'العاشر']);
  assert.ok(rows.every((row) => row.subject === 'اللغة العربية'));
  assert.equal(rows.some((row) => row.subject === 'الفيزياء'), false);
});

test('department scope includes only explicitly selected subjects', () => {
  const scope = {
    mode: PLAN_SCOPE_MODE.DEPARTMENT,
    templateId: 'science',
    subjectId: '',
    selectedSubjectIds: ['general-science', 'physics'],
    teacherCount: 3,
    hasLead: false,
  };
  const rows = buildRequirementsForScope(scope, { start: 8, end: 10 }, 'double');
  assert.ok(rows.some((row) => row.subject === 'العلوم العامة'));
  assert.ok(rows.some((row) => row.subject === 'الفيزياء'));
  assert.equal(rows.some((row) => row.subject === 'الكيمياء'), false);
  assert.equal(rows.some((row) => row.subject === 'الأحياء'), false);
  assert.ok(rows.every((row) => requirementBelongsToScope(row, scope)));
});
