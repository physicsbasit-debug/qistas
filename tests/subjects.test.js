import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allSubjectLabels,
  DEPARTMENT_TEMPLATES,
  recommendedPeriods,
  requirementsForTemplate,
  SCHOOL_SHIFT,
  subjectByLabel,
  subjectsForGrade,
} from '../src/domain/subjects.js';

test('catalog covers the principal government-school subjects from grades 1 to 12', () => {
  const grade1 = subjectsForGrade('الأول').map((item) => item.label);
  const grade10 = subjectsForGrade('العاشر').map((item) => item.label);
  const grade12 = subjectsForGrade('الثاني عشر').map((item) => item.label);

  assert.ok(grade1.includes('التربية الإسلامية'));
  assert.ok(grade1.includes('الهوية والمواطنة'));
  assert.ok(grade10.includes('الفيزياء'));
  assert.ok(grade10.includes('المهارات الحياتية'));
  assert.ok(grade12.includes('الرياضيات الأساسية'));
  assert.ok(grade12.includes('الجغرافيا والتقنيات الحديثة'));
  assert.ok(grade12.includes('اللغة الفرنسية'));
});

test('recommended periods reflect school shift and remain editable defaults', () => {
  assert.equal(recommendedPeriods(1, 'اللغة العربية', SCHOOL_SHIFT.SINGLE), 12);
  assert.equal(recommendedPeriods(1, 'اللغة العربية', SCHOOL_SHIFT.DOUBLE), 11);
  assert.equal(recommendedPeriods(9, 'الفيزياء', SCHOOL_SHIFT.SINGLE), 3);
  assert.equal(recommendedPeriods(9, 'الفيزياء', SCHOOL_SHIFT.DOUBLE), 2);
  assert.equal(recommendedPeriods(12, 'اللغة الفرنسية', SCHOOL_SHIFT.SINGLE), 5);
  assert.equal(recommendedPeriods(12, 'مادة مخصصة', SCHOOL_SHIFT.SINGLE), 1);
});

test('department templates add only subjects that belong to the active grade range', () => {
  const science = requirementsForTemplate('science', { start: 8, end: 10 }, SCHOOL_SHIFT.DOUBLE);
  const signatures = new Set(science.map((item) => `${item.grade}:${item.subject}:${item.periodsPerSection}`));

  assert.ok(signatures.has('الثامن:العلوم العامة:6'));
  assert.ok(signatures.has('التاسع:الفيزياء:2'));
  assert.ok(signatures.has('العاشر:الكيمياء:2'));
  assert.equal(science.some((item) => item.grade === 'السابع'), false);
  assert.equal(science.some((item) => item.subject === 'العلوم البيئية'), false);
});

test('catalog includes editable general, optional and vocational choices', () => {
  assert.ok(subjectByLabel('التربية البدنية والصحية'));
  assert.ok(subjectByLabel('مهارات اللغة الإنجليزية')?.optional);
  assert.equal(subjectByLabel('إدارة نظم المعلومات')?.track, 'vocational');
  assert.ok(allSubjectLabels().length >= 40);
  assert.ok(DEPARTMENT_TEMPLATES.some((item) => item.id === 'vocational-business'));
});
