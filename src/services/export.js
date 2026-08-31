import { compareGrades } from '../domain/grades.js';
import { teacherMaxLoad } from '../engine/distribution.js';

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

export function formatSectionList(values) {
  const sections = numericSections(values);
  return sections.length ? sections.map(String).join('، ') : '—';
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

function assignmentsByTeacher(scenario, data) {
  const buckets = new Map(activeTeachers(data).map((teacher) => [teacher.id, []]));
  (scenario.assignments || []).forEach((assignment) => {
    if (buckets.has(assignment.teacherId)) buckets.get(assignment.teacherId).push(assignment);
  });
  return buckets;
}

function teacherRows(scenario, data) {
  const teachers = activeTeachers(data);
  const buckets = assignmentsByTeacher(scenario, data);

  return teachers.map((teacher) => {
    const assignments = buckets.get(teacher.id) || [];
    const groups = groupTeacherAssignments(assignments);
    const load = assignments.reduce((sum, assignment) => sum + (Number(assignment.periods) || 0), 0);
    const maxLoad = teacherMaxLoad(teacher, data.settings);
    const note = teacher.isLead ? 'نصاب معلم أول' : '';
    const assignmentHtml = groups.length
      ? groups.map((group) => `
          <div class="assignment-row">
            <strong>${escapeHtml(group.subject)} · ${escapeHtml(group.grade)}</strong>
            <span>الشعب: ${escapeHtml(formatSectionList(group.sections))}</span>
            <em>${group.periods} حصة</em>
          </div>`).join('')
      : '<span class="empty">لا توجد شعب مسندة</span>';

    return `
      <tr>
        <td class="teacher-cell">
          <div class="teacher-meta">
            <strong class="teacher-display">${escapeHtml(teacher.name)}</strong>
            <span class="teacher-subline">${escapeHtml(teacher.specialty)}${teacher.isLead ? ' · معلم أول' : ''}</span>
            ${note ? `<span class="teacher-note">${escapeHtml(note)}</span>` : ''}
          </div>
        </td>
        <td class="assignments-cell">${assignmentHtml}</td>
        <td class="load-cell">
          <div class="load-badge">
            <strong>${load}</strong>
            <span>من ${maxLoad}</span>
          </div>
        </td>
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
  const preparedAt = options.preparedAt || options.approvedAt || new Date();
  const academicYear = data.academicYear || 'غير محددة';
  const planLabel = options.planLabel || scenario.label || 'خطة توزيع الأنصبة';
  const assignedPeriods = (scenario.assignments || []).reduce(
    (sum, assignment) => sum + (Number(assignment.periods) || 0),
    0,
  );
  const teacherCount = activeTeachers(data).length;
  const assignedSectionsCount = (scenario.assignments || []).length;
  const unassignedCount = (scenario.unassigned || []).length;
  const requirementCount = (data.requirements || []).length;
  const reportId = `QST-${new Date(preparedAt).toISOString().slice(0, 10).replaceAll('-', '')}`;
  const subjectCount = new Set((data.requirements || []).map((requirement) => requirement.subject)).size;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير قِسطاس - ${escapeHtml(data.departmentName || '')}</title>
  <style>
    @page { size: A4 portrait; margin: 7mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #17252d; }
    body {
      direction: rtl;
      writing-mode: horizontal-tb;
      font-family: Tahoma, Arial, sans-serif;
      font-size: 9.15pt;
      line-height: 1.24;
    }
    .report { width: 100%; }
    .report-header {
      border: 1px solid #d8e5e2;
      border-top: 4px solid #0f766e;
      border-radius: 14px;
      padding: 9px 11px 10px;
      background: linear-gradient(135deg, #ffffff 0%, #f2faf8 100%);
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .brand { display: flex; align-items: center; gap: 8px; }
    .brand-mark {
      width: 34px;
      height: 34px;
      border-radius: 11px;
      display: grid;
      place-items: center;
      background: #0f766e;
      color: #fff;
      font-size: 18px;
      font-weight: 800;
    }
    .brand strong { display: block; color: #0a5c56; font-size: 14px; }
    .brand span { display: block; color: #61706e; font-size: 7.9pt; }
    .status-box { text-align: left; }
    .status-box span { display: block; color: #6b7775; font-size: 7.6pt; }
    .status-pill {
      display: inline-block;
      margin-top: 3px;
      padding: 4px 10px;
      border-radius: 999px;
      font-weight: 800;
      font-size: 8pt;
    }
    .status-pill.approved { color: #116149; background: #e6f7ef; border: 1px solid #b9e3d2; }
    .status-pill.draft { color: #8a5a00; background: #fff6dc; border: 1px solid #eed89b; }
    .status-pill.proposal { color: #355f76; background: #edf6fb; border: 1px solid #c9dfeb; }
    .report-title { margin: 7px 0 0; font-size: 16.5px; line-height: 1.15; }
    .report-subtitle { margin: 2px 0 0; color: #65726f; font-size: 8.2pt; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 5px;
      margin-top: 7px;
    }
    .meta-item {
      border: 1px solid #e0e9e7;
      border-radius: 8px;
      background: rgba(255,255,255,.88);
      padding: 5px 6px;
      min-width: 0;
    }
    .meta-item span { display: block; color: #73807e; font-size: 7.1pt; }
    .meta-item strong { display: block; margin-top: 1px; color: #263c39; font-size: 8.2pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 5px;
      margin: 7px 0 8px;
    }
    .metric {
      border: 1px solid #dfe8e6;
      border-radius: 9px;
      background: #f8fbfa;
      padding: 5px 7px;
      text-align: center;
    }
    .metric span { display: block; color: #6c7977; font-size: 7.2pt; }
    .metric strong { display: block; margin-top: 2px; color: #132c29; font-size: 12px; }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 6px 0 4px;
    }
    .section-title h2 { margin: 0; color: #153c37; font-size: 11.3pt; }
    .section-title span { color: #71807d; font-size: 7.2pt; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .teacher-table {
      table-layout: fixed;
      border: 1px solid #d7e4e1;
      border-radius: 10px;
      overflow: hidden;
      font-size: 8.85pt;
    }
    .teacher-table th {
      padding: 6px 6px;
      color: #fff;
      background: #0f766e;
      border-left: 1px solid rgba(255,255,255,.18);
      font-weight: 800;
      text-align: right;
    }
    .teacher-table td {
      padding: 5px 6px;
      vertical-align: top;
      border-bottom: 1px solid #e3ebe9;
      border-left: 1px solid #edf2f1;
    }
    .teacher-table tbody tr:nth-child(even) td { background: #f8fbfa; }
    .teacher-table tbody tr:last-child td { border-bottom: 0; }
    .teacher-table th:last-child,
    .teacher-table td:last-child { border-left: 0; }
    .teacher-table th.col-teacher, .teacher-table td.teacher-cell { width: 28%; }
    .teacher-table th.col-assignments, .teacher-table td.assignments-cell { width: 57%; }
    .teacher-table th.col-load, .teacher-table td.load-cell { width: 15%; }
    .teacher-meta { display: grid; gap: 2px; }
    .teacher-display { display: block; font-size: 10.4pt; color: #153c37; }
    .teacher-subline { display: block; color: #62726f; font-size: 8.15pt; }
    .teacher-note { display: block; color: #0f766e; font-size: 7.7pt; font-weight: 700; }
    .assignment-row {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) auto;
      align-items: center;
      gap: 5px;
      padding: 1px 0;
      border-bottom: 1px dotted #dbe4e2;
    }
    .assignment-row:last-child { border-bottom: 0; }
    .assignment-row strong { color: #203e3a; font-size: 8.55pt; }
    .assignment-row span { color: #516360; font-size: 8.25pt; }
    .assignment-row em {
      color: #0f766e;
      font-style: normal;
      font-weight: 800;
      white-space: nowrap;
      font-size: 8.1pt;
    }
    .load-cell { text-align: center; vertical-align: middle; }
    .load-badge { display: grid; gap: 1px; }
    .load-badge strong { color: #0f766e; font-size: 12.4px; }
    .load-badge span { color: #74817f; font-size: 7.2pt; }
    .empty { color: #8b9694; font-size: 8.2pt; }
    .coverage-section { margin-top: 7px; }
    .coverage-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 5px;
    }
    .coverage-card {
      min-width: 0;
      border: 1px solid #d9e5e2;
      border-radius: 8px;
      background: #fbfdfc;
      padding: 5px 6px;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 6px;
    }
    .coverage-card.complete { border-right: 3px solid #49a58f; }
    .coverage-card.incomplete { border-right: 3px solid #d99048; background: #fffaf3; }
    .coverage-card-title strong { display: block; color: #244f49; font-size: 8.1pt; }
    .coverage-card-title span { display: block; color: #788582; font-size: 7.2pt; }
    .coverage-card-values { text-align: left; white-space: nowrap; color: #64716f; font-size: 7.2pt; }
    .coverage-card-values span { display: block; }
    .coverage-card-values b { color: #0f766e; font-size: 8pt; }
    .unassigned-note {
      margin-top: 6px;
      border: 1px solid #efc5bf;
      background: #fff4f2;
      color: #8a2b22;
      border-radius: 8px;
      padding: 5px 7px;
      font-size: 7.8pt;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 9px;
    }
    .signature {
      min-height: 34px;
      border-top: 1px solid #9fb1ae;
      padding-top: 5px;
      color: #667472;
      font-size: 8pt;
    }
    .signature strong { display: inline-block; color: #284743; margin-left: 8px; }
    .report-footer {
      margin-top: 7px;
      padding-top: 4px;
      border-top: 1px solid #dfe8e6;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #7a8785;
      font-size: 7.2pt;
    }
    @media screen {
      body { background: #eef4f2; padding: 18px; }
      .report { max-width: 794px; margin: 0 auto; background: #fff; padding: 12px; box-shadow: 0 16px 45px rgba(23,37,45,.12); }
    }
  </style>
</head>
<body>
  <main class="report">
    <header class="report-header">
      <div class="header-row">
        <div class="brand">
          <div class="brand-mark">ق</div>
          <div>
            <strong>منصة قِسطاس</strong>
            <span>تقرير توزيع الأنصبة التدريسية</span>
          </div>
        </div>
        <div class="status-box">
          <span>حالة الخطة</span>
          <div class="status-pill ${statusClass(status)}">${escapeHtml(status)}</div>
        </div>
      </div>
      <h1 class="report-title">${escapeHtml(planLabel)}</h1>
      <p class="report-subtitle">${escapeHtml(data.schoolName || 'المدرسة')} · ${escapeHtml(data.departmentName || data.planName || 'الخطة الحالية')}</p>
      <div class="meta-grid">
        <div class="meta-item"><span>العام الدراسي</span><strong>${escapeHtml(academicYear)}</strong></div>
        <div class="meta-item"><span>إعداد التقرير</span><strong>${escapeHtml(lead?.name || 'المعلم الأول')}</strong></div>
        <div class="meta-item"><span>تاريخ التقرير</span><strong>${escapeHtml(formatDate(preparedAt))}</strong></div>
        <div class="meta-item"><span>رقم التقرير</span><strong>${escapeHtml(reportId)}</strong></div>
      </div>
    </header>

    <section class="metrics">
      <article class="metric"><span>المعلمون النشطون</span><strong>${teacherCount}</strong></article>
      <article class="metric"><span>بنود التوزيع</span><strong>${requirementCount}</strong></article>
      <article class="metric"><span>المواد</span><strong>${subjectCount}</strong></article>
      <article class="metric"><span>الشعب المسندة</span><strong>${assignedSectionsCount}</strong></article>
      <article class="metric"><span>الحصص المسندة</span><strong>${assignedPeriods}</strong></article>
      <article class="metric"><span>غير المسند</span><strong>${unassignedCount}</strong></article>
    </section>

    <section>
      <div class="section-title">
        <h2>التوزيع المعتمد للمعلمين</h2>
        <span>عرض مختصر وواضح في صفحة عمودية واحدة</span>
      </div>
      <table class="teacher-table">
        <thead>
          <tr>
            <th class="col-teacher">المعلم</th>
            <th class="col-assignments">التوزيع المعتمد</th>
            <th class="col-load">النصاب</th>
          </tr>
        </thead>
        <tbody>
          ${teacherRows(scenario, data)}
        </tbody>
      </table>
    </section>

    <section class="coverage-section">
      <div class="section-title">
        <h2>ملخص تغطية المقررات</h2>
        <span>مطابقة عدد الشعب والحصص لكل صف ومادة</span>
      </div>
      <div class="coverage-grid">
        ${coverageCards(scenario, data)}
      </div>
      ${unassignedCount ? `<div class="unassigned-note"><strong>تنبيه:</strong> لا تزال هناك ${unassignedCount} شعبة غير مسندة في هذه الخطة.</div>` : ''}
    </section>

    <section class="signatures">
      <div class="signature"><strong>إعداد:</strong>${escapeHtml(lead?.name || 'المعلم الأول')}</div>
      <div class="signature"><strong>اعتماد:</strong>مدير المدرسة</div>
    </section>

    <footer class="report-footer">
      <span>أُنشئ بواسطة قِسطاس</span>
      <span>${escapeHtml(formatDate(preparedAt))}</span>
    </footer>
  </main>
</body>
</html>`;
}
