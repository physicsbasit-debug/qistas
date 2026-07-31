import { POLICY_MODES } from '../domain/assignmentPolicy.js';

const defaultAcademicYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 5 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
};

const teacher = (id, name, specialty, isLead = false) => ({
  id,
  name,
  specialty,
  isLead,
  active: true,
  assignmentPolicy: {
    mode: POLICY_MODES.SPECIALTY_PLUS_EXTRA,
    grade: '',
    requirementId: '',
    extraRequirementId: 'g8-science',
    selectedRequirementIds: [],
  },
});

export const seedData = {
  planId: 'science-8-10',
  planName: 'قسم العلوم 8-10',
  schoolName: 'المدرسة النموذجية',
  departmentName: 'قسم العلوم',
  academicYear: defaultAcademicYear(),
  gradeRange: { start: 8, end: 10 },
  planScope: {
    mode: 'department',
    templateId: 'science',
    subjectId: '',
    selectedSubjectIds: ['general-science', 'physics', 'chemistry', 'biology'],
    teacherCount: 9,
    hasLead: true,
  },
  settings: {
    teacherMaxLoad: 18,
    leadMaxLoad: 12,
    schoolShift: 'single',
  },
  teachers: [
    teacher('bio-1', 'معلم أحياء 1', 'الأحياء'),
    teacher('bio-2', 'معلم أحياء 2', 'الأحياء'),
    teacher('bio-3', 'معلم أحياء 3', 'الأحياء'),
    teacher('chem-1', 'معلم كيمياء 1', 'الكيمياء'),
    teacher('chem-2', 'معلم كيمياء 2', 'الكيمياء'),
    teacher('chem-3', 'معلم كيمياء 3', 'الكيمياء'),
    teacher('phy-1', 'معلم فيزياء 1', 'الفيزياء'),
    teacher('phy-2', 'معلم فيزياء 2', 'الفيزياء'),
    teacher('lead-1', 'المعلم الأول', 'الفيزياء', true),
  ],
  requirements: [
    { id: 'g8-science', grade: 'الثامن', subject: 'العلوم العامة', sections: 8, periodsPerSection: 6 },
    { id: 'g9-physics', grade: 'التاسع', subject: 'الفيزياء', sections: 9, periodsPerSection: 2 },
    { id: 'g9-chemistry', grade: 'التاسع', subject: 'الكيمياء', sections: 9, periodsPerSection: 2 },
    { id: 'g9-biology', grade: 'التاسع', subject: 'الأحياء', sections: 9, periodsPerSection: 2 },
    { id: 'g10-physics', grade: 'العاشر', subject: 'الفيزياء', sections: 6, periodsPerSection: 2 },
    { id: 'g10-chemistry', grade: 'العاشر', subject: 'الكيمياء', sections: 6, periodsPerSection: 2 },
    { id: 'g10-biology', grade: 'العاشر', subject: 'الأحياء', sections: 6, periodsPerSection: 2 },
  ],
};
