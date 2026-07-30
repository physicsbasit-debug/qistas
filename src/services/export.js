function escapeCsv(value) { return `"${String(value).replaceAll('"', '""')}"`; }
export function exportScenarioCsv(scenario, teachers) {
  const header = ['المعلم', 'التخصص', 'الصف', 'الشعبة', 'المادة', 'الحصص'];
  const rows = scenario.assignments.map((a) => {
    const t = teachers.find((item) => item.id === a.teacherId);
    return [t?.name ?? 'غير معروف', t?.specialty ?? '', a.grade, a.section, a.subject, a.periods];
  });
  const csv = '﻿' + [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('
');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `teacher-load-${scenario.id}.csv`; link.click(); URL.revokeObjectURL(url);
}
