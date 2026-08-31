#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GRADE_LIMIT_SOURCE = "export const MAX_GRADES_PER_TEACHER = 2;\n\nconst runtimeTeacherGrades = new Map();\n\nfunction normalizeGrade(value = '') {\n  return String(value || '').trim();\n}\n\nexport function assignedGradesForTeacher(\n  assignments = [],\n  teacherId,\n  { excludingTaskIds = [] } = {},\n) {\n  const excluded = new Set(excludingTaskIds);\n  return new Set(\n    assignments\n      .filter((assignment) => (\n        assignment.teacherId === teacherId\n        && !excluded.has(assignment.taskId)\n      ))\n      .map((assignment) => normalizeGrade(assignment.grade))\n      .filter(Boolean),\n  );\n}\n\nexport function canAssignGrade(\n  assignments = [],\n  teacherId,\n  grade,\n  { excludingTaskIds = [] } = {},\n) {\n  const targetGrade = normalizeGrade(grade);\n  if (!targetGrade) return true;\n  const grades = assignedGradesForTeacher(assignments, teacherId, { excludingTaskIds });\n  return grades.has(targetGrade) || grades.size < MAX_GRADES_PER_TEACHER;\n}\n\nexport function gradeLimitViolations(assignments = []) {\n  const teacherIds = new Set(assignments.map((assignment) => assignment.teacherId).filter(Boolean));\n  return [...teacherIds]\n    .map((teacherId) => ({\n      teacherId,\n      grades: [...assignedGradesForTeacher(assignments, teacherId)],\n    }))\n    .filter((item) => item.grades.length > MAX_GRADES_PER_TEACHER);\n}\n\nexport function syncRuntimeTeacherGrades(assignments = []) {\n  runtimeTeacherGrades.clear();\n  for (const assignment of assignments) {\n    const teacherId = String(assignment?.teacherId || '');\n    const grade = normalizeGrade(assignment?.grade);\n    if (!teacherId || !grade) continue;\n    if (!runtimeTeacherGrades.has(teacherId)) runtimeTeacherGrades.set(teacherId, new Set());\n    runtimeTeacherGrades.get(teacherId).add(grade);\n  }\n}\n\nexport function clearRuntimeTeacherGrades() {\n  runtimeTeacherGrades.clear();\n}\n\nexport function canRuntimeTeacherTakeGrade(teacherId, grade) {\n  const targetGrade = normalizeGrade(grade);\n  if (!teacherId || !targetGrade) return true;\n  const grades = runtimeTeacherGrades.get(String(teacherId));\n  if (!grades) return true;\n  return grades.has(targetGrade) || grades.size < MAX_GRADES_PER_TEACHER;\n}\n";
const GRADE_LIMIT_TEST_SOURCE = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport {\n  canAssignGrade,\n  gradeLimitViolations,\n  MAX_GRADES_PER_TEACHER,\n} from '../src/domain/gradeLimit.js';\nimport {\n  generateDistributionModels,\n  generateScenario,\n  validateFixedAssignments,\n} from '../src/engine/distribution.js';\nimport { POLICY_MODES } from '../src/domain/assignmentPolicy.js';\n\nconst settings = { teacherMaxLoad: 30, leadMaxLoad: 30 };\n\nfunction teacher(id) {\n  return {\n    id,\n    name: id,\n    specialty: 'الأحياء',\n    isLead: false,\n    active: true,\n    assignmentPolicy: {\n      mode: POLICY_MODES.SPECIALTY_ONLY,\n      grade: '',\n      requirementId: '',\n      extraRequirementId: '',\n      selectedRequirementIds: [],\n    },\n  };\n}\n\nconst requirements = [\n  { id: 'g8-bio', grade: 'الثامن', subject: 'الأحياء', sections: 1, periodsPerSection: 2 },\n  { id: 'g9-bio', grade: 'التاسع', subject: 'الأحياء', sections: 1, periodsPerSection: 2 },\n  { id: 'g10-bio', grade: 'العاشر', subject: 'الأحياء', sections: 1, periodsPerSection: 2 },\n];\n\ntest('grade helper allows sections within two grades and rejects a third grade', () => {\n  const assignments = [\n    { taskId: 'a', teacherId: 't1', grade: 'التاسع' },\n    { taskId: 'b', teacherId: 't1', grade: 'العاشر' },\n  ];\n  assert.equal(MAX_GRADES_PER_TEACHER, 2);\n  assert.equal(canAssignGrade(assignments, 't1', 'التاسع'), true);\n  assert.equal(canAssignGrade(assignments, 't1', 'العاشر'), true);\n  assert.equal(canAssignGrade(assignments, 't1', 'الثامن'), false);\n});\n\ntest('single teacher is never assigned a third distinct grade automatically', () => {\n  const scenario = generateScenario(\n    'balanced',\n    [teacher('t1')],\n    requirements,\n    settings,\n    { seed: 3, attempt: 0, skipMutation: true },\n  );\n  const grades = new Set(scenario.assignments.map((assignment) => assignment.grade));\n  assert.ok(grades.size <= 2);\n  assert.equal(scenario.gradeLimitViolationCount, 0);\n  assert.ok(scenario.unassigned.length >= 1);\n});\n\ntest('multiple teachers can complete three grades while every teacher stays at two grades or fewer', () => {\n  const result = generateDistributionModels(\n    [teacher('t1'), teacher('t2')],\n    requirements,\n    settings,\n    { limit: 5, attempts: 20 },\n  );\n  assert.ok(result.models.length > 0);\n  const complete = result.models.find((model) => model.unassigned.length === 0);\n  assert.ok(complete);\n  assert.equal(complete.gradeLimitViolationCount, 0);\n  for (const summary of complete.summaries) assert.ok(summary.gradeCount <= 2);\n});\n\ntest('fixed assignments reject three distinct grades for the same teacher', () => {\n  const errors = validateFixedAssignments(\n    [teacher('t1')],\n    requirements,\n    settings,\n    [\n      { taskId: 'g8-bio-s1', teacherId: 't1' },\n      { taskId: 'g9-bio-s1', teacherId: 't1' },\n      { taskId: 'g10-bio-s1', teacherId: 't1' },\n    ],\n  );\n  assert.match(errors.join(' '), /صفين دراسيين/);\n});\n\ntest('violation helper identifies legacy or malformed three-grade assignments', () => {\n  const violations = gradeLimitViolations([\n    { taskId: 'a', teacherId: 't1', grade: 'الثامن' },\n    { taskId: 'b', teacherId: 't1', grade: 'التاسع' },\n    { taskId: 'c', teacherId: 't1', grade: 'العاشر' },\n  ]);\n  assert.equal(violations.length, 1);\n  assert.equal(violations[0].teacherId, 't1');\n  assert.equal(violations[0].grades.length, 3);\n});\n\ntest('manual draft paths explicitly enforce the two-grade rule', async () => {\n  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');\n  assert.match(source, /canAssignGrade/);\n  assert.match(source, /gradeLimitViolations/);\n  assert.match(source, /حد الصفين/);\n  assert.match(source, /gradeLimitViolationCount/);\n  assert.match(source, /discardInvalidStoredDraft/);\n  assert.match(source, /تتجاوز سقف النصاب/);\n});\n";
const RELEASE_NOTES_SOURCE = "# Qistas v1.3.7 Fix 1 — حد صفّين + حماية المسودات القديمة\n\n## القاعدة الجديدة\nلا يجوز أن يتجاوز أي معلم صفّين دراسيين مختلفين في الخطة النهائية، مهما كان عدد الشعب داخل كل صف.\n\nأمثلة:\n- التاسع + العاشر: لا يضاف الثامن.\n- الثامن + التاسع: لا يضاف العاشر.\n- الثامن + العاشر: لا يضاف التاسع.\n- عدة شعب من الصف نفسه تحسب صفًا واحدًا فقط.\n\n## المسارات المشمولة\n- التوزيع التلقائي.\n- الإصلاح وإعادة الموازنة.\n- التحويرات المستخدمة لإنشاء النماذج البديلة.\n- التكليفات المثبتة.\n- نقل الشعبة يدويًا.\n- تبديل الشعب.\n- اعتماد المسودة: يمنع اعتماد أي خطة قديمة أو غير سليمة تتجاوز الحد.\n- عند فتح مسودة محفوظة قديمة تخالف حد الصفّين أو سقف النصاب، يتم إيقافها تلقائيًا وإرجاع المستخدم إلى شاشة النماذج مع رسالة واضحة بدل عرضها كخطة سليمة.\n\n## الاختبارات\nتضيف الحزمة اختبارات صريحة لقاعدة الصفّين، ويقوم المثبت بتشغيل:\n- node --check\n- npm test\n- npm run build\n\nإذا فشل أي فحص يعيد المثبت الملفات الأصلية تلقائيًا.\n";

const root = process.cwd();

function fail(message) {
  throw new Error(message);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) fail(`لم أجد موضع التعديل المطلوب: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    fail(`موضع التعديل غير فريد: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceAllChecked(source, before, after, minimum, label) {
  const count = source.split(before).length - 1;
  if (count < minimum) fail(`عدد مواضع ${label} أقل من المتوقع (${count}).`);
  return source.split(before).join(after);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    fail(`فشل الأمر: ${command} ${args.join(' ')}`);
  }
}

const packageJsonPath = path.join(root, 'package.json');
if (!fs.existsSync(packageJsonPath)) fail('شغّل المثبت من جذر مستودع قِسطاس.');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
if (packageJson.name !== 'qistas') fail('هذا المجلد لا يبدو مستودع قِسطاس.');

const existingPaths = [
  'src/engine/distribution.js',
  'src/app.js',
  'package.json',
];
for (const relative of existingPaths) {
  if (!fs.existsSync(path.join(root, relative))) fail(`الملف غير موجود: ${relative}`);
}

const backup = new Map(existingPaths.map((relative) => [relative, read(relative)]));
const newPaths = [
  'src/domain/gradeLimit.js',
  'tests/grade-limit.test.js',
  'RELEASE_NOTES_v1.3.7_FIX1.md',
];

try {
  let distribution = read('src/engine/distribution.js');

  distribution = replaceOnce(
    distribution,
    "import { compareGrades } from '../domain/grades.js';",
    `import { compareGrades } from '../domain/grades.js';
import {
  canAssignGrade,
  MAX_GRADES_PER_TEACHER,
} from '../domain/gradeLimit.js';`,
    'استيراد قاعدة الصفين',
  );

  distribution = replaceOnce(
    distribution,
    `.filter((teacher) => !frozenTeacherIds.has(teacher.id) && isEligible(teacher, task))`,
    `.filter((teacher) => (
        !frozenTeacherIds.has(teacher.id)
        && isEligible(teacher, task)
        && canAssignGrade(assignments, teacher.id, task.grade)
      ))`,
    'مرشحو التوزيع التلقائي',
  );

  distribution = replaceOnce(
    distribution,
    `function repairAssignmentsView(state) {`,
    `function repairGradeAssignments(state) {
  const assignments = [];
  for (const [taskId, teacherId] of state.placements) {
    const task = state.taskById.get(taskId);
    if (task) assignments.push({ taskId, teacherId, grade: task.grade });
  }
  return assignments;
}

function canPlaceTaskForTeacher(state, task, teacherId, excludingTaskIds = []) {
  return canAssignGrade(
    repairGradeAssignments(state),
    teacherId,
    task.grade,
    { excludingTaskIds },
  );
}

function repairAssignmentsView(state) {`,
    'مساعدات حد الصفين في الإصلاح',
  );

  distribution = replaceOnce(
    distribution,
    `function assignTask(state, task, teacherId) {
  const previousTeacherId = state.placements.get(task.id);
  if (previousTeacherId) {
    state.loads.set(
      previousTeacherId,
      Math.max(0, (state.loads.get(previousTeacherId) ?? 0) - task.periods),
    );
  }
  state.placements.set(task.id, teacherId);
  state.loads.set(teacherId, (state.loads.get(teacherId) ?? 0) + task.periods);
}`,
    `function assignTask(state, task, teacherId) {
  if (!canPlaceTaskForTeacher(state, task, teacherId, [task.id])) return false;
  const previousTeacherId = state.placements.get(task.id);
  if (previousTeacherId) {
    state.loads.set(
      previousTeacherId,
      Math.max(0, (state.loads.get(previousTeacherId) ?? 0) - task.periods),
    );
  }
  state.placements.set(task.id, teacherId);
  state.loads.set(teacherId, (state.loads.get(teacherId) ?? 0) + task.periods);
  return true;
}`,
    'حارس الإسناد داخل الإصلاح',
  );

  distribution = replaceOnce(
    distribution,
    `.filter((teacher) => (
      !excludedTeacherIds.has(teacher.id)
      && !state.frozenTeacherIds.has(teacher.id)
      && isEligible(teacher, task)
    ))`,
    `.filter((teacher) => (
      !excludedTeacherIds.has(teacher.id)
      && !state.frozenTeacherIds.has(teacher.id)
      && isEligible(teacher, task)
      && canPlaceTaskForTeacher(state, task, teacher.id)
    ))`,
    'مرشحو إصلاح التوزيع',
  );

  distribution = replaceOnce(
    distribution,
    `return state.activeTeachers.filter((teacher) => (
    teacher.id !== excludedTeacherId
    && !state.frozenTeacherIds.has(teacher.id)
    && isEligible(teacher, task)
  )).length;`,
    `return state.activeTeachers.filter((teacher) => (
    teacher.id !== excludedTeacherId
    && !state.frozenTeacherIds.has(teacher.id)
    && isEligible(teacher, task)
    && canPlaceTaskForTeacher(state, task, teacher.id)
  )).length;`,
    'عدد البدائل أثناء النقل الذكي',
  );

  distribution = replaceOnce(
    distribution,
    `  if (direct) {
    assignTask(state, task, direct.teacher.id);
    return true;
  }`,
    `  if (direct && assignTask(state, task, direct.teacher.id)) {
    return true;
  }`,
    'الإسناد المباشر في الإصلاح',
  );

  distribution = replaceOnce(
    distribution,
    `      assignTask(state, task, candidate.teacher.id);
      let relocated = true;`,
    `      if (!assignTask(state, task, candidate.teacher.id)) {
        restoreRepairState(state, snapshot);
        continue;
      }
      let relocated = true;`,
    'الإسناد بعد إخلاء السعة',
  );

  distribution = replaceOnce(
    distribution,
    `  const assignedTaskIds = [...placements.keys()].filter((taskId) => !lockedTaskIds.has(taskId));`,
    `  const placementGradeAssignments = () => [...placements].flatMap(([taskId, teacherId]) => {
    const task = taskById.get(taskId);
    return task ? [{ taskId, teacherId, grade: task.grade }] : [];
  });

  const assignedTaskIds = [...placements.keys()].filter((taskId) => !lockedTaskIds.has(taskId));`,
    'عرض الإسنادات للتحوير',
  );

  distribution = replaceOnce(
    distribution,
    `          return isEligible(teacherA, taskB)
            && isEligible(teacherB, taskA)
            && loadA - taskA.periods + taskB.periods <= teacherMaxLoad(teacherA, settings)
            && loadB - taskB.periods + taskA.periods <= teacherMaxLoad(teacherB, settings);`,
    `          const gradeAssignments = placementGradeAssignments();
          return isEligible(teacherA, taskB)
            && isEligible(teacherB, taskA)
            && canAssignGrade(
              gradeAssignments,
              teacherAId,
              taskB.grade,
              { excludingTaskIds: [taskA.id] },
            )
            && canAssignGrade(
              gradeAssignments,
              teacherBId,
              taskA.grade,
              { excludingTaskIds: [taskB.id] },
            )
            && loadA - taskA.periods + taskB.periods <= teacherMaxLoad(teacherA, settings)
            && loadB - taskB.periods + taskA.periods <= teacherMaxLoad(teacherB, settings);`,
    'تبديل التحوير',
  );

  distribution = replaceOnce(
    distribution,
    `      return (loads.get(teacher.id) ?? 0) + taskA.periods <= teacherMaxLoad(teacher, settings);`,
    `      return canAssignGrade(placementGradeAssignments(), teacher.id, taskA.grade)
        && (loads.get(teacher.id) ?? 0) + taskA.periods <= teacherMaxLoad(teacher, settings);`,
    'نقل التحوير',
  );

  distribution = replaceOnce(
    distribution,
    `  const overloadCount = summaries.filter((summary) => summary.load > summary.maxLoad).length;
  const flexiblePeriodsCount = summaries.reduce((sum, item) => sum + item.flexiblePeriods, 0);`,
    `  const overloadCount = summaries.filter((summary) => summary.load > summary.maxLoad).length;
  const gradeLimitViolationCount = summaries.filter(
    (summary) => summary.gradeCount > MAX_GRADES_PER_TEACHER,
  ).length;
  const flexiblePeriodsCount = summaries.reduce((sum, item) => sum + item.flexiblePeriods, 0);`,
    'قياس تجاوز حد الصفين',
  );

  distribution = replaceOnce(
    distribution,
    `    + overloadCount * 20_000
    + utilizationVariance * 4_000`,
    `    + overloadCount * 20_000
    + gradeLimitViolationCount * 1_000_000
    + utilizationVariance * 4_000`,
    'عقوبة تجاوز حد الصفين',
  );

  distribution = replaceOnce(
    distribution,
    `    overloadCount,
    flexiblePeriodsCount,`,
    `    overloadCount,
    gradeLimitViolationCount,
    flexiblePeriodsCount,`,
    'إخراج مقياس حد الصفين',
  );

  distribution = replaceOnce(
    distribution,
    `    if (summary.load > summary.maxLoad) {
      warnings.push(\`يوجد معلم تجاوز النصاب الأعلى المحدد (\${summary.maxLoad}).\`);
    }`,
    `    if (summary.load > summary.maxLoad) {
      warnings.push(\`يوجد معلم تجاوز النصاب الأعلى المحدد (\${summary.maxLoad}).\`);
    }
    if (summary.gradeCount > MAX_GRADES_PER_TEACHER) {
      warnings.push('يوجد معلم أُسندت إليه أكثر من صفين دراسيين مختلفين.');
    }`,
    'تحذير حد الصفين',
  );

  distribution = replaceOnce(
    distribution,
    `    const nextLoad = (loads.get(teacher.id) ?? 0) + task.periods;`,
    `    if (!canAssignGrade(assignments, teacher.id, task.grade)) {
      errors.push(\`\${teacher.name}: لا يمكن تثبيت أكثر من صفين دراسيين مختلفين للمعلم الواحد.\`);
      continue;
    }
    const nextLoad = (loads.get(teacher.id) ?? 0) + task.periods;`,
    'التحقق من التكليفات المثبتة',
  );

  distribution = replaceOnce(
    distribution,
    `  const complete = unique.filter((model) => model.unassigned.length === 0 && model.overloadCount === 0);`,
    `  const complete = unique.filter((model) => (
    model.unassigned.length === 0
    && model.overloadCount === 0
    && model.gradeLimitViolationCount === 0
  ));`,
    'فلترة النماذج المكتملة',
  );

  distribution = replaceOnce(
    distribution,
    `(model) => model.unassigned.length === 0 && model.overloadCount === 0,`,
    `(model) => (
        model.unassigned.length === 0
        && model.overloadCount === 0
        && model.gradeLimitViolationCount === 0
      ),`,
    'إحصاء النماذج المكتملة',
  );

  let app = read('src/app.js');

  app = replaceOnce(
    app,
    `} from './engine/distribution.js';`,
    `} from './engine/distribution.js';
import { canAssignGrade, gradeLimitViolations } from './domain/gradeLimit.js';`,
    'استيراد قاعدة الصفين في الواجهة',
  );

  app = replaceOnce(
    app,
    `      candidate.transferStatus !== ASSIGNMENT_STATUS.FORBIDDEN
      && candidate.projectedLoad <= candidate.maxLoad`,
    `      candidate.transferStatus !== ASSIGNMENT_STATUS.FORBIDDEN
      && candidate.projectedLoad <= candidate.maxLoad
      && canAssignGrade(
        state.draft.scenario.assignments,
        candidate.teacher.id,
        assignment.grade,
      )`,
    'مرشحو النقل اليدوي',
  );

  app = replaceOnce(
    app,
    `      candidate
      && candidate.sourcePlacement.transferStatus !== ASSIGNMENT_STATUS.FORBIDDEN
      && candidate.targetPlacement.transferStatus !== ASSIGNMENT_STATUS.FORBIDDEN`,
    `      candidate
      && candidate.sourcePlacement.transferStatus !== ASSIGNMENT_STATUS.FORBIDDEN
      && candidate.targetPlacement.transferStatus !== ASSIGNMENT_STATUS.FORBIDDEN
      && canAssignGrade(
        scenario.assignments,
        candidate.teacher.id,
        assignment.grade,
        { excludingTaskIds: [candidate.assignment.taskId] },
      )
      && canAssignGrade(
        scenario.assignments,
        sourceTeacher.id,
        candidate.assignment.grade,
        { excludingTaskIds: [assignment.taskId] },
      )`,
    'مرشحو تبديل الشعب',
  );

  app = replaceOnce(
    app,
    `  if (draft.scenario.unassigned.length) {`,
    `  const gradeViolations = gradeLimitViolations(draft.scenario.assignments);
  if (gradeViolations.length) {
    draft.approved = false;
    draft.notice = 'لا يمكن اعتماد الخطة: يجب ألا يتجاوز أي معلم صفين دراسيين مختلفين.';
    draft.noticeType = 'warning';
    persistDraft();
    render();
    return;
  }
  if (draft.scenario.overloadCount > 0) {
    draft.approved = false;
    draft.notice = 'لا يمكن اعتماد الخطة: يوجد معلم أو أكثر يتجاوز سقف النصاب المحدد.';
    draft.noticeType = 'warning';
    persistDraft();
    render();
    return;
  }
  if (draft.scenario.unassigned.length) {`,
    'حارس اعتماد المسودة',
  );

  app = replaceOnce(
    app,
    `      model.unassigned.length === 0 && model.overloadCount === 0
    ));`,
    `      model.unassigned.length === 0
      && model.overloadCount === 0
      && model.gradeLimitViolationCount === 0
    ));`,
    'اختيار نموذج إعادة التوزيع',
  );

  app = replaceOnce(
    app,
    `draft.notice = 'تعذر النقل: المعلم البديل خارج النطاق أو سيجاوز سقف النصاب.';`,
    `draft.notice = 'تعذر النقل: المعلم البديل خارج النطاق، أو سيجاوز سقف النصاب، أو بلغ حد الصفين.';`,
    'رسالة فشل النقل',
  );

  app = replaceOnce(
    app,
    `'<div class="alert warning">لا يوجد معلم بديل مسموح له بهذه الشعبة ولديه سعة كافية.</div>'`,
    `'<div class="alert warning">لا يوجد معلم بديل مسموح له بهذه الشعبة ولديه سعة كافية ولا يتجاوز حد الصفين.</div>'`,
    'رسالة عدم وجود بديل',
  );

  app = replaceAllChecked(
    app,
    `scenario.unassigned.length === 0 && scenario.overloadCount === 0`,
    `scenario.unassigned.length === 0
          && scenario.overloadCount === 0
          && scenario.gradeLimitViolationCount === 0`,
    2,
    'إحصاءات النماذج المكتملة في الواجهة',
  );

  app = replaceOnce(
    app,
    `repairCurrentTeacherPlaceholders();
render();`,
    `function discardInvalidStoredDraft() {
  const draft = state.draft;
  if (!draft?.scenario) return;

  const evaluated = evaluateScenario(
    state.data.teachers,
    state.data.requirements,
    state.data.settings,
    draft.scenario.assignments || [],
    draft.scenario.unassigned || [],
    {
      id: 'draft-plan',
      label: draft.approved ? 'الخطة المعتمدة' : 'الخطة قيد التعديل',
      tag: draft.approved ? 'معتمدة' : 'مسودة',
      description: draft.scenario.description || 'خطة محفوظة من إصدار سابق.',
      relocationCount: draft.scenario.relocationCount,
      repairedCount: draft.scenario.repairedCount,
    },
  );

  if (evaluated.gradeLimitViolationCount === 0 && evaluated.overloadCount === 0) {
    state.draft.scenario = evaluated;
    persistDraft();
    return;
  }

  state.draft = null;
  state.resultView = 'models';
  state.step = 2;
  state.errors = [
    evaluated.gradeLimitViolationCount > 0
      ? 'تم إيقاف مسودة محفوظة قديمة لأنها تسند أكثر من صفين دراسيين لمعلم واحد.'
      : 'تم إيقاف مسودة محفوظة قديمة لأنها تتجاوز سقف النصاب الحالي.',
  ];
  clearWorkspace();
}

repairCurrentTeacherPlaceholders();
discardInvalidStoredDraft();
render();`,
    'حماية المسودات القديمة عند بدء التطبيق',
  );

  app = replaceOnce(
    app,
    `الإصدار 1.3.6 · تبديل الشعب بين المعلمين`,
    `الإصدار 1.3.7 · حد صفّين لكل معلم`,
    'شارة الإصدار',
  );

  let packageSource = read('package.json');
  packageSource = replaceOnce(
    packageSource,
    `"version": "1.3.6"`,
    `"version": "1.3.7"`,
    'رقم الإصدار',
  );

  write('src/engine/distribution.js', distribution);
  write('src/app.js', app);
  write('package.json', packageSource);
  write('src/domain/gradeLimit.js', GRADE_LIMIT_SOURCE);
  write('tests/grade-limit.test.js', GRADE_LIMIT_TEST_SOURCE);
  write('RELEASE_NOTES_v1.3.7_FIX1.md', RELEASE_NOTES_SOURCE);

  run('node', ['--check', 'src/domain/gradeLimit.js']);
  run('node', ['--check', 'src/engine/distribution.js']);
  run('node', ['--check', 'src/app.js']);
  run('node', ['--test', 'tests/grade-limit.test.js']);
  run('npm', ['test']);
  run('npm', ['run', 'build']);

  console.log('\nPASS: Qistas v1.3.7 Fix 1 installed and verified.');
  console.log('Changed files:');
  console.log(' - src/domain/gradeLimit.js');
  console.log(' - src/engine/distribution.js');
  console.log(' - src/app.js');
  console.log(' - tests/grade-limit.test.js');
  console.log(' - package.json');
  console.log(' - RELEASE_NOTES_v1.3.7_FIX1.md');
} catch (error) {
  for (const [relative, content] of backup) write(relative, content);
  for (const relative of newPaths) {
    const target = path.join(root, relative);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
  console.error(`\nROLLBACK: ${error.message}`);
  console.error('تمت إعادة الملفات الأصلية. لم تُترك تعديلات جزئية.');
  process.exit(1);
}
