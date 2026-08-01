import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScenarioReportHtml,
  formatSectionRanges,
  groupTeacherAssignments,
} from '../src/services/export.js';
import { A4_LANDSCAPE_PT, buildPdfFromJpegPages } from '../src/services/pdfExport.js';

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
  assert.match(html, /class="coverage-grid"/);
  assert.match(html, /4\/4<\/b> شعبة/);
  assert.doesNotMatch(html, /class="coverage-table"/);
  assert.match(html, /إعداد المعلم الأول/);
  assert.doesNotMatch(html, />نقل</);
  assert.doesNotMatch(html, /data-action=/);
  assert.doesNotMatch(html, /button/);
});

test('print layout avoids the overflow that created a blank second page', () => {
  const html = buildScenarioReportHtml(scenario, data, { approved: true });
  assert.match(html, /@media print \{[\s\S]*html, body \{ width: auto; min-height: 0; \}/);
  assert.doesNotMatch(html, /html, body \{ width: 297mm; min-height: 210mm; \}/);
});


test('direct PDF writer creates a real A4 landscape PDF without printer settings', () => {
  const bytes = buildPdfFromJpegPages([
    { width: 2246, height: 1588, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
  ]);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.equal(text.slice(0, 8), '%PDF-1.4');
  assert.match(text, new RegExp(`/MediaBox \\[0 0 ${A4_LANDSCAPE_PT.width} ${A4_LANDSCAPE_PT.height}\\]`));
  assert.match(text, /\/Count 1/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /xref/);
  assert.match(text, /%%EOF/);
});

test('direct PDF writer supports multiple landscape pages', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const bytes = buildPdfFromJpegPages([
    { width: 2246, height: 1588, bytes: jpeg },
    { width: 2246, height: 1588, bytes: jpeg },
  ]);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.match(text, /\/Count 2/);
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 2);
});

test('small and medium plans receive a spacious readable report density', () => {
  const html = buildScenarioReportHtml(scenario, data, { approved: true });
  assert.match(html, /class="report report-spacious"/);
  assert.match(html, /\.report \{[\s\S]*min-height: 197mm;/);
  assert.match(html, /\.report-spacious \.teacher-table td \{ padding: 6px 6px; \}/);
  assert.match(html, /\.signatures \{ margin-top: auto; \}/);
});

test('large plans fall back to compact density instead of forcing one oversized page', () => {
  const manyTeachers = Array.from({ length: 12 }, (_, index) => ({
    id: `teacher-${index + 1}`,
    name: `معلم ${index + 1}`,
    specialty: 'اللغة العربية',
    active: true,
    isLead: index === 0,
  }));
  const largeData = {
    ...data,
    departmentName: 'اللغة العربية',
    teachers: manyTeachers,
    requirements: Array.from({ length: 12 }, (_, index) => ({
      id: `r-${index + 1}`,
      grade: index < 6 ? 'الخامس' : 'السادس',
      subject: 'اللغة العربية',
      sections: 1,
      periodsPerSection: 1,
    })),
  };
  const largeScenario = {
    ...scenario,
    assignments: [],
    summaries: manyTeachers.map((teacher) => ({
      teacherId: teacher.id,
      load: 0,
      maxLoad: teacher.isLead ? 12 : 18,
      assignments: [],
    })),
    highestLoad: 0,
    lowestLoad: 0,
    loadSpread: 0,
  };
  const html = buildScenarioReportHtml(largeScenario, largeData, { approved: true });
  assert.match(html, /class="report report-compact"/);
  assert.match(html, /\.report-compact \{ min-height: 0; \}/);
});
