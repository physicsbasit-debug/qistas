export const GRADE_CATALOG = Object.freeze([
  { number: 1, label: 'الأول' },
  { number: 2, label: 'الثاني' },
  { number: 3, label: 'الثالث' },
  { number: 4, label: 'الرابع' },
  { number: 5, label: 'الخامس' },
  { number: 6, label: 'السادس' },
  { number: 7, label: 'السابع' },
  { number: 8, label: 'الثامن' },
  { number: 9, label: 'التاسع' },
  { number: 10, label: 'العاشر' },
  { number: 11, label: 'الحادي عشر' },
  { number: 12, label: 'الثاني عشر' },
]);

const byNumber = new Map(GRADE_CATALOG.map((grade) => [grade.number, grade]));
const byLabel = new Map(GRADE_CATALOG.map((grade) => [grade.label, grade]));

function clampGrade(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(12, Math.max(1, Math.trunc(numeric)));
}

export function gradeNumber(value) {
  if (typeof value === 'number') return clampGrade(value, Number.NaN);
  const text = String(value || '').trim();
  if (!text) return Number.NaN;
  if (byLabel.has(text)) return byLabel.get(text).number;
  const numeric = Number(text.replace(/[^0-9]/g, ''));
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 12 ? numeric : Number.NaN;
}

export function gradeLabel(value) {
  const numeric = gradeNumber(value);
  return byNumber.get(numeric)?.label || '';
}

export function inferGradeRange(requirements = [], fallback = { start: 1, end: 12 }) {
  const values = requirements
    .map((requirement) => gradeNumber(requirement?.grade))
    .filter(Number.isFinite);
  if (!values.length) return { ...fallback };
  return {
    start: Math.min(...values),
    end: Math.max(...values),
  };
}

export function normalizeGradeRange(range, requirements = [], fallback = { start: 1, end: 12 }) {
  const inferred = inferGradeRange(requirements, fallback);
  let start = clampGrade(range?.start, inferred.start);
  let end = clampGrade(range?.end, inferred.end);
  if (start > end) [start, end] = [end, start];
  return { start, end };
}

export function gradesInRange(range) {
  const normalized = normalizeGradeRange(range, [], { start: 1, end: 12 });
  return GRADE_CATALOG.filter((grade) => (
    grade.number >= normalized.start && grade.number <= normalized.end
  ));
}

export function compareGrades(a, b) {
  const left = gradeNumber(a);
  const right = gradeNumber(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  if (Number.isFinite(left)) return -1;
  if (Number.isFinite(right)) return 1;
  return String(a || '').localeCompare(String(b || ''), 'ar');
}

export function gradeRangeLabel(range) {
  const normalized = normalizeGradeRange(range, [], { start: 1, end: 12 });
  return normalized.start === normalized.end
    ? `الصف ${gradeLabel(normalized.start)}`
    : `الصفوف من ${gradeLabel(normalized.start)} إلى ${gradeLabel(normalized.end)}`;
}
