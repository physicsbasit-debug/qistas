import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScenarioReportHtml,
  formatSectionList,
  groupTeacherAssignments,
} from '../src/services/export.js';
import { A4_PORTRAIT_PT, buildPdfFromJpegPages } from '../src/services/pdfExport.js';

const data = {
  schoolName: 'مدرسة الباسط للتعليم الأساسي (8-10)',
  departmentName: 'قسم العلوم',
  academicYear: '2026/2027',
  settings: { teacherMaxLoad: 18, leadMaxLoad: 12 },
  teachers: [
    { id: 't1', name: 'عبدالعزيز اليحيائي', specialty: 'الأحياء', active: true, isLead: false },
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
  // Keep summaries deliberately empty to prove that the report reads the live
  // assignment snapshot instead of a stale derived summary.
  summaries: [
    { teacherId: 't1', load: 0, maxLoad: 18, assignments: [] },
    { teacherId: 'lead', load: 0, maxLoad: 12, assignments: [] },
  ],
  unassigned: [],
  highestLoad: 8,
  lowestLoad: 4,
  loadSpread: 4,
};

test('section numbers remain explicit for manual assignment auditing', () => {
  assert.equal(formatSectionList([1, 2, 3, 5, 6, 8]), '1، 2، 3، 5، 6، 8');
  assert.equal(formatSectionList([3, 1, 3, 2]), '1، 2، 3');
  assert.equal(formatSectionList([]), '—');
});

test('teacher assignments are grouped by subject and grade', () => {
  const ownAssignments = scenario.assignments.filter((item) => item.teacherId === 't1');
  const grouped = groupTeacherAssignments(ownAssignments);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].sections, [1, 2, 3, 4]);
  assert.equal(grouped[0].periods, 8);
});

test('official report is standalone, RTL, portrait, and free of editing controls', () => {
  const html = buildScenarioReportHtml(scenario, data, {
    approved: true,
    approvedAt: '2026-07-31T10:00:00.000Z',
    planLabel: 'الخطة المعتمدة',
  });

  assert.match(html, /تقرير توزيع الأنصبة التدريسية/);
  assert.match(html, /@page \{ size: A4 portrait/);
  assert.doesNotMatch(html, /A4 landscape/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /مدرسة الباسط/);
  assert.match(html, /2026\/2027/);
  assert.match(html, /وليد الهنائي/);
  assert.match(html, /الأحياء · التاسع/);
  assert.match(html, /الشعب: 1، 2، 3، 4/);
  assert.match(html, /8 حصة/);
  assert.match(html, /ملخص تغطية المقررات/);
  assert.match(html, /class="coverage-grid"/);
  assert.match(html, /4\/4<\/b> شعبة/);
  assert.match(html, /class="signature"><strong>إعداد:<\/strong>وليد الهنائي/);
  assert.match(html, /الخطة المعتمدة/);
  assert.doesNotMatch(html, /الخطة قيد التعديل/);
  assert.doesNotMatch(html, /data-action=/);
  assert.doesNotMatch(html, /<button/);
});

test('report uses the live assignment snapshot instead of stale summaries', () => {
  const html = buildScenarioReportHtml(scenario, data, { approved: true });

  assert.match(html, /الأحياء · التاسع/);
  assert.match(html, /الشعب: 1، 2، 3، 4/);
  assert.match(html, /<strong>8<\/strong>[\s\S]*<span>من 18<\/span>/);
  assert.match(html, /الفيزياء · العاشر/);
  assert.match(html, /الشعب: 1، 2/);
  assert.match(html, /<strong>4<\/strong>[\s\S]*<span>من 12<\/span>/);
});

test('portrait report uses the compact three-column teacher layout', () => {
  const html = buildScenarioReportHtml(scenario, data, { approved: true });

  assert.match(html, /<th class="col-teacher">المعلم<\/th>/);
  assert.match(html, /<th class="col-assignments">التوزيع المعتمد<\/th>/);
  assert.match(html, /<th class="col-load">النصاب<\/th>/);

  assert.match(
    html,
    /\.teacher-table th\.col-teacher, \.teacher-table td\.teacher-cell \{ width: 28%; \}/,
  );
  assert.match(
    html,
    /\.teacher-table th\.col-assignments, \.teacher-table td\.assignments-cell \{ width: 57%; \}/,
  );
  assert.match(
    html,
    /\.teacher-table th\.col-load, \.teacher-table td\.load-cell \{ width: 15%; \}/,
  );

  assert.match(html, /\.teacher-display \{ display: block; font-size: 10\.5pt;/);
  assert.match(html, /font-size: 9\.15pt;/);
  assert.match(html, /\.teacher-subline \{ display: block; color: #62726f; font-size: 8\.8pt;/);
  assert.match(html, /\.assignment-row strong \{ color: #203e3a; font-size: 9\.2pt;/);
  assert.match(html, /\.assignment-row span \{ color: #516360; font-size: 9\.3pt;/);
  assert.match(html, /font-size: 9pt;/);
  assert.match(html, /عبدالعزيز اليحيائي/);
  assert.match(html, /الأحياء/);
});

test('report no longer renders the seven-column landscape table', () => {
  const html = buildScenarioReportHtml(scenario, data, { approved: true });

  assert.doesNotMatch(html, />م<\/th>/);
  assert.doesNotMatch(html, />التخصص<\/th>/);
  assert.doesNotMatch(html, />الدور<\/th>/);
  assert.doesNotMatch(html, />ملاحظات<\/th>/);
  assert.doesNotMatch(html, /report-spacious/);
  assert.doesNotMatch(html, /report-compact/);
});

test('direct PDF writer creates a real A4 portrait PDF without printer settings', () => {
  const bytes = buildPdfFromJpegPages([
    { width: 1588, height: 2246, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
  ]);
  const text = new TextDecoder('latin1').decode(bytes);

  assert.equal(text.slice(0, 8), '%PDF-1.4');
  assert.match(
    text,
    new RegExp(`/MediaBox \\[0 0 ${A4_PORTRAIT_PT.width} ${A4_PORTRAIT_PT.height}\\]`),
  );
  assert.match(text, /\/Count 1/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /xref/);
  assert.match(text, /%%EOF/);
});

test('direct PDF writer still supports multiple portrait pages at the low-level writer', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const bytes = buildPdfFromJpegPages([
    { width: 1588, height: 2246, bytes: jpeg },
    { width: 1588, height: 2246, bytes: jpeg },
  ]);
  const text = new TextDecoder('latin1').decode(bytes);

  assert.match(text, /\/Count 2/);
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 2);
});
