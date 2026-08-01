import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScenarioExcelFiles } from '../src/services/excelExport.js';

const data = {
  schoolName: 'مدرسة الباسط للتعليم الأساسي (8-10)',
  departmentName: 'قسم العلوم',
  academicYear: '2026/2027',
  teachers: [
    { id: 't1', name: 'معلم أحياء 1', specialty: 'الأحياء', active: true, isLead: false },
    { id: 'lead', name: 'المعلم الأول', specialty: 'الفيزياء', active: true, isLead: true },
  ],
  requirements: [
    { id: 'bio9', grade: 'التاسع', subject: 'الأحياء', sections: 3, periodsPerSection: 2 },
    { id: 'phy10', grade: 'العاشر', subject: 'الفيزياء', sections: 2, periodsPerSection: 2 },
  ],
};

const assignments = [
  { taskId: 'a1', teacherId: 't1', grade: 'التاسع', section: 1, subject: 'الأحياء', periods: 2 },
  { taskId: 'a2', teacherId: 't1', grade: 'التاسع', section: 2, subject: 'الأحياء', periods: 2 },
  { taskId: 'a3', teacherId: 't1', grade: 'التاسع', section: 3, subject: 'الأحياء', periods: 2 },
  { taskId: 'p1', teacherId: 'lead', grade: 'العاشر', section: 1, subject: 'الفيزياء', periods: 2 },
  { taskId: 'p2', teacherId: 'lead', grade: 'العاشر', section: 2, subject: 'الفيزياء', periods: 2 },
];

const scenario = {
  id: 'sample',
  label: 'الخطة النهائية',
  assignments,
  summaries: [
    { teacherId: 't1', load: 6, maxLoad: 18, assignments: assignments.filter((item) => item.teacherId === 't1') },
    { teacherId: 'lead', load: 4, maxLoad: 12, assignments: assignments.filter((item) => item.teacherId === 'lead') },
  ],
  unassigned: [],
  highestLoad: 6,
  lowestLoad: 4,
  loadSpread: 2,
};

test('Excel package contains three readable RTL worksheets', () => {
  const files = buildScenarioExcelFiles(scenario, data, {
    approved: true,
    planLabel: 'الخطة المعتمدة',
  });
  assert.equal(Object.keys(files).length, 10);
  assert.match(files['xl/workbook.xml'], /توزيع الأنصبة/);
  assert.match(files['xl/workbook.xml'], /تفصيل التكليفات/);
  assert.match(files['xl/workbook.xml'], /ملخص المواد/);
  assert.match(files['xl/worksheets/sheet1.xml'], /rightToLeft="1"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /ySplit="8"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /autoFilter ref="A8:J10"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /width="58"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /الأحياء - التاسع: الشعب 1-3 \(6 حصة\)/);
  assert.match(files['xl/worksheets/sheet1.xml'], /orientation="landscape"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /النموذج: الخطة المعتمدة/);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'], /الخطة قيد التعديل/);
  assert.match(files['xl/worksheets/sheet2.xml'], /autoFilter ref="A4:I9"/);
  assert.match(files['xl/worksheets/sheet3.xml'], /مكتمل/);
});

test('app exposes Excel export instead of CSV export', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /تصدير Excel/);
  assert.match(source, /exportScenarioExcel/);
  assert.doesNotMatch(source, /تصدير CSV/);
  assert.doesNotMatch(source, /exportScenarioCsv/);
});

test('vendored JSZip is available for lazy browser loading', async () => {
  const source = await readFile(new URL('../src/vendor/jszip.min.js', import.meta.url), 'utf8');
  assert.ok(source.length > 90000);
  assert.match(source.slice(0, 300), /JSZip|jszip/i);
});
