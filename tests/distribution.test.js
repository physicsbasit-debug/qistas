import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../src/data/seed.js';
import { expandRequirements, generateAllScenarios, validateInputs } from '../src/engine/distribution.js';

test('expands sections and totals 138 periods', () => {
  const tasks=expandRequirements(seedData.requirements);
  assert.equal(tasks.length,53);
  assert.equal(tasks.reduce((s,x)=>s+x.periods,0),138);
});
test('generates three scenarios',()=>assert.equal(generateAllScenarios(seedData.teachers,seedData.requirements).length,3));
test('science seed has no unassigned tasks',()=>{for(const s of generateAllScenarios(seedData.teachers,seedData.requirements)) assert.equal(s.unassigned.length,0);});
test('does not lose periods',()=>{const s=generateAllScenarios(seedData.teachers,seedData.requirements)[0];assert.equal(s.assignments.reduce((n,x)=>n+x.periods,0)+s.unassigned.reduce((n,x)=>n+x.periods,0),138);});
test('invalid load bounds are rejected',()=>{const bad=[{...seedData.teachers[0],minLoad:20,targetLoad:16,maxLoad:18}];assert.match(validateInputs(bad,seedData.requirements).join(' '),/الحد الأدنى/);});

test('balanced science scenario respects maximum loads',()=>{const s=generateAllScenarios(seedData.teachers,seedData.requirements)[0];assert.equal(s.overloadCount,0);});
test('balanced science scenario satisfies minimum loads when feasible',()=>{const s=generateAllScenarios(seedData.teachers,seedData.requirements)[0];assert.equal(s.underMinCount,0);});
test('all science scenarios stay within configured bounds',()=>{for(const s of generateAllScenarios(seedData.teachers,seedData.requirements)){assert.equal(s.overloadCount,0);assert.equal(s.underMinCount,0);}});
