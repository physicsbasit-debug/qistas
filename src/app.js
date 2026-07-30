import { seedData } from './data/seed.js';
import { generateAllScenarios, validateInputs } from './engine/distribution.js';
import { clearAppData, clone, loadAppData, saveAppData } from './services/storage.js';
import { exportScenarioCsv } from './services/export.js';
import { requestGeminiReview } from './services/geminiReview.js';

const app = document.querySelector('#app');
let state = { step: 0, data: loadAppData(seedData), scenarios: [], selectedId: 'balanced', errors: [], gemini: null, geminiError: '', geminiLoading: false };
const esc = (v='') => String(v).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
const totalPeriods = () => state.data.requirements.reduce((s, i) => s + Number(i.sections)*Number(i.periodsPerSection), 0);
const totalSections = () => state.data.requirements.reduce((s, i) => s + Number(i.sections), 0);
const selected = () => state.scenarios.find((s) => s.id === state.selectedId) || state.scenarios[0];

function persistRender() { saveAppData(state.data); render(); }
function input(path, value) {
  const [kind, id, field] = path.split(':');
  if (kind === 'root') state.data[field] = value;
  if (kind === 'teacher') {
    const t = state.data.teachers.find((x) => x.id === id); if (!t) return;
    if (['minLoad','targetLoad','maxLoad'].includes(field)) t[field] = Number(value);
    else if (field === 'allowedSubjects') t[field] = value.split(/[،,]/).map((x) => x.trim()).filter(Boolean);
    else t[field] = value;
  }
  if (kind === 'req') {
    const r = state.data.requirements.find((x) => x.id === id); if (!r) return;
    r[field] = ['sections','periodsPerSection'].includes(field) ? Number(value) : value;
  }
  saveAppData(state.data);
}

function setupPanel() { return `<section class="panel stack-lg"><div><p class="eyebrow">الخطوة الأولى</p><h2>بيانات الخطة</h2><p class="muted">سمِّ المدرسة والقسم، ثم انتقل إلى المعلمين والمتطلبات.</p></div><div class="form-grid two"><label>اسم المدرسة<input data-path="root::schoolName" value="${esc(state.data.schoolName)}"></label><label>القسم أو المجال<input data-path="root::departmentName" value="${esc(state.data.departmentName)}"></label></div><div class="kpi-grid"><article class="kpi"><span>المعلمون النشطون</span><strong>${state.data.teachers.filter(x=>x.active).length}</strong></article><article class="kpi"><span>بنود المتطلبات</span><strong>${state.data.requirements.length}</strong></article><article class="kpi"><span>إجمالي الحصص</span><strong>${totalPeriods()}</strong></article></div><div class="note">البيانات محفوظة محليًا في هذا المتصفح. مفتاح Gemini لا يدخل الواجهة مطلقًا.</div></section>`; }

function teachersPanel() { return `<section class="panel stack-lg"><div class="section-heading"><div><p class="eyebrow">الخطوة الثانية</p><h2>المعلمون والأنصبة</h2><p class="muted">التخصصات الإضافية تُفصل بفاصلة.</p></div><button class="button secondary" data-action="add-teacher">إضافة معلم</button></div><div class="table-wrap"><table><thead><tr><th>الاسم</th><th>التخصص</th><th>مواد إضافية مسموحة</th><th>الأدنى</th><th>المستهدف</th><th>الأعلى</th><th>معلم أول</th><th>نشط</th><th></th></tr></thead><tbody>${state.data.teachers.map(t=>`<tr><td><input data-path="teacher:${t.id}:name" value="${esc(t.name)}"></td><td><input data-path="teacher:${t.id}:specialty" value="${esc(t.specialty)}"></td><td><input data-path="teacher:${t.id}:allowedSubjects" value="${esc(t.allowedSubjects.join('، '))}"></td>${['minLoad','targetLoad','maxLoad'].map(f=>`<td><input class="number" type="number" min="0" data-path="teacher:${t.id}:${f}" value="${t[f]}"></td>`).join('')}<td><input type="checkbox" data-check="teacher:${t.id}:isLead" ${t.isLead?'checked':''}></td><td><input type="checkbox" data-check="teacher:${t.id}:active" ${t.active?'checked':''}></td><td><button class="icon-button danger" data-action="delete-teacher" data-id="${t.id}">×</button></td></tr>`).join('')}</tbody></table></div></section>`; }

