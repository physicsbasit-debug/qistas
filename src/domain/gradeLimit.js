export const MAX_GRADES_PER_TEACHER = 2;

const runtimeTeacherGrades = new Map();

function normalizeGrade(value = '') {
  return String(value || '').trim();
}

export function assignedGradesForTeacher(
  assignments = [],
  teacherId,
  { excludingTaskIds = [] } = {},
) {
  const excluded = new Set(excludingTaskIds);
  return new Set(
    assignments
      .filter((assignment) => (
        assignment.teacherId === teacherId
        && !excluded.has(assignment.taskId)
      ))
      .map((assignment) => normalizeGrade(assignment.grade))
      .filter(Boolean),
  );
}

export function canAssignGrade(
  assignments = [],
  teacherId,
  grade,
  { excludingTaskIds = [] } = {},
) {
  const targetGrade = normalizeGrade(grade);
  if (!targetGrade) return true;
  const grades = assignedGradesForTeacher(assignments, teacherId, { excludingTaskIds });
  return grades.has(targetGrade) || grades.size < MAX_GRADES_PER_TEACHER;
}

export function gradeLimitViolations(assignments = []) {
  const teacherIds = new Set(assignments.map((assignment) => assignment.teacherId).filter(Boolean));
  return [...teacherIds]
    .map((teacherId) => ({
      teacherId,
      grades: [...assignedGradesForTeacher(assignments, teacherId)],
    }))
    .filter((item) => item.grades.length > MAX_GRADES_PER_TEACHER);
}

export function syncRuntimeTeacherGrades(assignments = []) {
  runtimeTeacherGrades.clear();
  for (const assignment of assignments) {
    const teacherId = String(assignment?.teacherId || '');
    const grade = normalizeGrade(assignment?.grade);
    if (!teacherId || !grade) continue;
    if (!runtimeTeacherGrades.has(teacherId)) runtimeTeacherGrades.set(teacherId, new Set());
    runtimeTeacherGrades.get(teacherId).add(grade);
  }
}

export function clearRuntimeTeacherGrades() {
  runtimeTeacherGrades.clear();
}

export function canRuntimeTeacherTakeGrade(teacherId, grade) {
  const targetGrade = normalizeGrade(grade);
  if (!teacherId || !targetGrade) return true;
  const grades = runtimeTeacherGrades.get(String(teacherId));
  if (!grades) return true;
  return grades.has(targetGrade) || grades.size < MAX_GRADES_PER_TEACHER;
}
