import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildRequirementsForScope, PLAN_SCOPE_MODE } from '../src/domain/planScope.js';
import { POLICY_MODES } from '../src/domain/assignmentPolicy.js';
import { generateDistributionModels } from '../src/engine/distribution.js';
import { buildScenarioReportHtml } from '../src/services/export.js';
import { buildScenarioExcelFiles } from '../src/services/excelExport.js';
import { seedData } from '../src/data/seed.js';

const settings = { teacherMaxLoad: 18, leadMaxLoad: 12 };

function teacher(id, specialty, { lead = false } = {}) {
  return {
    id,
    name: lead ? 'المعلم الأول' : `معلم ${specialty} ${id}`,
    specialty,
    isLead: lead,
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

function singleSubjectScope(subjectId, templateId, teacherCount, hasLead = false) {
  return {
    mode: PLAN_SCOPE_MODE.SINGLE,
    templateId,
    subjectId,
    selectedSubjectIds: [],
    teacherCount,
    hasLead,
  };
}

function generateOne(teachers, requirements) {
  const started = performance.now();
  const result = generateDistributionModels(teachers, requirements, settings, {
    limit: 1,
    attempts: 8,
    seedOffset: 0,
  });
  return { result, elapsed: performance.now() - started };
}

function assertComplete(result, requirements) {
  assert.equal(result.models.length, 1);
  const model = result.models[0];
  assert.equal(model.unassigned.length, 0);
  assert.equal(model.overloadCount, 0);
  const expected = requirements.reduce(
    (sum, row) => sum + row.sections * row.periodsPerSection,
    0,
  );
  assert.equal(model.assignments.reduce((sum, item) => sum + item.periods, 0), expected);
  return model;
}

test('acceptance: Islamic Education plan is isolated and complete for grades 8-10', () => {
  const scope = singleSubjectScope('islamic', 'islamic', 9, true);
  const requirements = buildRequirementsForScope(scope, { start: 8, end: 10 })
    .map((row, index) => ({ ...row, sections: [8, 9, 9][index] }));
  const teachers = [
    teacher('lead', 'التربية الإسلامية', { lead: true }),
    ...Array.from({ length: 8 }, (_, index) => teacher(`i${index + 1}`, 'التربية الإسلامية')),
  ];
  const { result, elapsed } = generateOne(teachers, requirements);
  const model = assertComplete(result, requirements);
  assert.ok(requirements.every((row) => row.subject === 'التربية الإسلامية'));
  assert.ok(model.assignments.every((item) => item.subject === 'التربية الإسلامية'));
  assert.ok(elapsed < 2000, `initial generation took ${elapsed.toFixed(1)} ms`);
});

test('acceptance: Arabic plan supports primary grades without leaking another subject', () => {
  const scope = singleSubjectScope('arabic', 'arabic', 8);
  const requirements = buildRequirementsForScope(scope, { start: 1, end: 4 })
    .map((row) => ({ ...row, sections: 2 }));
  const teachers = Array.from({ length: 8 }, (_, index) => teacher(`a${index + 1}`, 'اللغة العربية'));
  const { result } = generateOne(teachers, requirements);
  const model = assertComplete(result, requirements);
  assert.deepEqual(new Set(requirements.map((row) => row.grade)), new Set(['الأول', 'الثاني', 'الثالث', 'الرابع']));
  assert.ok(model.assignments.every((item) => item.subject === 'اللغة العربية'));
});

test('acceptance: Mathematics plan works across grades 5-8', () => {
  const scope = singleSubjectScope('math', 'math', 4);
  const requirements = buildRequirementsForScope(scope, { start: 5, end: 8 });
  const teachers = Array.from({ length: 4 }, (_, index) => teacher(`m${index + 1}`, 'الرياضيات'));
  const { result } = generateOne(teachers, requirements);
  const model = assertComplete(result, requirements);
  assert.deepEqual(new Set(model.assignments.map((item) => item.grade)), new Set(['الخامس', 'السادس', 'السابع', 'الثامن']));
  assert.ok(model.assignments.every((item) => item.subject === 'الرياضيات'));
});

test('acceptance: English plan works for grades 9-12 and stays inside the selected range', () => {
  const scope = singleSubjectScope('english', 'english', 3);
  const requirements = buildRequirementsForScope(scope, { start: 9, end: 12 });
  const teachers = Array.from({ length: 3 }, (_, index) => teacher(`e${index + 1}`, 'اللغة الإنجليزية'));
  const { result } = generateOne(teachers, requirements);
  const model = assertComplete(result, requirements);
  assert.deepEqual(new Set(requirements.map((row) => row.grade)), new Set(['التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر']));
  assert.ok(model.assignments.every((item) => item.subject === 'اللغة الإنجليزية'));
});

test('acceptance: multi-subject science seed remains complete after the interface polish', () => {
  const { result } = generateOne(seedData.teachers, seedData.requirements);
  const model = assertComplete(result, seedData.requirements);
  assert.deepEqual(
    new Set(model.assignments.map((item) => item.subject)),
    new Set(['العلوم العامة', 'الفيزياء', 'الكيمياء', 'الأحياء']),
  );
});

test('acceptance: report and Excel expose only the active single subject', () => {
  const scope = singleSubjectScope('islamic', 'islamic', 2);
  const requirements = buildRequirementsForScope(scope, { start: 8, end: 8 })
    .map((row) => ({ ...row, sections: 2 }));
  const teachers = [teacher('i1', 'التربية الإسلامية'), teacher('i2', 'التربية الإسلامية')];
  const { result } = generateOne(teachers, requirements);
  const model = assertComplete(result, requirements);
  const data = {
    schoolName: 'مدرسة الاختبار',
    departmentName: 'التربية الإسلامية',
    academicYear: '2026/2027',
    settings,
    teachers,
    requirements,
  };
  const html = buildScenarioReportHtml(model, data, { approved: false });
  const excel = buildScenarioExcelFiles(model, data, { approved: false });
  const workbookText = Object.values(excel).join('\n');
  assert.match(html, /التربية الإسلامية/);
  assert.doesNotMatch(html, /الفيزياء|الكيمياء|الأحياء/);
  assert.match(workbookText, /التربية الإسلامية/);
  assert.doesNotMatch(workbookText, /الفيزياء|الكيمياء|الأحياء/);
});
