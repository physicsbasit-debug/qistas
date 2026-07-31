import { createDefaultAssignmentPolicy } from '../domain/assignmentPolicy.js';

const teacher = (id, name, specialty, allowedSubjects, targetLoad, isLead = false) => ({
  id,
  name,
  specialty,
  allowedSubjects,
  minLoad: Math.max(0, targetLoad - 2),
  targetLoad,
  maxLoad: targetLoad + 2,
  isLead,
  active: true,
  assignmentPolicy: createDefaultAssignmentPolicy(),
});

export const seedData = {
  schoolName: 'المدرسة النموذجية',
  departmentName: 'قسم العلوم',
  teachers: [
    teacher('bio-1', 'معلم أحياء 1', 'الأحياء', ['الأحياء', 'العلوم العامة'], 16),
    teacher('bio-2', 'معلم أحياء 2', 'الأحياء', ['الأحياء', 'العلوم العامة'], 16),
    teacher('bio-3', 'معلم أحياء 3', 'الأحياء', ['الأحياء', 'العلوم العامة'], 16),
    teacher('chem-1', 'معلم كيمياء 1', 'الكيمياء', ['الكيمياء', 'العلوم العامة'], 16),
    teacher('chem-2', 'معلم كيمياء 2', 'الكيمياء', ['الكيمياء', 'العلوم العامة'], 16),
    teacher('chem-3', 'معلم كيمياء 3', 'الكيمياء', ['الكيمياء', 'العلوم العامة'], 16),
    teacher('phy-1', 'معلم فيزياء 1', 'الفيزياء', ['الفيزياء', 'العلوم العامة'], 18),
    teacher('phy-2', 'معلم فيزياء 2', 'الفيزياء', ['الفيزياء', 'العلوم العامة'], 18),
    teacher('lead-1', 'المعلم الأول', 'الفيزياء', ['الفيزياء', 'العلوم العامة'], 10, true),
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
