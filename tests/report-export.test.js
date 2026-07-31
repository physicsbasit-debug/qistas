import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScenarioReportHtml,
  formatSectionRanges,
  groupTeacherAssignments,
} from '../src/services/export.js';

const data = {
  schoolName: 'مدرسة الباسط للتعليم الأساسي (8-10)',
  departmentName: 'قسم العلوم',
  academicYear: '2026/2027',
  settings: { teacherMaxLoad: 18, leadMaxLoad: 12 },
  teachers: [
    { id: 't1', name: 'معلم أحياء 1', specialty: 'الأحياء', active: true, isLead: false },
    { id: 'lead', name: 'وليد الهنائي', specialty: 'الفيزياء', active: true, isLead: true },
  ],
  requirements: [
    { id: 'bio9', grade: 'التاسع', subject: 'الأحياء', sections: 4, periodsPerSection: 2 },
    { id: 'phy10', grade: 'العاشر', subject: 'الفيزياء', sections: 2, periodsPerSection: 2 },
  ],
};

const scenario = {
  id: 'sample',
  label: 'الخطة النهائية',
  assignments: [
    { taskId: 'a1', teacherId: 't1', grade: 'التاسع', section: 1, subject: 'الأحياء', periods: 2 },
    { taskId: 'a2', teacherId: 't1', grade: 'التاسع', section: 2, subject: 'الأحياء', periods: 2 },
    { taskId: 'a3', teacherId: 't1', grade: 'التاسع', section: 3, subject: 'الأحياء', periods: 2 },
    { taskId: 'a4', teacherId: 't1', grade: 'التاسع', section: 4, subject: 'الأحياء', periods: 2 },
    { taskId: 'p1', teacherId: 'lead', grade: 'العاشر', section: 1, subject: 'الفيزياء', periods: 2 },
    { taskId: 'p2', teacherId: 'lead', grade: 'العاشر', section: 2, subject: 'الفيزياء', periods: 2 },
  ],
  summaries: [
    { teacherId: 't1', load: 8, maxLoad: 18, assignments: [] },
    { teacherId: 'lead', load: 4, maxLoad: 12, assignments: [] },
  ],
  unassigned: [],
  highestLoad: 8,
  lowestLoad: 4,
  loadSpread: 4,
};
scenario.summaries[0].assignments = scenario.assignments.filter((item) => item.teacherId === 't1');
scenario.summaries[1].assignments = scenario.assignments.filter((item) => item.teacherId === 'lead');

test('section numbers are compressed into readable ranges', () => {
  assert.equal(formatSectionRanges([1, 2, 3, 5, 6, 8]), '1-3، 5-6، 8');
});

test('teacher assignments are grouped by subject and grade', () => {
  const grouped = groupTeacherAssignments(scenario.summaries[0].assignments);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].sections, [1, 2, 3, 4]);
  assert.equal(grouped[0].periods, 8);
});

test('official report is standalone, RTL, landscape, and free of editing controls', () => {
  const html = buildScenarioReportHtml(scenario, data, {
    approved: true,
    approvedAt: '2026-07-31T10:00:00.000Z',
  });

  assert.match(html, /خطة توزيع الأنصبة التدريسية/);
  assert.match(html, /أنصبة موزونة، توزيع أذكى/);
  assert.match(html, /@page \{ size: A4 landscape/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /مدرسة الباسط/);
  assert.match(html, /2026\/2027/);
  assert.match(html, /وليد الهنائي/);
  assert.match(html, /الأحياء - التاسع:/);
  assert.match(html, /الشعب 1-4/);
  assert.match(html, /ملخص تغطية المقررات/);
  assert.match(html, /إعداد المعلم الأول/);
  assert.doesNotMatch(html, />نقل</);
  assert.doesNotMatch(html, /data-action=/);
  assert.doesNotMatch(html, /button/);
});
