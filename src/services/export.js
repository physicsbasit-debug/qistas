function escapeCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function exportScenarioCsv(scenario, teachers) {
  const header = [
    'المعلم',
    'التخصص',
    'الصف',
    'الشعبة',
    'المادة',
    'الحصص',
  ];

  const rows = scenario.assignments.map((assignment) => {
    const teacher = teachers.find(
      (item) => item.id === assignment.teacherId,
    );

    return [
      teacher?.name ?? 'غير معروف',
      teacher?.specialty ?? '',
      assignment.grade,
      assignment.section,
      assignment.subject,
      assignment.periods,
    ];
  });

  const csv =
    '\uFEFF' +
    [header, ...rows]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');

  const url = URL.createObjectURL(
    new Blob([csv], {
      type: 'text/csv;charset=utf-8',
    }),
  );

  const link = document.createElement('a');
  link.href = url;
  link.download = `qistas-${scenario.id}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}
