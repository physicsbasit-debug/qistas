import { compareGrades } from '../domain/grades.js';

function escapeHtml(value = '') {
  return String(value).replace(
    /[&<>'"]/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[character]),
  );
}

function formatDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-OM', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function numericSections(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

export function formatSectionRanges(values) {
  const sections = numericSections(values);
  if (!sections.length) return '—';

  const ranges = [];
  let start = sections[0];
  let previous = sections[0];

  const pushRange = () => {
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  };

  for (let index = 1; index < sections.length; index += 1) {
    const current = sections[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    pushRange();
    start = current;
    previous = current;
  }
  pushRange();
  return ranges.join('، ');
}

export function groupTeacherAssignments(assignments = []) {
  const groups = new Map();

  assignments.forEach((assignment) => {
    const key = `${assignment.subject}\u0000${assignment.grade}`;
    const group = groups.get(key) || {
      subject: assignment.subject,
      grade: assignment.grade,
      sections: [],
      periods: 0,
    };
    group.sections.push(assignment.section);
    group.periods += Number(assignment.periods) || 0;
    groups.set(key, group);
  });

  return [...groups.values()].sort((a, b) => (
    compareGrades(a.grade, b.grade)
    || String(a.subject).localeCompare(String(b.subject), 'ar')
  ));
}

function reportStatus(options = {}) {
  if (options.status) return options.status;
  if (options.approved) return 'معتمدة';
  if (options.isDraft) return 'مسودة';
  return 'مقترح';
}

function statusClass(status) {
  if (status === 'معتمدة') return 'approved';
  if (status === 'مسودة') return 'draft';
  return 'proposal';
}

function activeTeachers(data) {
  return (data.teachers || []).filter((teacher) => teacher.active !== false);
}

function leadTeacher(data) {
  return activeTeachers(data).find((teacher) => teacher.isLead) || null;
}

function teacherRows(scenario, data) {
  const teachers = activeTeachers(data);
  const summaries = new Map((scenario.summaries || []).map((summary) => [summary.teacherId, summary]));

  return teachers.map((teacher, index) => {
    const summary = summaries.get(teacher.id) || { assignments: [], load: 0, maxLoad: 0 };
    const groups = groupTeacherAssignments(summary.assignments);
    const assignmentHtml = groups.length
      ? groups.map((group) => `
          <div class="assignment-line">
            <strong>${escapeHtml(group.subject)} - ${escapeHtml(group.grade)}:</strong>
            <span>الشعب ${escapeHtml(formatSectionRanges(group.sections))}</span>
            <em>${group.periods} حصة</em>
          </div>`).join('')
      : '<span class="empty">لا توجد شعب مسندة</span>';
    const role = teacher.isLead ? 'معلم أول' : 'معلم';
    const note = teacher.isLead ? 'نصاب معلم أول' : (summary.load === 0 ? 'دون إسناد' : '—');

    return `
      <tr>
        <td class="index-cell">${index + 1}</td>
        <td class="teacher-name"><strong>${escapeHtml(teacher.name)}</strong></td>
        <td>${escapeHtml(teacher.specialty)}</td>
        <td><span class="role-badge ${teacher.isLead ? 'lead' : ''}">${role}</span></td>
        <td class="assignments-cell">${assignmentHtml}</td>
        <td class="load-cell"><strong>${summary.load}</strong><span>من ${summary.maxLoad}</span></td>
        <td class="notes-cell">${escapeHtml(note)}</td>
      </tr>`;
  }).join('');
}

function coverageCards(scenario, data) {
  const assignments = scenario.assignments || [];
  return (data.requirements || []).map((requirement) => {
    const matching = assignments.filter((assignment) => (
      assignment.grade === requirement.grade && assignment.subject === requirement.subject
    ));
    const assignedSections = matching.length;
    const requiredSections = Number(requirement.sections) || 0;
    const assignedPeriods = matching.reduce((sum, assignment) => sum + (Number(assignment.periods) || 0), 0);
    const requiredPeriods = requiredSections * (Number(requirement.periodsPerSection) || 0);
    const complete = assignedSections === requiredSections && assignedPeriods === requiredPeriods;
    return `
      <article class="coverage-card ${complete ? 'complete' : 'incomplete'}">
        <div class="coverage-card-title">
          <strong>${escapeHtml(requirement.subject)}</strong>
          <span>${escapeHtml(requirement.grade)}</span>
        </div>
        <div class="coverage-card-values">
          <span><b>${assignedSections}/${requiredSections}</b> شعبة</span>
          <span><b>${assignedPeriods}/${requiredPeriods}</b> حصة</span>
        </div>
      </article>`;
  }).join('');
}

export function buildScenarioReportHtml(scenario, data, options = {}) {
  const status = reportStatus(options);
  const lead = leadTeacher(data);
  const assignedPeriods = (scenario.assignments || []).reduce(
    (sum, assignment) => sum + (Number(assignment.periods) || 0),
    0,
  );
  const preparedAt = options.preparedAt || options.approvedAt || new Date();
  const academicYear = data.academicYear || 'غير محددة';
  const planLabel = options.planLabel || scenario.label || 'خطة توزيع الأنصبة';
  const reportId = `QST-${new Date(preparedAt).toISOString().slice(0, 10).replaceAll('-', '')}`;
  const teacherCount = activeTeachers(data).length;
  const assignmentGroupCount = (scenario.summaries || []).reduce(
    (sum, summary) => sum + groupTeacherAssignments(summary.assignments || []).length,
    0,
  );
  const requirementCount = (data.requirements || []).length;
  const reportSubjectCount = new Set((data.requirements || []).map((requirement) => requirement.subject)).size;
  const reportScopeClass = reportSubjectCount === 1 ? 'report-single-subject' : 'report-multi-subject';
  const reportDensity = teacherCount <= 7 && assignmentGroupCount <= 13 && requirementCount <= 6
    ? 'spacious'
    : (teacherCount <= 10 && assignmentGroupCount <= 24 && requirementCount <= 10 ? 'standard' : 'compact');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير قِسطاس - ${escapeHtml(data.departmentName || '')}</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #17252d; }
    body {
      direction: rtl;
      writing-mode: horizontal-tb;
      font-family: Tahoma, Arial, sans-serif;
      font-size: 8.7pt;
      line-height: 1.28;
    }
    .report { width: 100%; }
    .report-header {
      position: relative;
      overflow: hidden;
      border: 1px solid #d8e5e2;
      border-top: 4px solid #0f766e;
      border-radius: 13px;
      padding: 6px 10px 7px;
      background: linear-gradient(135deg, #ffffff 0%, #f2faf8 100%);
    }
    .header-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .brand { display: flex; align-items: center; gap: 8px; }
    .brand-mark {
      width: 31px; height: 31px; border-radius: 11px; display: grid; place-items: center;
      background: #0f766e; color: #fff; font-size: 17px; font-weight: 800;
    }
    .brand strong { display: block; font-size: 13.5px; color: #0a5c56; }
    .brand span { display: block; color: #61706e; font-size: 7.4pt; }
    .status-box { text-align: left; }
    .status-box span { display: block; color: #6b7775; font-size: 7pt; }
    .status-pill { display: inline-block; margin-top: 2px; padding: 3px 9px; border-radius: 999px; font-weight: 800; font-size: 7.5pt; }
    .status-pill.approved { color: #116149; background: #e6f7ef; border: 1px solid #b9e3d2; }
    .status-pill.draft { color: #8a5a00; background: #fff6dc; border: 1px solid #eed89b; }
    .status-pill.proposal { color: #355f76; background: #edf6fb; border: 1px solid #c9dfeb; }
    .report-title { margin: 3px 0 0; font-size: 16px; line-height: 1.15; color: #17252d; }
    .report-subtitle { margin: 1px 0 0; color: #65726f; font-size: 7.6pt; }
    .meta-grid { display: grid; grid-template-columns: 1.45fr 1fr .76fr 1fr 1fr; gap: 4px; margin-top: 5px; }
    .meta-item { border: 1px solid #e0e9e7; border-radius: 7px; background: rgba(255,255,255,.88); padding: 3px 6px; min-width: 0; }
    .meta-item span { display: block; color: #73807e; font-size: 6.6pt; }
    .meta-item strong { display: block; margin-top: 1px; color: #263c39; font-size: 7.8pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 4px;
      margin: 4px 0;
      border: 1px solid #dfe8e6;
      border-radius: 9px;
      overflow: hidden;
      background: #f8fbfa;
    }
    .metric { padding: 3px 7px; border-left: 1px solid #e2ebe9; }
    .metric:last-child { border-left: 0; }
    .metric span { display: inline; color: #6c7977; font-size: 6.8pt; }
    .metric strong { display: inline; margin-right: 5px; color: #132c29; font-size: 10.5px; }
    .section-title { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 3px; }
    .section-title h2 { margin: 0; color: #153c37; font-size: 10.8pt; }
    .section-title span { color: #71807d; font-size: 6.8pt; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .teacher-table { table-layout: fixed; border: 1px solid #d7e4e1; border-radius: 9px; overflow: hidden; font-size: 7.05pt; }
    .teacher-table th { padding: 3.5px 4px; color: #fff; background: #0f766e; border-left: 1px solid rgba(255,255,255,.18); font-weight: 800; }
    .teacher-table td { padding: 3.2px 4px; vertical-align: top; border-bottom: 1px solid #e3ebe9; border-left: 1px solid #edf2f1; }
    .teacher-table tbody tr:nth-child(even) td { background: #f8fbfa; }
    .teacher-table tbody tr:last-child td { border-bottom: 0; }
    .teacher-table th:last-child, .teacher-table td:last-child { border-left: 0; }
    .index-cell { width: 3.5%; text-align: center; font-weight: 800; }
    .teacher-name { width: 17.5%; }
    .teacher-name strong { display: block; white-space: normal; line-height: 1.25; }
    .teacher-table th:nth-child(3) { width: 8.5%; }
    .teacher-table th:nth-child(4) { width: 7.5%; }
    .teacher-table th:nth-child(5) { width: 46%; }
    .teacher-table th:nth-child(6) { width: 7.5%; }
    .teacher-table th:nth-child(7) { width: 9.5%; }
    .role-badge { display: inline-block; border-radius: 999px; padding: 1px 5px; background: #edf3f2; color: #405c58; font-size: 6.5pt; font-weight: 700; white-space: nowrap; }
    .role-badge.lead { background: #e8f6f2; color: #0f6b5e; }
    .assignment-line {
      display: grid;
      grid-template-columns: minmax(102px, 1.08fr) 1fr auto;
      align-items: baseline;
      gap: 4px;
      padding: 0;
      border-bottom: 1px dotted #dbe4e2;
    }
    .assignment-line:last-child { border-bottom: 0; }
    .assignment-line strong { color: #203e3a; font-size: 6.95pt; }
    .assignment-line span { color: #516360; }
    .assignment-line em { color: #0f766e; font-style: normal; font-weight: 800; white-space: nowrap; }
    .load-cell { text-align: center; white-space: nowrap; }
    .load-cell strong { display: inline; font-size: 10px; color: #0f766e; }
    .load-cell span { display: inline; margin-right: 3px; color: #74817f; font-size: 6.2pt; }
    .notes-cell { color: #63706e; }
    .empty { color: #8b9694; }
    .coverage-section { margin-top: 4px; break-inside: avoid; page-break-inside: avoid; }
    .coverage-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(31mm, 1fr));
      gap: 3px;
    }
    .coverage-card {
      min-width: 0;
      border: 1px solid #d9e5e2;
      border-radius: 7px;
      background: #fbfdfc;
      padding: 3px 5px;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 4px;
    }
    .coverage-card.complete { border-right: 3px solid #49a58f; }
    .coverage-card.incomplete { border-right: 3px solid #d99048; background: #fffaf3; }
    .coverage-card-title { min-width: 0; }
    .coverage-card-title strong { display: block; color: #244f49; font-size: 6.9pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .coverage-card-title span { display: block; color: #788582; font-size: 6.2pt; }
    .coverage-card-values { text-align: left; white-space: nowrap; color: #64716f; font-size: 6.2pt; }
    .coverage-card-values span { display: block; }
    .coverage-card-values b { color: #0f766e; font-size: 6.7pt; }
    .unassigned-note { margin-top: 4px; border: 1px solid #efc5bf; background: #fff4f2; color: #8a2b22; border-radius: 7px; padding: 4px 7px; font-size: 7pt; }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 13px;
      margin-top: 5px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .signature { min-height: 25px; border-top: 1px solid #9fb1ae; padding-top: 3px; color: #667472; font-size: 7pt; }
    .signature strong { display: inline-block; color: #284743; margin-left: 8px; }
    .report-footer { margin-top: 4px; padding-top: 3px; border-top: 1px solid #dfe8e6; display: flex; justify-content: space-between; color: #7a8785; font-size: 6.2pt; }

    /* v1.3.4: report density adapts to plan size, with wider teacher names and a leaner assignments column. */
    .report {
      min-height: 197mm;
      display: flex;
      flex-direction: column;
    }
    .signatures { margin-top: auto; }

    .report-spacious .report-header { padding: 10px 14px 11px; border-radius: 15px; }
    .report-spacious .header-row { gap: 18px; }
    .report-spacious .brand { gap: 10px; }
    .report-spacious .brand-mark { width: 39px; height: 39px; border-radius: 13px; font-size: 21px; }
    .report-spacious .brand strong { font-size: 16px; }
    .report-spacious .brand span { font-size: 8.2pt; }
    .report-spacious .status-box span { font-size: 7.6pt; }
    .report-spacious .status-pill { padding: 4px 11px; font-size: 8.2pt; }
    .report-spacious .report-title { margin-top: 6px; font-size: 21px; line-height: 1.2; }
    .report-spacious .report-subtitle { margin-top: 3px; font-size: 8.6pt; }
    .report-spacious .meta-grid { gap: 7px; margin-top: 9px; }
    .report-spacious .meta-item { padding: 6px 8px; border-radius: 9px; }
    .report-spacious .meta-item span { font-size: 7.2pt; }
    .report-spacious .meta-item strong { margin-top: 2px; font-size: 8.9pt; }
    .report-spacious .metrics { gap: 0; margin: 8px 0; border-radius: 11px; }
    .report-spacious .metric { padding: 7px 10px; }
    .report-spacious .metric span { font-size: 7.5pt; }
    .report-spacious .metric strong { margin-right: 7px; font-size: 14px; }
    .report-spacious .section-title { margin: 8px 0 5px; }
    .report-spacious .section-title h2 { font-size: 13pt; }
    .report-spacious .section-title span { font-size: 7.5pt; }
    .report-spacious .teacher-table { font-size: 8.25pt; border-radius: 11px; }
    .report-spacious .teacher-table th { padding: 6px 6px; }
    .report-spacious .teacher-table td { padding: 6px 6px; }
    .report-spacious .teacher-name { width: 18%; }
    .report-spacious .teacher-table th:nth-child(3) { width: 9%; }
    .report-spacious .teacher-table th:nth-child(4) { width: 7%; }
    .report-spacious .teacher-table th:nth-child(5) { width: 47.5%; }
    .report-spacious .teacher-table th:nth-child(6) { width: 7%; }
    .report-spacious .teacher-table th:nth-child(7) { width: 8%; }
    .report-spacious .role-badge { padding: 2px 7px; font-size: 7.1pt; }
    .report-spacious .assignment-line { gap: 7px; padding: 1.5px 0; }
    .report-spacious .assignment-line strong { font-size: 8.05pt; }
    .report-spacious .assignment-line span { font-size: 7.8pt; }
    .report-spacious .assignment-line em { font-size: 7.6pt; }
    .report-spacious .load-cell strong { font-size: 12.5px; }
    .report-spacious .load-cell span { font-size: 7pt; }
    .report-spacious .coverage-section { margin-top: 8px; }
    .report-spacious .coverage-grid { gap: 6px; }
    .report-spacious .coverage-card { padding: 6px 8px; border-radius: 9px; }
    .report-spacious .coverage-card-title strong { font-size: 7.8pt; }
    .report-spacious .coverage-card-title span { font-size: 7pt; }
    .report-spacious .coverage-card-values { font-size: 7pt; }
    .report-spacious .coverage-card-values b { font-size: 7.8pt; }
    .report-spacious .signatures { gap: 20px; padding-top: 13px; }
    .report-spacious .signature { min-height: 40px; padding-top: 6px; font-size: 8.1pt; }
    .report-spacious .report-footer { margin-top: 8px; padding-top: 5px; font-size: 7pt; }

    /* Single-subject plans repeat the same specialty, so teacher names deserve more room. */
    .report-spacious.report-single-subject .teacher-name { width: 20%; }
    .report-spacious.report-single-subject .teacher-table th:nth-child(5) { width: 45.5%; }

    .report-standard .report-header { padding: 8px 12px 9px; }
    .report-standard .brand-mark { width: 35px; height: 35px; font-size: 19px; }
    .report-standard .brand strong { font-size: 15px; }
    .report-standard .report-title { font-size: 18px; }
    .report-standard .report-subtitle { font-size: 8.1pt; }
    .report-standard .meta-grid { gap: 6px; margin-top: 7px; }
    .report-standard .meta-item { padding: 5px 7px; }
    .report-standard .meta-item span { font-size: 7pt; }
    .report-standard .meta-item strong { font-size: 8.4pt; }
    .report-standard .metrics { margin: 6px 0; }
    .report-standard .metric { padding: 5px 8px; }
    .report-standard .metric span { font-size: 7.2pt; }
    .report-standard .metric strong { font-size: 12px; }
    .report-standard .section-title { margin: 6px 0 4px; }
    .report-standard .section-title h2 { font-size: 11.8pt; }
    .report-standard .teacher-table { font-size: 7.65pt; }
    .report-standard .teacher-table th { padding: 5px; }
    .report-standard .teacher-table td { padding: 4.8px 5px; }
    .report-standard .assignment-line { padding: 1px 0; }
    .report-standard .assignment-line strong { font-size: 7.5pt; }
    .report-standard .coverage-card { padding: 5px 7px; }
    .report-standard .signatures { padding-top: 9px; }
    .report-standard .signature { min-height: 34px; font-size: 7.6pt; }
    .report-standard .report-footer { font-size: 6.7pt; }
    .report-standard.report-single-subject .teacher-name,
    .report-compact.report-single-subject .teacher-name { width: 19%; }
    .report-standard.report-single-subject .teacher-table th:nth-child(5),
    .report-compact.report-single-subject .teacher-table th:nth-child(5) { width: 44.5%; }

    .report-compact { min-height: 0; }
    .report-compact .signatures { margin-top: 5px; }

    @media print {
      html, body { width: auto; min-height: 0; }
      body { margin: 0; }
      .report { width: 100%; }
    }
    @media screen {
      body { background: #eef4f2; padding: 18px; }
      .report { max-width: 1120px; margin: 0 auto; background: #fff; padding: 12px; box-shadow: 0 16px 45px rgba(23,37,45,.12); }
    }
  </style>
</head>
<body>
  <main class="report report-${reportDensity} ${reportScopeClass}">
    <header class="report-header">
      <div class="header-row">
        <div class="brand">
          <div class="brand-mark">ق</div>
          <div><strong>قِسطاس</strong><span>أنصبة موزونة، توزيع أذكى</span></div>
        </div>
        <div class="status-box"><span>حالة الخطة</span><b class="status-pill ${statusClass(status)}">${escapeHtml(status)}</b></div>
      </div>
      <h1 class="report-title">خطة توزيع الأنصبة التدريسية</h1>
      <p class="report-subtitle">تقرير منظم لتوزيع المقررات والشعب على المعلمين وفق الخطة المحددة في التطبيق.</p>
      <div class="meta-grid">
        <div class="meta-item"><span>المدرسة</span><strong>${escapeHtml(data.schoolName || 'غير محددة')}</strong></div>
        <div class="meta-item"><span>القسم</span><strong>${escapeHtml(data.departmentName || 'غير محدد')}</strong></div>
        <div class="meta-item"><span>السنة الدراسية</span><strong>${escapeHtml(academicYear)}</strong></div>
        <div class="meta-item"><span>المعلم الأول</span><strong>${escapeHtml(lead?.name || 'غير محدد')}</strong></div>
        <div class="meta-item"><span>تاريخ التقرير</span><strong>${escapeHtml(formatDate(preparedAt))}</strong></div>
      </div>
    </header>

    <section class="metrics">
      <div class="metric"><span>المعلمون</span><strong>${activeTeachers(data).length}</strong></div>
      <div class="metric"><span>الحصص المسندة</span><strong>${assignedPeriods}</strong></div>
      <div class="metric"><span>أعلى نصاب</span><strong>${scenario.highestLoad ?? 0}</strong></div>
      <div class="metric"><span>أقل نصاب</span><strong>${scenario.lowestLoad ?? 0}</strong></div>
      <div class="metric"><span>فرق الأنصبة</span><strong>${scenario.loadSpread ?? 0}</strong></div>
      <div class="metric"><span>غير المسندة</span><strong>${scenario.unassigned?.length ?? 0}</strong></div>
    </section>

    <section>
      <div class="section-title"><h2>التوزيع المعتمد للمعلمين</h2><span>${escapeHtml(planLabel)}</span></div>
      <table class="teacher-table">
        <thead><tr><th>م</th><th>اسم المعلم</th><th>التخصص</th><th>الدور</th><th>الشعب والمقررات المسندة</th><th>النصاب</th><th>ملاحظات</th></tr></thead>
        <tbody>${teacherRows(scenario, data)}</tbody>
      </table>
      ${scenario.unassigned?.length ? `<div class="unassigned-note">تنبيه: توجد ${scenario.unassigned.length} شعبة غير مسندة، ولذلك تحتاج الخطة إلى مراجعة قبل الاعتماد النهائي.</div>` : ''}
    </section>

    <section class="coverage-section">
      <div class="section-title"><h2>ملخص تغطية المقررات</h2><span>مطابقة الشعب والحصص المطلوبة مع المسندة</span></div>
      <div class="coverage-grid">${coverageCards(scenario, data)}</div>
    </section>

    <section class="signatures">
      <div class="signature"><strong>إعداد المعلم الأول</strong>الاسم والتوقيع: ______________________________</div>
      <div class="signature"><strong>اعتماد إدارة المدرسة</strong>الاسم والتوقيع: ______________________________</div>
    </section>

    <footer class="report-footer"><span>قِسطاس | أنصبة موزونة، توزيع أذكى</span><span>${escapeHtml(reportId)}</span></footer>
  </main>
</body>
</html>`;
}

export function printScenarioReport(scenario, data, options = {}) {
  const html = buildScenarioReportHtml(scenario, data, options);
  if (!globalThis.document?.body || typeof document.createElement !== 'function') return html;

  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'تقرير قِسطاس للطباعة');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    border: '0',
    left: '-10000px',
    top: '0',
  });

  const cleanup = () => {
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  };

  frame.onload = async () => {
    const reportWindow = frame.contentWindow;
    if (!reportWindow) {
      cleanup();
      return;
    }
    reportWindow.addEventListener?.('afterprint', cleanup, { once: true });
    try {
      await frame.contentDocument?.fonts?.ready;
    } catch {
      // بعض المتصفحات لا توفر FontFaceSet داخل iframe؛ الطباعة تظل صالحة.
    }
    setTimeout(() => {
      reportWindow.focus();
      reportWindow.print();
      setTimeout(cleanup, 3000);
    }, 220);
  };

  frame.srcdoc = html;
  document.body.appendChild(frame);
  return html;
}
