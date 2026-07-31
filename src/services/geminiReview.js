export async function requestGeminiReview(data, scenarios) {
  const supabaseUrl = localStorage.getItem('qistas:supabase-url') || '';
  const anonKey = localStorage.getItem('qistas:supabase-anon-key') || '';
  if (!supabaseUrl || !anonKey) throw new Error('أدخل رابط Supabase ومفتاح anon من إعدادات Gemini.');
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/review-distribution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}`, apikey: anonKey },
    body: JSON.stringify({
      schoolName: data.schoolName,
      departmentName: data.departmentName,
      teachers: data.teachers.map(({ id, name, specialty, minLoad, targetLoad, maxLoad, isLead, assignmentPolicy }) => ({ id, name, specialty, minLoad, targetLoad, maxLoad, isLead, assignmentPolicy })),
      scenarios: scenarios.map((s) => ({
        id: s.id, label: s.label, variance: s.variance, overloadCount: s.overloadCount,
        underMinCount: s.underMinCount, outsideSpecialtyCount: s.outsideSpecialtyCount,
        unassignedCount: s.unassigned.length,
        summaries: s.summaries.map(({ teacherId, load, subjectCount, gradeCount, outsidePrimarySpecialty }) => ({ teacherId, load, subjectCount, gradeCount, outsidePrimarySpecialty })),
      })),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'تعذرت مراجعة Gemini.');
  return payload;
}
