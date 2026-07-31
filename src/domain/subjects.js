import { gradeNumber, gradesInRange, normalizeGradeRange } from './grades.js';

export const SCHOOL_SHIFT = Object.freeze({
  SINGLE: 'single',
  DOUBLE: 'double',
});

export const SUBJECT_CATEGORIES = Object.freeze({
  CORE: 'مواد أساسية',
  SUPPORTING: 'مواد مصاحبة',
  SCIENCE: 'العلوم',
  LANGUAGES: 'اللغات',
  SKILLS: 'المهارات والفنون',
  GUIDANCE: 'التوجيه',
  POST_BASIC: 'مواد اختيارية 11-12',
  VOCATIONAL: 'المسار المهني والتقني',
});

const grades = (...values) => values;
const periods = (single, double = single) => ({ single, double });

const subject = (id, label, gradeList, category, weeklyPeriods = {}, options = {}) => ({
  id,
  label,
  grades: gradeList,
  category,
  weeklyPeriods,
  optional: Boolean(options.optional),
  track: options.track || 'general',
  aliases: options.aliases || [],
});

export const SUBJECT_CATALOG = Object.freeze([
  subject('islamic', 'التربية الإسلامية', grades(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.CORE, {
    1: periods(5, 3), 2: periods(5, 3), 3: periods(5), 4: periods(5),
    5: periods(5, 4), 6: periods(5, 4), 7: periods(5, 3), 8: periods(5, 3), 9: periods(5, 4), 10: periods(5, 4),
    11: periods(4, 3), 12: periods(4, 3),
  }),
  subject('arabic', 'اللغة العربية', grades(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.CORE, {
    1: periods(12, 11), 2: periods(12, 11), 3: periods(11, 10), 4: periods(10),
    5: periods(7), 6: periods(7), 7: periods(7, 6), 8: periods(7, 6), 9: periods(7, 6), 10: periods(7, 6),
    11: periods(6, 5), 12: periods(6, 5),
  }),
  subject('english', 'اللغة الإنجليزية', grades(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.LANGUAGES, {
    1: periods(7), 2: periods(7), 3: periods(7, 6), 4: periods(7, 6),
    5: periods(5), 6: periods(5), 7: periods(5), 8: periods(5), 9: periods(5), 10: periods(5),
    11: periods(6, 4), 12: periods(6, 4),
  }),
  subject('math', 'الرياضيات', grades(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), SUBJECT_CATEGORIES.CORE, {
    1: periods(7, 6), 2: periods(7, 6), 3: periods(6, 5), 4: periods(6, 5),
    5: periods(7, 6), 6: periods(7, 6), 7: periods(7, 6), 8: periods(7, 6), 9: periods(6), 10: periods(6),
  }),
  subject('math-basic', 'الرياضيات الأساسية', grades(11, 12), SUBJECT_CATEGORIES.CORE, { 11: periods(6, 5), 12: periods(6, 5) }),
  subject('math-advanced', 'الرياضيات المتقدمة', grades(11, 12), SUBJECT_CATEGORIES.CORE, { 11: periods(6, 5), 12: periods(6, 5) }),

  subject('general-science', 'العلوم العامة', grades(1, 2, 3, 4, 5, 6, 7, 8), SUBJECT_CATEGORIES.SCIENCE, {
    1: periods(3), 2: periods(3), 3: periods(4), 4: periods(5, 4),
    5: periods(5, 4), 6: periods(5, 4), 7: periods(6), 8: periods(6),
  }),
  subject('physics', 'الفيزياء', grades(9, 10, 11, 12), SUBJECT_CATEGORIES.SCIENCE, { 9: periods(3, 2), 10: periods(3, 2), 11: periods(5), 12: periods(5) }, { optional: true }),
  subject('chemistry', 'الكيمياء', grades(9, 10, 11, 12), SUBJECT_CATEGORIES.SCIENCE, { 9: periods(3, 2), 10: periods(3, 2), 11: periods(5), 12: periods(5) }, { optional: true }),
  subject('biology', 'الأحياء', grades(9, 10, 11, 12), SUBJECT_CATEGORIES.SCIENCE, { 9: periods(3, 2), 10: periods(3, 2), 11: periods(5), 12: periods(5) }, { optional: true }),
  subject('environmental-science', 'العلوم البيئية', grades(11), SUBJECT_CATEGORIES.POST_BASIC, { 11: periods(5) }, { optional: true }),

  subject('identity-citizenship', 'الهوية والمواطنة', grades(1, 2, 3, 4), SUBJECT_CATEGORIES.SUPPORTING, {
    1: periods(1), 2: periods(1), 3: periods(1), 4: periods(1),
  }),
  subject('social-studies', 'الدراسات الاجتماعية', grades(5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.CORE, {
    5: periods(4, 3), 6: periods(4, 3), 7: periods(4, 3), 8: periods(4, 3), 9: periods(2), 10: periods(2),
    11: periods(2), 12: periods(2),
  }),
  subject('life-skills', 'المهارات الحياتية', grades(5, 6, 7, 8, 9, 10), SUBJECT_CATEGORIES.SKILLS, {
    5: periods(1), 6: periods(1), 7: periods(1), 8: periods(1), 9: periods(1), 10: periods(1),
  }),
  subject('information-technology', 'تقنية المعلومات', grades(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.SKILLS, {
    1: periods(1), 2: periods(1), 3: periods(2, 1), 4: periods(2, 1),
    5: periods(2), 6: periods(2), 7: periods(2), 8: periods(2), 9: periods(2), 10: periods(1),
    11: periods(5), 12: periods(5),
  }, { optional: true }),
  subject('physical-health', 'التربية البدنية والصحية', grades(1, 2, 3, 4), SUBJECT_CATEGORIES.SKILLS, {
    1: periods(2, 1), 2: periods(2, 1), 3: periods(2, 1), 4: periods(2, 1),
  }),
  subject('school-sports', 'الرياضة المدرسية', grades(5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.SKILLS, {
    5: periods(2, 1), 6: periods(2, 1), 7: periods(1), 8: periods(1), 9: periods(1), 10: periods(1),
    11: periods(5), 12: periods(5),
  }, { optional: true }),
  subject('visual-arts', 'الفنون البصرية', grades(1, 2, 3, 4), SUBJECT_CATEGORIES.SKILLS, {
    1: periods(1), 2: periods(1), 3: periods(1), 4: periods(1),
  }),
  subject('fine-arts', 'الفنون التشكيلية', grades(5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.SKILLS, {
    5: periods(1), 6: periods(1), 7: periods(1), 8: periods(1), 9: periods(1), 10: periods(1),
    11: periods(5), 12: periods(5),
  }, { optional: true }),
  subject('music-arts', 'الفنون الموسيقية', grades(1, 2, 3, 4), SUBJECT_CATEGORIES.SKILLS, {
    1: periods(1), 2: periods(1), 3: periods(1), 4: periods(1),
  }),
  subject('music-skills', 'المهارات الموسيقية', grades(5, 6, 7, 8, 9, 10, 11, 12), SUBJECT_CATEGORIES.SKILLS, {
    5: periods(1), 6: periods(1), 7: periods(1), 8: periods(1), 9: periods(1), 10: periods(1),
    11: periods(5), 12: periods(5),
  }, { optional: true }),
  subject('career-guidance', 'خدمة التوجيه المهني', grades(10, 11, 12), SUBJECT_CATEGORIES.GUIDANCE, {
    10: periods(1), 11: periods(1), 12: periods(1),
  }),

  subject('english-skills', 'مهارات اللغة الإنجليزية', grades(11, 12), SUBJECT_CATEGORIES.POST_BASIC, { 11: periods(5), 12: periods(5) }, { optional: true }),
  subject('french', 'اللغة الفرنسية', grades(11, 12), SUBJECT_CATEGORIES.POST_BASIC, { 11: periods(5), 12: periods(5) }, { optional: true }),
  subject('german', 'اللغة الألمانية', grades(11, 12), SUBJECT_CATEGORIES.POST_BASIC, { 11: periods(5), 12: periods(5) }, { optional: true }),
  subject('economic-geography', 'الجغرافيا الاقتصادية', grades(11), SUBJECT_CATEGORIES.POST_BASIC, { 11: periods(5) }, { optional: true }),
  subject('geography-modern', 'الجغرافيا والتقنيات الحديثة', grades(12), SUBJECT_CATEGORIES.POST_BASIC, { 12: periods(5) }, { optional: true }),
  subject('islamic-civilization-history', 'التاريخ: الحضارة الإسلامية', grades(11), SUBJECT_CATEGORIES.POST_BASIC, { 11: periods(5) }, { optional: true }),
  subject('world-history', 'التاريخ: العالم من حولي', grades(12), SUBJECT_CATEGORIES.POST_BASIC, { 12: periods(5) }, { optional: true }),

  subject('specialized-english', 'اللغة الإنجليزية التخصصية', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('business-intro', 'مقدمة في الأعمال التجارية', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('business-marketing', 'التسويق التجاري', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('business-decisions', 'صنع القرارات التجارية', grades(12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('business-training', 'التدريب لعالم الأعمال', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('mis-management', 'إدارة نظم المعلومات', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('database-management', 'إدارة قواعد البيانات', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('software-development', 'تطوير البرمجيات', grades(12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('business-robotics-social', 'الروبوتات ووسائل التواصل الاجتماعي في العمل التجاري', grades(12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('mechanical-manufacturing', 'هندسة التصنيع الميكانيكية', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('occupational-safety', 'الصحة والسلامة المهنية', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('solid-installations-maintenance', 'صيانة المنشآت الصلبة', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('engineering-maintenance', 'الصيانة الهندسية', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('welding-metal-forming', 'اللحام وتشكيل المعادن', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
  subject('lifting-operations', 'عمليات الرفع والتنزيل', grades(11, 12), SUBJECT_CATEGORIES.VOCATIONAL, {}, { track: 'vocational' }),
]);

export const DEPARTMENT_TEMPLATES = Object.freeze([
  { id: 'islamic', label: 'التربية الإسلامية', subjectIds: ['islamic'] },
  { id: 'arabic', label: 'اللغة العربية', subjectIds: ['arabic'] },
  { id: 'english', label: 'اللغة الإنجليزية', subjectIds: ['english'] },
  { id: 'math', label: 'الرياضيات', subjectIds: ['math', 'math-basic', 'math-advanced'] },
  { id: 'science', label: 'العلوم', subjectIds: ['general-science', 'physics', 'chemistry', 'biology', 'environmental-science'] },
  { id: 'social', label: 'الدراسات الاجتماعية', subjectIds: ['identity-citizenship', 'social-studies', 'economic-geography', 'geography-modern', 'islamic-civilization-history', 'world-history'] },
  { id: 'it', label: 'تقنية المعلومات', subjectIds: ['information-technology'] },
  { id: 'life-skills', label: 'المهارات الحياتية', subjectIds: ['life-skills'] },
  { id: 'sports', label: 'التربية البدنية والرياضة', subjectIds: ['physical-health', 'school-sports'] },
  { id: 'arts', label: 'الفنون البصرية والتشكيلية', subjectIds: ['visual-arts', 'fine-arts'] },
  { id: 'music', label: 'الفنون والمهارات الموسيقية', subjectIds: ['music-arts', 'music-skills'] },
  { id: 'career', label: 'التوجيه المهني', subjectIds: ['career-guidance'] },
  { id: 'foreign-languages', label: 'اللغات والمواد الاختيارية', subjectIds: ['english-skills', 'french', 'german'] },
  { id: 'post-basic', label: 'اختيارات الصفين 11-12', subjectIds: ['english-skills', 'french', 'german', 'physics', 'chemistry', 'biology', 'environmental-science', 'information-technology', 'economic-geography', 'geography-modern', 'islamic-civilization-history', 'world-history', 'school-sports', 'fine-arts', 'music-skills'] },
  { id: 'vocational-business', label: 'المسار المهني: إدارة الأعمال', subjectIds: ['specialized-english', 'business-intro', 'business-marketing', 'business-decisions', 'business-training'] },
  { id: 'vocational-it', label: 'المسار المهني: تقنية المعلومات', subjectIds: ['specialized-english', 'mis-management', 'database-management', 'software-development', 'business-robotics-social'] },
  { id: 'vocational-engineering', label: 'المسار المهني: هندسي وصناعي', subjectIds: ['mechanical-manufacturing', 'occupational-safety', 'solid-installations-maintenance', 'engineering-maintenance', 'welding-metal-forming', 'lifting-operations'] },
]);

const byId = new Map(SUBJECT_CATALOG.map((item) => [item.id, item]));
const byLabel = new Map();
for (const item of SUBJECT_CATALOG) {
  byLabel.set(item.label, item);
  for (const alias of item.aliases) byLabel.set(alias, item);
}

export function subjectById(id) {
  return byId.get(String(id || '')) || null;
}

export function subjectByLabel(label) {
  return byLabel.get(String(label || '').trim()) || null;
}

export function subjectsForGrade(grade, { includeVocational = true } = {}) {
  const number = gradeNumber(grade);
  if (!Number.isFinite(number)) return [];
  return SUBJECT_CATALOG
    .filter((item) => item.grades.includes(number) && (includeVocational || item.track !== 'vocational'))
    .sort((a, b) => a.category.localeCompare(b.category, 'ar') || a.label.localeCompare(b.label, 'ar'));
}

export function allSubjectLabels() {
  return [...new Set(SUBJECT_CATALOG.map((item) => item.label))].sort((a, b) => a.localeCompare(b, 'ar'));
}

export function recommendedPeriods(grade, subjectLabel, shift = SCHOOL_SHIFT.SINGLE) {
  const item = subjectByLabel(subjectLabel);
  const number = gradeNumber(grade);
  if (!item || !Number.isFinite(number)) return 1;
  const entry = item.weeklyPeriods[number];
  if (!entry) return 1;
  return Number(entry[shift]) || Number(entry.single) || 1;
}

export function templateById(id) {
  return DEPARTMENT_TEMPLATES.find((item) => item.id === id) || DEPARTMENT_TEMPLATES[0];
}

export function requirementsForTemplate(templateId, range, shift = SCHOOL_SHIFT.SINGLE) {
  const template = templateById(templateId);
  const allowedIds = new Set(template.subjectIds);
  const normalized = normalizeGradeRange(range, [], { start: 1, end: 12 });
  const gradeList = gradesInRange(normalized);
  const rows = [];
  for (const grade of gradeList) {
    for (const item of SUBJECT_CATALOG) {
      if (!allowedIds.has(item.id) || !item.grades.includes(grade.number)) continue;
      rows.push({
        grade: grade.label,
        subject: item.label,
        sections: 1,
        periodsPerSection: recommendedPeriods(grade.number, item.label, shift),
      });
    }
  }
  return rows;
}

export function subjectCatalogSummary() {
  return {
    subjects: SUBJECT_CATALOG.length,
    templates: DEPARTMENT_TEMPLATES.length,
    grades: 12,
  };
}
