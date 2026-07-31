function escapeCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

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
    String(a.grade).localeCompare(String(b.grade), 'ar')
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

function coverageRows(scenario, data) {
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
      <tr>
        <td>${escapeHtml(requirement.subject)}</td>
        <td>${escapeHtml(requirement.grade)}</td>
        <td>${assignedSections} / ${requiredSections}</td>
        <td>${assignedPeriods} / ${requiredPeriods}</td>
        <td><span class="coverage-status ${complete ? 'complete' : 'incomplete'}">${complete ? 'مكتمل' : 'يحتاج مراجعة'}</span></td>
      </tr>`;
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

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير قِسطاس - ${escapeHtml(data.departmentName || '')}</title>
  <style>
    @page { size: A4 landscape; margin: 9mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #17252d; }
    body { direction: rtl; font-family: Tahoma, Arial, sans-serif; font-size: 9.5pt; line-height: 1.4; }
    .report { width: 100%; }
    .report-header {
      position: relative;
      overflow: hidden;
      border: 1px solid #d8e5e2;
      border-top: 5px solid #0f766e;
      border-radius: 16px;
      padding: 9px 13px 10px;
      background: linear-gradient(135deg, #ffffff 0%, #f2faf8 100%);
    }
    .header-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-mark {
      width: 36px; height: 36px; border-radius: 13px; display: grid; place-items: center;
      background: #0f766e; color: #fff; font-size: 19px; font-weight: 800;
    }
    .brand strong { display: block; font-size: 15px; color: #0a5c56; }
    .brand span { display: block; color: #61706e; font-size: 8.5pt; }
    .status-box { text-align: left; }
    .status-box span { display: block; color: #6b7775; font-size: 8pt; }
    .status-pill { display: inline-block; margin-top: 3px; padding: 4px 11px; border-radius: 999px; font-weight: 800; }
    .status-pill.approved { color: #116149; background: #e6f7ef; border: 1px solid #b9e3d2; }
    .status-pill.draft { color: #8a5a00; background: #fff6dc; border: 1px solid #eed89b; }
    .status-pill.proposal { color: #355f76; background: #edf6fb; border: 1px solid #c9dfeb; }
    .report-title { margin: 6px 0 1px; font-size: 18px; color: #17252d; }
    .report-subtitle { margin: 0; color: #65726f; font-size: 9pt; }
    .meta-grid { display: grid; grid-template-columns: 1.45fr 1fr .75fr 1fr 1fr; gap: 6px; margin-top: 8px; }
    .meta-item { border: 1px solid #e0e9e7; border-radius: 9px; background: rgba(255,255,255,.86); padding: 5px 8px; min-width: 0; }
    .meta-item span { display: block; color: #73807e; font-size: 7.5pt; }
    .meta-item strong { display: block; margin-top: 2px; color: #263c39; font-size: 9pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .metrics { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 6px 0; }
    .metric { border: 1px solid #dfe8e6; border-radius: 10px; background: #f8fbfa; padding: 5px 8px; }
    .metric span { display: block; color: #6c7977; font-size: 7.5pt; }
    .metric strong { display: block; margin-top: 1px; color: #132c29; font-size: 12px; }
    .section-title { display: flex; align-items: center; justify-content: space-between; margin: 7px 0 4px; }
    .section-title h2 { margin: 0; color: #153c37; font-size: 12.5pt; }
    .section-title span { color: #71807d; font-size: 8pt; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .teacher-table { table-layout: fixed; border: 1px solid #d7e4e1; border-radius: 11px; overflow: hidden; font-size: 7.8pt; }
    .teacher-table th { padding: 5px 5px; color: #fff; background: #0f766e; border-left: 1px solid rgba(255,255,255,.18); font-weight: 800; }
    .teacher-table td { padding: 5px 5px; vertical-align: top; border-bottom: 1px solid #e3ebe9; border-left: 1px solid #edf2f1; }
    .teacher-table tbody tr:nth-child(even) td { background: #f8fbfa; }
    .teacher-table tbody tr:last-child td { border-bottom: 0; }
    .teacher-table th:last-child, .teacher-table td:last-child { border-left: 0; }
    .index-cell { width: 4%; text-align: center; font-weight: 800; }
    .teacher-name { width: 13%; }
    .teacher-table th:nth-child(3) { width: 9%; }
    .teacher-table th:nth-child(4) { width: 8%; }
    .teacher-table th:nth-child(5) { width: 48%; }
    .teacher-table th:nth-child(6) { width: 8%; }
    .teacher-table th:nth-child(7) { width: 10%; }
    .role-badge { display: inline-block; border-radius: 999px; padding: 2px 7px; background: #edf3f2; color: #405c58; font-size: 7.5pt; font-weight: 700; white-space: nowrap; }
    .role-badge.lead { background: #e8f6f2; color: #0f6b5e; }
    .assignment-line { display: grid; grid-template-columns: minmax(115px, 1.15fr) 1fr auto; align-items: baseline; gap: 6px; padding: 1px 0; border-bottom: 1px dotted #dbe4e2; }
    .assignment-line:last-child { border-bottom: 0; }
    .assignment-line strong { color: #203e3a; font-size: 7.7pt; }
    .assignment-line span { color: #516360; }
    .assignment-line em { color: #0f766e; font-style: normal; font-weight: 800; white-space: nowrap; }
    .load-cell { text-align: center; white-space: nowrap; }
    .load-cell strong { display: block; font-size: 12px; color: #0f766e; }
    .load-cell span { display: block; color: #74817f; font-size: 7pt; }
    .notes-cell { color: #63706e; }
    .empty { color: #8b9694; }
    .coverage-section { margin-top: 7px; break-inside: avoid; }
    .coverage-table { border: 1px solid #d9e5e2; border-radius: 10px; overflow: hidden; font-size: 7.8pt; }
    .coverage-table th { padding: 4px 7px; background: #eaf5f2; color: #244f49; border-left: 1px solid #d7e6e2; }
    .coverage-table td { padding: 4px 7px; border-top: 1px solid #e3ebe9; border-left: 1px solid #edf2f1; }
    .coverage-table th:last-child, .coverage-table td:last-child { border-left: 0; }
    .coverage-status { display: inline-block; border-radius: 999px; padding: 2px 7px; font-size: 7.5pt; font-weight: 800; white-space: nowrap; }
    .coverage-status.complete { color: #116149; background: #e9f7f1; }
    .coverage-status.incomplete { color: #9a5419; background: #fff1df; }
    .unassigned-note { margin-top: 8px; border: 1px solid #efc5bf; background: #fff4f2; color: #8a2b22; border-radius: 9px; padding: 7px 10px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; break-inside: avoid; }
    .signature { min-height: 38px; border-top: 1px solid #9fb1ae; padding-top: 4px; color: #667472; }
    .signature strong { display: inline-block; color: #284743; margin-left: 10px; }
    .report-footer { margin-top: 8px; padding-top: 4px; border-top: 1px solid #dfe8e6; display: flex; justify-content: space-between; color: #7a8785; font-size: 7pt; }
    @media screen {
      body { background: #eef4f2; padding: 18px; }
      .report { max-width: 1120px; margin: 0 auto; background: #fff; padding: 12px; box-shadow: 0 16px 45px rgba(23,37,45,.12); }
    }
  </style>
</head>
<body>
  <main class="report">
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
      <table class="coverage-table">
        <thead><tr><th>المادة</th><th>الصف</th><th>الشعب المسندة / المطلوبة</th><th>الحصص المسندة / المطلوبة</th><th>الحالة</th></tr></thead>
        <tbody>${coverageRows(scenario, data)}</tbody>
      </table>
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

  frame.onload = () => {
    const reportWindow = frame.contentWindow;
    if (!reportWindow) {
      cleanup();
      return;
    }
    reportWindow.addEventListener?.('afterprint', cleanup, { once: true });
    setTimeout(() => {
      reportWindow.focus();
      reportWindow.print();
      setTimeout(cleanup, 2500);
    }, 180);
  };

  frame.srcdoc = html;
  document.body.appendChild(frame);
  return html;
}

export function exportScenarioCsv(scenario, teachers) {
  const header = ['المعلم', 'التخصص', 'الصف', 'الشعبة', 'المادة', 'الحصص'];
  const rows = scenario.assignments.map((assignment) => {
    const teacher = teachers.find((item) => item.id === assignment.teacherId);
    return [
      teacher?.name ?? 'غير معروف',
      teacher?.specialty ?? '',
      assignment.grade,
      assignment.section,
      assignment.subject,
      assignment.periods,
    ];
  });

  const csv = '\uFEFF' + [header, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');

  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `qistas-${scenario.id}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
