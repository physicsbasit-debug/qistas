import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareGrades,
  gradeLabel,
  gradeNumber,
  gradesInRange,
  inferGradeRange,
  normalizeGradeRange,
} from '../src/domain/grades.js';

test('grade catalog covers every school grade from 1 to 12', () => {
  assert.equal(gradeLabel(1), 'الأول');
  assert.equal(gradeLabel(12), 'الثاني عشر');
  assert.equal(gradeNumber('الحادي عشر'), 11);
  assert.equal(gradesInRange({ start: 1, end: 12 }).length, 12);
});

test('grade ranges are normalized and inferred from legacy requirements', () => {
  assert.deepEqual(normalizeGradeRange({ start: 12, end: 1 }), { start: 1, end: 12 });
  assert.deepEqual(inferGradeRange([
    { grade: 'الثالث' },
    { grade: 'العاشر' },
  ]), { start: 3, end: 10 });
});

test('grade sorting is numeric rather than alphabetical', () => {
  const values = ['العاشر', 'الأول', 'الثاني عشر', 'التاسع'];
  values.sort(compareGrades);
  assert.deepEqual(values, ['الأول', 'التاسع', 'العاشر', 'الثاني عشر']);
});
