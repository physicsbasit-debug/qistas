import { compareGrades } from '../domain/grades.js';

import { formatSectionRanges, groupTeacherAssignments } from './export.js';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const JSZIP_PATH = new URL('../vendor/jszip.min.js', import.meta.url).href;

function escapeXml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&apos;',
    '"': '&quot;',
  }[character]));
}

function safeDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function shortDate(value = new Date()) {
  return new Intl.DateTimeFormat('ar-OM', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(safeDate(value));
}

function activeTeachers(data) {
  return (data.teachers || []).filter((teacher) => teacher.active !== false);
}

function leadTeacher(data) {
  return activeTeachers(data).find((teacher) => teacher.isLead) || null;
}

function reportStatus(options = {}) {
  if (options.status) return options.status;
  if (options.approved) return 'معتمدة';
  if (options.isDraft) return 'مسودة';
  return 'مقترح';
}

function roleLabel(teacher) {
  return teacher.isLead ? 'معلم أول' : 'معلم';
}

function cellReference(column, row) {
  return `${column}${row}`;
}

function stringCell(reference, value, style = 6) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(reference, value, style = 8) {
  const numeric = Number(value);
  return `<c r="${reference}" s="${style}"><v>${Number.isFinite(numeric) ? numeric : 0}</v></c>`;
}

function rowXml(rowNumber, cells, height = 20) {
  return `<row r="${rowNumber}" ht="${height}" customHeight="1">${cells.join('')}</row>`;
}

function sheetXml({
  rows,
  dimension,
  columns,
  merges = [],
  freezeRow = 0,
  autoFilter = '',
  landscape = true,
  printArea = '',
}) {
  const pane = freezeRow
    ? `<pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
    : '';
  const filterXml = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  const printAreaXml = printArea ? `<legacyDrawingHF r:id="rId1"/>` : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0">${pane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns.map((column) => `<col min="${column.index}" max="${column.index}" width="${column.width}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${rows.join('')}</sheetData>
  ${filterXml}
  ${mergeXml}
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>
  <pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0" horizontalDpi="300" verticalDpi="300"/>
  ${printAreaXml}
</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="11"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FF0F766E"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FF17252D"/><sz val="11"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF6F3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F7EF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2E2"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD8E5E2"/></left>
      <right style="thin"><color rgb="FFD8E5E2"/></right>
      <top style="thin"><color rgb="FFD8E5E2"/></top>
      <bottom style="thin"><color rgb="FFD8E5E2"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function teacherExportRows(scenario, data) {
  const summaries = new Map((scenario.summaries || []).map((summary) => [summary.teacherId, summary]));
  return activeTeachers(data).map((teacher, index) => {
    const summary = summaries.get(teacher.id) || { assignments: [], load: 0, maxLoad: 0 };
    const groups = groupTeacherAssignments(summary.assignments || []);
    const assignmentsText = groups.length
      ? groups.map((group) => (
        `${group.subject} - ${group.grade}: الشعب ${formatSectionRanges(group.sections)} (${group.periods} حصة)`
      )).join('\n')
      : 'لا توجد شعب مسندة';
    const status = summary.load > summary.maxLoad
      ? 'متجاوز'
      : summary.load === 0
        ? 'دون إسناد'
        : 'مكتمل';

    return {
      index: index + 1,
      teacher: teacher.name,
      specialty: teacher.specialty,
      role: roleLabel(teacher),
      assignmentsText,
      sectionCount: summary.assignments?.length || 0,
      load: summary.load || 0,
      maxLoad: summary.maxLoad || 0,
      status,
      notes: teacher.isLead ? 'نصاب معلم أول' : '—',
      lineCount: Math.max(1, groups.length),
    };
  });
}

function detailExportRows(scenario, data) {
  const teacherMap = new Map(activeTeachers(data).map((teacher) => [teacher.id, teacher]));
  return [...(scenario.assignments || [])]
    .sort((a, b) => (
      compareGrades(a.grade, b.grade)
      || String(a.subject).localeCompare(String(b.subject), 'ar')
      || Number(a.section) - Number(b.section)
    ))
    .map((assignment, index) => {
      const teacher = teacherMap.get(assignment.teacherId) || {};
      return {
        index: index + 1,
        teacher: teacher.name || 'غير معروف',
        specialty: teacher.specialty || '',
        role: roleLabel(teacher),
        grade: assignment.grade,
        subject: assignment.subject,
        section: assignment.section,
        periods: assignment.periods,
        preference: assignment.preference === 'allowed' ? 'مسموح عند الحاجة' : 'أساسي',
      };
    });
}

function coverageExportRows(scenario, data) {
  const assignments = scenario.assignments || [];
  return (data.requirements || []).map((requirement, index) => {
    const matching = assignments.filter((assignment) => (
      assignment.grade === requirement.grade && assignment.subject === requirement.subject
    ));
    const assignedSections = matching.length;
    const requiredSections = Number(requirement.sections) || 0;
    const assignedPeriods = matching.reduce((sum, assignment) => sum + (Number(assignment.periods) || 0), 0);
    const requiredPeriods = requiredSections * (Number(requirement.periodsPerSection) || 0);
    return {
      index: index + 1,
      subject: requirement.subject,
      grade: requirement.grade,
      requiredSections,
      assignedSections,
      requiredPeriods,
      assignedPeriods,
      status: assignedSections === requiredSections && assignedPeriods === requiredPeriods ? 'مكتمل' : 'يحتاج مراجعة',
    };
  });
}

function buildMainSheet(scenario, data, options) {
  const rows = [];
  const merges = [
    'A1:J1', 'A2:J2',
    'A4:B4', 'C4:D4', 'E4:F4', 'G4:H4', 'I4:J4',
    'A5:B5', 'C5:D5', 'E5:F5', 'G5:H5', 'I5:J5',
    'A6:B6', 'C6:D6', 'E6:F6', 'G6:H6', 'I6:J6',
  ];
  const lead = leadTeacher(data);
  const status = reportStatus(options);
  const teacherRows = teacherExportRows(scenario, data);
  const totalPeriods = (scenario.assignments || []).reduce((sum, item) => sum + (Number(item.periods) || 0), 0);
  const preparedAt = options.preparedAt || options.approvedAt || new Date();
  const reportId = `QST-${safeDate(preparedAt).toISOString().slice(0, 10).replaceAll('-', '')}`;

  rows.push(rowXml(1, [stringCell('A1', 'قِسطاس | خطة توزيع الأنصبة التدريسية', 1)], 28));
  rows.push(rowXml(2, [stringCell('A2', 'أنصبة موزونة، توزيع أذكى', 2)], 21));
  rows.push(rowXml(3, [], 7));
  rows.push(rowXml(4, [
    stringCell('A4', `المدرسة: ${data.schoolName || 'غير محددة'}`, 13),
    stringCell('C4', `القسم: ${data.departmentName || 'غير محدد'}`, 13),
    stringCell('E4', `السنة الدراسية: ${data.academicYear || 'غير محددة'}`, 13),
    stringCell('G4', `المعلم الأول: ${lead?.name || 'غير محدد'}`, 13),
    stringCell('I4', `تاريخ التصدير: ${shortDate(preparedAt)}`, 13),
  ], 25));
  rows.push(rowXml(5, [
    stringCell('A5', `حالة الخطة: ${status}`, status === 'معتمدة' ? 9 : 10),
    stringCell('C5', `النموذج: ${options.planLabel || scenario.label || 'الخطة الحالية'}`, 13),
    stringCell('E5', `المعرف: ${reportId}`, 13),
    stringCell('G5', `غير المسندة: ${scenario.unassigned?.length || 0}`, (scenario.unassigned?.length || 0) ? 10 : 9),
    stringCell('I5', `إجمالي التكليفات: ${(scenario.assignments || []).length}`, 13),
  ], 24));
  rows.push(rowXml(6, [
    stringCell('A6', `المعلمون: ${activeTeachers(data).length}`, 11),
    stringCell('C6', `الحصص المسندة: ${totalPeriods}`, 11),
    stringCell('E6', `أعلى نصاب: ${scenario.highestLoad || 0}`, 11),
    stringCell('G6', `أقل نصاب: ${scenario.lowestLoad || 0}`, 11),
    stringCell('I6', `فرق الأنصبة: ${scenario.loadSpread || 0}`, 11),
  ], 23));
  rows.push(rowXml(7, [], 8));
  rows.push(rowXml(8, [
    stringCell('A8', 'م', 5),
    stringCell('B8', 'اسم المعلم', 5),
    stringCell('C8', 'التخصص', 5),
    stringCell('D8', 'الدور', 5),
    stringCell('E8', 'الشعب والمقررات المسندة', 5),
    stringCell('F8', 'عدد الشعب', 5),
    stringCell('G8', 'النصاب', 5),
    stringCell('H8', 'السقف', 5),
    stringCell('I8', 'الحالة', 5),
    stringCell('J8', 'ملاحظات', 5),
  ], 27));

  teacherRows.forEach((item, index) => {
    const rowNumber = 9 + index;
    const statusStyle = item.status === 'مكتمل' ? 9 : 10;
    rows.push(rowXml(rowNumber, [
      numberCell(cellReference('A', rowNumber), item.index, 7),
      stringCell(cellReference('B', rowNumber), item.teacher, 6),
      stringCell(cellReference('C', rowNumber), item.specialty, 7),
      stringCell(cellReference('D', rowNumber), item.role, 7),
      stringCell(cellReference('E', rowNumber), item.assignmentsText, 6),
      numberCell(cellReference('F', rowNumber), item.sectionCount, 8),
      numberCell(cellReference('G', rowNumber), item.load, 8),
      numberCell(cellReference('H', rowNumber), item.maxLoad, 8),
      stringCell(cellReference('I', rowNumber), item.status, statusStyle),
      stringCell(cellReference('J', rowNumber), item.notes, 7),
    ], Math.max(28, 16 + (item.lineCount * 12))));
  });

  const lastRow = 8 + teacherRows.length;
  return sheetXml({
    rows,
    dimension: `A1:J${lastRow}`,
    columns: [
      { index: 1, width: 5 },
      { index: 2, width: 22 },
      { index: 3, width: 14 },
      { index: 4, width: 12 },
      { index: 5, width: 58 },
      { index: 6, width: 11 },
      { index: 7, width: 10 },
      { index: 8, width: 10 },
      { index: 9, width: 13 },
      { index: 10, width: 17 },
    ],
    merges,
    freezeRow: 8,
    autoFilter: `A8:J${lastRow}`,
  });
}

function buildDetailSheet(scenario, data) {
  const rows = [];
  const details = detailExportRows(scenario, data);
  const merges = ['A1:I1', 'A2:I2'];
  rows.push(rowXml(1, [stringCell('A1', 'تفصيل التكليفات الصفية', 1)], 28));
  rows.push(rowXml(2, [stringCell('A2', 'ورقة تفصيلية قابلة للفرز والبحث حسب المعلم أو الصف أو المادة', 2)], 21));
  rows.push(rowXml(3, [], 7));
  rows.push(rowXml(4, [
    stringCell('A4', 'م', 5),
    stringCell('B4', 'اسم المعلم', 5),
    stringCell('C4', 'التخصص', 5),
    stringCell('D4', 'الدور', 5),
    stringCell('E4', 'الصف', 5),
    stringCell('F4', 'المادة', 5),
    stringCell('G4', 'الشعبة', 5),
    stringCell('H4', 'الحصص', 5),
    stringCell('I4', 'نوع الإسناد', 5),
  ], 27));

  details.forEach((item, index) => {
    const rowNumber = 5 + index;
    rows.push(rowXml(rowNumber, [
      numberCell(cellReference('A', rowNumber), item.index, 7),
      stringCell(cellReference('B', rowNumber), item.teacher, 6),
      stringCell(cellReference('C', rowNumber), item.specialty, 7),
      stringCell(cellReference('D', rowNumber), item.role, 7),
      stringCell(cellReference('E', rowNumber), item.grade, 7),
      stringCell(cellReference('F', rowNumber), item.subject, 7),
      numberCell(cellReference('G', rowNumber), item.section, 8),
      numberCell(cellReference('H', rowNumber), item.periods, 8),
      stringCell(cellReference('I', rowNumber), item.preference, 7),
    ], 23));
  });

  const lastRow = 4 + details.length;
  return sheetXml({
    rows,
    dimension: `A1:I${lastRow}`,
    columns: [
      { index: 1, width: 5 },
      { index: 2, width: 22 },
      { index: 3, width: 14 },
      { index: 4, width: 12 },
      { index: 5, width: 12 },
      { index: 6, width: 18 },
      { index: 7, width: 9 },
      { index: 8, width: 10 },
      { index: 9, width: 18 },
    ],
    merges,
    freezeRow: 4,
    autoFilter: `A4:I${lastRow}`,
  });
}

function buildCoverageSheet(scenario, data) {
  const rows = [];
  const coverage = coverageExportRows(scenario, data);
  const merges = ['A1:H1', 'A2:H2'];
  rows.push(rowXml(1, [stringCell('A1', 'ملخص تغطية المقررات', 1)], 28));
  rows.push(rowXml(2, [stringCell('A2', 'مقارنة الشعب والحصص المطلوبة بما تم إسناده في الخطة', 2)], 21));
  rows.push(rowXml(3, [], 7));
  rows.push(rowXml(4, [
    stringCell('A4', 'م', 5),
    stringCell('B4', 'المادة', 5),
    stringCell('C4', 'الصف', 5),
    stringCell('D4', 'الشعب المطلوبة', 5),
    stringCell('E4', 'الشعب المسندة', 5),
    stringCell('F4', 'الحصص المطلوبة', 5),
    stringCell('G4', 'الحصص المسندة', 5),
    stringCell('H4', 'الحالة', 5),
  ], 27));

  coverage.forEach((item, index) => {
    const rowNumber = 5 + index;
    rows.push(rowXml(rowNumber, [
      numberCell(cellReference('A', rowNumber), item.index, 7),
      stringCell(cellReference('B', rowNumber), item.subject, 6),
      stringCell(cellReference('C', rowNumber), item.grade, 7),
      numberCell(cellReference('D', rowNumber), item.requiredSections, 8),
      numberCell(cellReference('E', rowNumber), item.assignedSections, 8),
      numberCell(cellReference('F', rowNumber), item.requiredPeriods, 8),
      numberCell(cellReference('G', rowNumber), item.assignedPeriods, 8),
      stringCell(cellReference('H', rowNumber), item.status, item.status === 'مكتمل' ? 9 : 10),
    ], 23));
  });

  const totalRow = 5 + coverage.length;
  rows.push(rowXml(totalRow, [
    stringCell(cellReference('A', totalRow), 'الإجمالي', 13),
    stringCell(cellReference('B', totalRow), '', 13),
    stringCell(cellReference('C', totalRow), '', 13),
    numberCell(cellReference('D', totalRow), coverage.reduce((sum, item) => sum + item.requiredSections, 0), 12),
    numberCell(cellReference('E', totalRow), coverage.reduce((sum, item) => sum + item.assignedSections, 0), 12),
    numberCell(cellReference('F', totalRow), coverage.reduce((sum, item) => sum + item.requiredPeriods, 0), 12),
    numberCell(cellReference('G', totalRow), coverage.reduce((sum, item) => sum + item.assignedPeriods, 0), 12),
    stringCell(cellReference('H', totalRow), scenario.unassigned?.length ? 'يحتاج مراجعة' : 'مكتمل', scenario.unassigned?.length ? 10 : 9),
  ], 25));
  merges.push(`A${totalRow}:C${totalRow}`);

  return sheetXml({
    rows,
    dimension: `A1:H${totalRow}`,
    columns: [
      { index: 1, width: 5 },
      { index: 2, width: 22 },
      { index: 3, width: 14 },
      { index: 4, width: 16 },
      { index: 5, width: 16 },
      { index: 6, width: 17 },
      { index: 7, width: 17 },
      { index: 8, width: 16 },
    ],
    merges,
    freezeRow: 4,
    autoFilter: `A4:H${4 + coverage.length}`,
  });
}

export function buildScenarioExcelFiles(scenario, data, options = {}) {
  const preparedAt = safeDate(options.preparedAt || options.approvedAt || new Date());
  const sheetNames = ['توزيع الأنصبة', 'تفصيل التكليفات', 'ملخص المواد'];
  const mainSheet = buildMainSheet(scenario, data, { ...options, preparedAt });
  const detailSheet = buildDetailSheet(scenario, data);
  const coverageSheet = buildCoverageSheet(scenario, data);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0" firstSheet="0"/></bookViews>
  <sheets>
    ${sheetNames.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const appProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>قِسطاس</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>3</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="3" baseType="lpstr">${sheetNames.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>`;

  const isoDate = preparedAt.toISOString();
  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>خطة توزيع الأنصبة التدريسية</dc:title>
  <dc:subject>${escapeXml(data.departmentName || 'توزيع الأنصبة')}</dc:subject>
  <dc:creator>قِسطاس</dc:creator>
  <cp:lastModifiedBy>قِسطاس</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified>
</cp:coreProperties>`;

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'docProps/app.xml': appProps,
    'docProps/core.xml': coreProps,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/styles.xml': stylesXml(),
    'xl/worksheets/sheet1.xml': mainSheet,
    'xl/worksheets/sheet2.xml': detailSheet,
    'xl/worksheets/sheet3.xml': coverageSheet,
  };
}

let jsZipPromise;

function loadJsZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  if (jsZipPromise) return jsZipPromise;
  if (!globalThis.document?.head) {
    return Promise.reject(new Error('JSZip is unavailable outside the browser.'));
  }

  jsZipPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSZIP_PATH;
    script.async = true;
    script.onload = () => {
      if (globalThis.JSZip) resolve(globalThis.JSZip);
      else reject(new Error('تعذر تهيئة مكتبة Excel.'));
    };
    script.onerror = () => reject(new Error('تعذر تحميل مكوّن تصدير Excel.'));
    document.head.appendChild(script);
  });
  return jsZipPromise;
}

export async function buildScenarioExcelBlob(scenario, data, options = {}, JSZipClass = null) {
  const Zip = JSZipClass || await loadJsZip();
  const zip = new Zip();
  const files = buildScenarioExcelFiles(scenario, data, options);
  Object.entries(files).forEach(([path, content]) => zip.file(path, content));
  return zip.generateAsync({
    type: 'blob',
    mimeType: MIME_XLSX,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function exportScenarioExcel(scenario, data, options = {}) {
  const blob = await buildScenarioExcelBlob(scenario, data, options);
  if (!globalThis.document?.body) return blob;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const status = reportStatus(options);
  const department = String(data.departmentName || 'القسم').replace(/[\\/:*?"<>|]+/g, '-');
  link.href = url;
  link.download = `قسطاس-${department}-${status}.xlsx`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return blob;
}
