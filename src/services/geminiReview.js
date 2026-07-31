export async function requestGeminiReview(data, scenarios) {
  const supabaseUrl = localStorage.getItem('qistas:supabase-url') || '';
  const anonKey = localStorage.getItem('qistas:supabase-anon-key') || '';
  if (!supabaseUrl || !anonKey) throw new Error('أدخل رابط Supabase ومفتاح anon من إعدادات Gemini.');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/review-distribution`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      schoolName: data.schoolName,
      departmentName: data.departmentName,
      settings: data.settings,
      requirements: data.requirements,
      teachers: data.teachers.map(({
        id,
        name,
        specialty,
        isLead,
        assignmentPolicy,
      }) => ({ id, name, specialty, isLead, assignmentPolicy })),
      scenarios: scenarios.slice(0, 12).map((scenario) => ({
        id: scenario.id,
        label: scenario.label,
        variance: scenario.variance,
        overloadCount: scenario.overloadCount,
        flexiblePeriodsCount: scenario.flexiblePeriodsCount,
        unassignedCount: scenario.unassigned.length,
        repairedCount: scenario.repairedCount,
        relocationCount: scenario.relocationCount,
        assignments: scenario.assignments.map(({
          teacherId,
          grade,
          subject,
          section,
          periods,
          preference,
        }) => ({ teacherId, grade, subject, section, periods, preference })),
        unassigned: scenario.unassigned.map(({
          grade,
          subject,
          section,
          periods,
        }) => ({ grade, subject, section, periods })),
        summaries: scenario.summaries.map(({
          teacherId,
          load,
          maxLoad,
          subjectCount,
          gradeCount,
          flexiblePeriods,
        }) => ({ teacherId, load, maxLoad, subjectCount, gradeCount, flexiblePeriods })),
      })),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'تعذرت مراجعة Gemini.');
  return payload;
}