function reqPanel() { return `<section class="panel stack-lg"><div class="section-heading"><div><p class="eyebrow">الخطوة الثالثة</p><h2>الصفوف والمواد</h2><p class="muted">كل سطر يحدد صفًا ومادة وعدد الشعب وحصص الشعبة.</p></div><button class="button secondary" data-action="add-req">إضافة متطلب</button></div><div class="table-wrap compact-table"><table><thead><tr><th>الصف</th><th>المادة</th><th>الشعب</th><th>حصص الشعبة</th><th>الإجمالي</th><th></th></tr></thead><tbody>${state.data.requirements.map(r=>`<tr><td><input data-path="req:${r.id}:grade" value="${esc(r.grade)}"></td><td><input data-path="req:${r.id}:subject" value="${esc(r.subject)}"></td><td><input class="number" type="number" min="1" data-path="req:${r.id}:sections" value="${r.sections}"></td><td><input class="number" type="number" min="1" data-path="req:${r.id}:periodsPerSection" value="${r.periodsPerSection}"></td><td><strong>${Number(r.sections)*Number(r.periodsPerSection)}</strong></td><td><button class="icon-button danger" data-action="delete-req" data-id="${r.id}">×</button></td></tr>`).join('')}</tbody></table></div></section>`; }

function resultsPanel() {
  const s=selected();
  const scenarioCards=state.scenarios.map(x=>`<button class="scenario-card ${x.id===state.selectedId?'selected':''}" data-action="select-scenario" data-id="${x.id}"><span class="scenario-title">${x.label}</span><span>${x.description}</span><div class="scenario-metrics"><small>غير مسند: ${x.unassigned.length}</small><small>تجاوز: ${x.overloadCount}</small><small>خارج التخصص: ${x.outsideSpecialtyCount}</small></div></button>`).join('');
  const summary=s?`<div class="panel stack-lg print-area"><div class="section-heading"><div><h2>${s.label}</h2><p class="muted">${s.description}</p></div><div class="actions no-print"><button class="button secondary" data-action="export">تصدير CSV</button><button class="button secondary" data-action="print">طباعة / PDF</button></div></div><div class="kpi-grid four"><article class="kpi"><span>الشعب المسندة</span><strong>${s.assignments.length}</strong></article><article class="kpi"><span>غير المسندة</span><strong>${s.unassigned.length}</strong></article><article class="kpi"><span>تجاوز النصاب</span><strong>${s.overloadCount}</strong></article><article class="kpi"><span>تفاوت الأنصبة</span><strong>${s.variance.toFixed(1)}</strong></article></div>${s.warnings.length?`<div class="alert warning"><ul>${s.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}<div class="teacher-results">${s.summaries.map(sum=>{const t=state.data.teachers.find(x=>x.id===sum.teacherId); if(!t)return''; const status=sum.load>t.maxLoad?'over':sum.load<t.minLoad?'under':'ok'; return `<article class="teacher-card"><header><div><h3>${esc(t.name)}</h3><p>${esc(t.specialty)}${t.isLead?' · معلم أول':''}</p></div><span class="load-badge ${status}">${sum.load} حصة</span></header><div class="chips">${sum.assignments.map(a=>`<span>${esc(a.grade)} / ${a.section} · ${esc(a.subject)} (${a.periods})</span>`).join('')}</div></article>`;}).join('')}</div></div>`:'';
  const gemini=state.gemini?`<div class="ai-review"><h3>${esc(state.gemini.summary)}</h3><div class="review-columns">${[['نقاط القوة',state.gemini.strengths],['تنبيهات',state.gemini.warnings],['إجراءات مقترحة',state.gemini.suggestedActions]].map(([h,arr])=>`<div><strong>${h}</strong><ul>${(arr||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div></div>`:'';
  return `<section class="stack-lg"><div class="panel hero-result"><div><p class="eyebrow">الخطوة الرابعة</p><h2>التوليد والمراجعة</h2><p class="muted">المحرك يولد السيناريوهات، ثم يمكن لـGemini مراجعتها فقط.</p></div><button class="button primary" data-action="generate">توليد التوزيع</button></div>${state.errors.length?`<div class="alert error"><strong>تحقق من البيانات:</strong><ul>${state.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:''}${state.scenarios.length?`<div class="scenario-grid">${scenarioCards}</div>${summary}<div class="panel ai-panel no-print"><div><p class="eyebrow">مراجعة اختيارية</p><h2>تحليل Gemini</h2><p class="muted">يراجع المؤشرات ويشرح السيناريو الأنسب، ولا يعدل الحسابات.</p></div><details><summary>إعدادات الاتصال الآمن</summary><div class="form-grid two top-gap"><label>رابط Supabase<input id="supabase-url" value="${esc(localStorage.getItem('qistas:supabase-url')||'')}"></label><label>مفتاح Supabase anon<input id="supabase-key" type="password" value="${esc(localStorage.getItem('qistas:supabase-anon-key')||'')}"></label></div><button class="button secondary top-gap" data-action="save-ai-settings">حفظ الإعدادات</button></details><button class="button ai" data-action="gemini" ${state.geminiLoading?'disabled':''}>${state.geminiLoading?'جارٍ التحليل…':'مراجعة السيناريوهات'}</button>${state.geminiError?`<div class="alert error">${esc(state.geminiError)}</div>`:''}${gemini}</div>`:''}</section>`;
}

function render() {
  const steps=['الإعداد','المعلمون','المتطلبات','النتائج'];
  app.innerHTML=`<div class="app-shell"><header class="app-header"><div class="brand-mark">ق</div><div class="brand-copy"><p>قِسطاس</p><span>أنصبة موزونة، توزيع أذكى</span></div><div class="header-actions"><button class="text-button" data-action="reset">استعادة المثال</button></div></header><main><section class="intro"><div><span class="status-pill">نسخة تشغيلية أولى</span><h1>وزّع الأنصبة والشعب<br>بمحرك ذكي يمكن مراجعته.</h1><p>أدخل المعلمين والمتطلبات، اضبط النصاب، ثم قارن ثلاثة سيناريوهات صحيحة حسابيًا.</p></div><div class="intro-stat"><span>الحصص المطلوبة</span><strong>${totalPeriods()}</strong><small>${totalSections()} تكليفًا صفّيًا</small></div></section><nav class="step-nav">${steps.map((x,i)=>`<button class="step-item ${state.step===i?'active':''}" data-action="step" data-id="${i}"><span>${i+1}</span>${x}</button>`).join('')}</nav>${state.step===0?setupPanel():state.step===1?teachersPanel():state.step===2?reqPanel():resultsPanel()}<div class="footer-nav no-print"><button class="button secondary" data-action="prev" ${state.step===0?'disabled':''}>السابق</button><button class="button primary" data-action="next">${state.step<3?'التالي':'تحديث التوزيع'}</button></div></main></div>`;
}

app.addEventListener('input', (e)=>{ if(e.target.dataset.path) input(e.target.dataset.path,e.target.value); });
app.addEventListener('change', (e)=>{ if(e.target.dataset.path){ input(e.target.dataset.path,e.target.value); render(); return; } if(e.target.dataset.check){ const [kind,id,field]=e.target.dataset.check.split(':'); const t=state.data.teachers.find(x=>x.id===id); if(t)t[field]=e.target.checked; persistRender(); }});
app.addEventListener('click', async (e)=>{
  const b=e.target.closest('[data-action]'); if(!b)return; const a=b.dataset.action;
  if(a==='step'){state.step=Number(b.dataset.id);render();}
  if(a==='prev'){state.step=Math.max(0,state.step-1);render();}
  if(a==='next'){if(state.step<3){state.step++;render();}else generate();}
  if(a==='reset'){clearAppData();state={step:0,data:clone(seedData),scenarios:[],selectedId:'balanced',errors:[],gemini:null,geminiError:'',geminiLoading:false};persistRender();}
  if(a==='add-teacher'){state.data.teachers.push({id:uid(),name:'',specialty:'',allowedSubjects:[],minLoad:14,targetLoad:16,maxLoad:18,isLead:false,active:true});persistRender();}
  if(a==='delete-teacher'){state.data.teachers=state.data.teachers.filter(x=>x.id!==b.dataset.id);persistRender();}
  if(a==='add-req'){state.data.requirements.push({id:uid(),grade:'',subject:'',sections:1,periodsPerSection:1});persistRender();}
  if(a==='delete-req'){state.data.requirements=state.data.requirements.filter(x=>x.id!==b.dataset.id);persistRender();}
  if(a==='generate')generate();
  if(a==='select-scenario'){state.selectedId=b.dataset.id;render();}
  if(a==='export'&&selected())exportScenarioCsv(selected(),state.data.teachers);
  if(a==='print')window.print();
  if(a==='save-ai-settings'){localStorage.setItem('qistas:supabase-url',document.querySelector('#supabase-url').value.trim());localStorage.setItem('qistas:supabase-anon-key',document.querySelector('#supabase-key').value.trim());b.textContent='تم الحفظ';}
  if(a==='gemini'){state.geminiLoading=true;state.geminiError='';render();try{state.gemini=await requestGeminiReview(state.data,state.scenarios);if(state.gemini.recommendedScenario!=='none')state.selectedId=state.gemini.recommendedScenario;}catch(err){state.geminiError=err instanceof Error?err.message:'تعذرت المراجعة.';}finally{state.geminiLoading=false;render();}}
});
function generate(){state.errors=validateInputs(state.data.teachers,state.data.requirements);state.gemini=null;state.geminiError='';if(!state.errors.length){state.scenarios=generateAllScenarios(state.data.teachers,state.data.requirements);state.selectedId=[...state.scenarios].sort((a,b)=>a.score-b.score)[0]?.id||'balanced';}render();}
render();
