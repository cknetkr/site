/* ────────────────────────────────────────────
   반도체설비보전기능사 모의고사 · app.main.js (v2)
   모드 전환: quizHeader.dataset.mode = 'learn' | 'exam'
   body 클래스 기반 CSS 충돌 구조 완전 제거
──────────────────────────────────────────── */

const PARTS_INDEX_FILE     = 'data/parts.json';
const TARGET_QUESTION_COUNT = 60;
const BASE_PICK_PER_TAG     = 3;
const EXAM_DURATION_SECONDS = 60 * 60;
const SUBJECT_PART_RANGES   = [[1,6],[7,11],[12,16]];
const THEME_KEY             = 'exam-site-theme';

let curQuestions        = [];
let chosen              = [];
let answered            = [];
let examMode            = false;
let examCursor          = 0;
let examRevealMode      = false;
let learnRevealMode     = true;
let examScopeIndices    = [];
let latestWrongNoteText = '';
let currentExamLabel    = '';
let currentMode         = 'learn';
let selectedSubjectIdx  = -1;
let selectedPartIndices = [];
let partsMetadata       = [];
let examTimerSecondsLeft  = EXAM_DURATION_SECONDS;
let examTimerIntervalId   = null;
let submitConfirmResolver = null;
let partsIndexCache       = null;
let partsMetadataCache    = null;
let partBanksCache        = null;
const partBankByIndexCache = new Map();

/* ── 유틸 ── */
function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}
function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function extractKeywords(text, maxCount=4) {
  const stop = new Set(['무엇','무엇이','무엇을','무엇은','어떤','어느','가장','다음','관련','경우','상황','위한','대한','에서','으로','한다','된다']);
  const tokens = String(text||'').replace(/[()\[\]{}?.,!~:;·/\\-]/g,' ')
    .split(/\s+/).map(t=>t.trim()).filter(t=>t.length>=2&&!stop.has(t));
  return [...new Set(tokens)].slice(0,maxCount).join(' ');
}

/* ── 테마 ── */
function applyTheme(theme) {
  document.body.classList.toggle('light-mode', theme==='light');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme==='light' ? '다크 모드' : '화이트 모드';
}
function initThemeToggle() {
  const btn = document.getElementById('themeToggle');
  applyTheme(localStorage.getItem(THEME_KEY)||'dark');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.body.classList.contains('light-mode') ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

/* ── 화면 전환 ── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
}

/* ── 타이머 ── */
function stopExamTimer() {
  if (examTimerIntervalId) { clearInterval(examTimerIntervalId); examTimerIntervalId=null; }
}
function updateTimerUI() {
  const t = document.getElementById('examTotalTime');
  const r = document.getElementById('examRemainTime');
  if (t) t.textContent = formatDuration(EXAM_DURATION_SECONDS);
  if (r) r.textContent = formatDuration(examMode ? examTimerSecondsLeft : EXAM_DURATION_SECONDS);
}
function resetExamTimer() { examTimerSecondsLeft = EXAM_DURATION_SECONDS; updateTimerUI(); }
function startExamTimer() {
  stopExamTimer(); updateTimerUI();
  examTimerIntervalId = setInterval(() => {
    if (!examMode) { stopExamTimer(); return; }
    examTimerSecondsLeft--;
    if (examTimerSecondsLeft <= 0) {
      examTimerSecondsLeft=0; updateTimerUI(); stopExamTimer();
      submitExamMode({skipConfirm:true}); return;
    }
    updateTimerUI();
  }, 1000);
}

/* ══════════════════════════════════════
   핵심: 모드 전환
   data-mode 속성 하나로 CSS가 표시/숨김 전담
   body 클래스 방식 완전 제거 → specificity 충돌 없음
══════════════════════════════════════ */
function setHeaderMode(mode) {
  const h = document.getElementById('quizHeader');
  if (h) h.dataset.mode = mode;
}

function updateExamModeUI() {
  const modeBtn      = document.getElementById('modeToggleBtn');
  const titleEl      = document.getElementById('hTitle');
  const learnWrap    = document.getElementById('learnRevealToggleWrap');
  const learnToggle  = document.getElementById('learnRevealToggle');
  const inlineActions      = document.querySelectorAll('.q-inline-actions');
  const revealSlots        = document.querySelectorAll('.q-reveal-slot');
  const inlineRevealInputs = document.querySelectorAll('.q-inline-reveal-input');
  const prevBtns           = document.querySelectorAll('.q-inline-prev');
  const nextBtns           = document.querySelectorAll('.q-inline-next');

  setHeaderMode(examMode ? 'exam' : 'learn');

  if (modeBtn) modeBtn.textContent = examMode ? '학습모드 가기' : '시험모드 가기';
  if (titleEl) titleEl.textContent = examMode ? '시험모드' : '학습모드';

  inlineActions.forEach(el => el.classList.toggle('is-visible', examMode));
  revealSlots.forEach(el => el.classList.toggle('is-visible', examMode));
  inlineRevealInputs.forEach(inp => { inp.checked=examRevealMode; inp.disabled=!examMode; });

  if (examMode) {
    const total = (examScopeIndices.length||curQuestions.length);
    prevBtns.forEach(b => { b.disabled = examCursor<=0; });
    nextBtns.forEach(b => { b.disabled = examCursor>=total-1; });
  }

  if (learnWrap) learnWrap.classList.toggle('is-hidden', examMode||currentMode!=='learn');
  if (learnToggle) { learnToggle.checked=learnRevealMode; learnToggle.disabled=examMode||currentMode!=='learn'; }

  updateTimerUI();
  updateProgress();
}

/* ── 선택지 뷰 ── */
function clearOptionExplanation(qi) {
  const exp = document.getElementById(`exp${qi}`);
  if (exp) exp.innerHTML='';
  for (let i=0;i<4;i++) {
    document.getElementById(`optWrap${qi}_${i}`)?.classList.remove('correct','wrong','locked','show-desc');
    const desc=document.getElementById(`optDesc${qi}_${i}`); if(desc) desc.innerHTML='';
    const trap=document.getElementById(`optTrap${qi}_${i}`); if(trap){trap.innerHTML='';trap.classList.remove('is-visible');}
    document.getElementById(`optCorr${qi}_${i}`)?.classList.remove('is-visible');
  }
}

function applyExamSelectionView(qi) {
  const q=curQuestions[qi]; if(!q) return;
  const picked=chosen[qi];
  for (let i=0;i<4;i++) {
    const w=document.getElementById(`optWrap${qi}_${i}`); if(!w) continue;
    w.classList.remove('selected','correct','wrong','locked','exam-picked');
    if(i===picked) w.classList.add('selected','exam-picked');
  }
  if (!examRevealMode||picked<0) { clearOptionExplanation(qi); return; }
  for (let i=0;i<4;i++) {
    const w=document.getElementById(`optWrap${qi}_${i}`); if(!w) continue;
    w.classList.add('locked');
    if(i===q.ans) w.classList.add('correct');
    else if(i===picked) w.classList.add('wrong');
  }
  showExplanation(qi);
}

function applyLearnSelectionView(qi) {
  const q=curQuestions[qi]; if(!q) return;
  const picked=chosen[qi]; const hasAns=answered[qi]&&picked>=0;
  clearOptionExplanation(qi);
  for (let i=0;i<4;i++) {
    const w=document.getElementById(`optWrap${qi}_${i}`); if(!w) continue;
    w.classList.remove('selected','correct','wrong','locked','exam-picked');
    if(i===picked) w.classList.add('selected');
    if(hasAns) w.classList.add('locked');
  }
  if (!hasAns||!learnRevealMode) return;
  for (let i=0;i<4;i++) {
    const w=document.getElementById(`optWrap${qi}_${i}`); if(!w) continue;
    if(i===q.ans) w.classList.add('correct');
    else if(i===picked) w.classList.add('wrong');
  }
  showExplanation(qi);
}

function refreshLearnRevealView() { for(let i=0;i<curQuestions.length;i++) applyLearnSelectionView(i); }
function toggleLearnRevealMode() { learnRevealMode=!!document.getElementById('learnRevealToggle')?.checked; if(currentMode==='learn') refreshLearnRevealView(); }
function toggleExamRevealModeInline(checked) {
  examRevealMode=!!checked;
  document.querySelectorAll('.q-inline-reveal-input').forEach(inp=>{inp.checked=examRevealMode;});
  if(examMode){const scope=examScopeIndices.length?examScopeIndices:curQuestions.map((_,i)=>i); applyExamSelectionView(scope[Math.min(examCursor,scope.length-1)]??0);}
}

/* ── 시험모드 이동 ── */
function syncExamModeQuestionView() {
  updateExamModeUI();
  if (!examMode) {
    const ab=document.querySelector('.sub-nav-btn.active');
    switchSubject(ab ? Array.from(document.querySelectorAll('.sub-nav-btn')).indexOf(ab) : 0);
    return;
  }
  const scope=examScopeIndices.length?examScopeIndices:curQuestions.map((_,i)=>i);
  const safe=Math.min(examCursor,Math.max(scope.length-1,0));
  const idx=scope[safe]??0;
  examCursor=safe;
  document.querySelectorAll('.q-block').forEach((b,i)=>{ b.style.display=i===idx?'block':'none'; });
  applyExamSelectionView(idx);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const t=document.getElementById(`qb${idx}`);
    if(t){const h=document.querySelector('.quiz-header'); const off=h?h.offsetHeight+8:80; window.scrollTo({top:Math.max(0,t.getBoundingClientRect().top+window.scrollY-off),behavior:'auto'});}
  }));
}

function moveExamQuestion(delta) {
  if(!examMode) return;
  const total=examScopeIndices.length||curQuestions.length;
  const next=examCursor+delta;
  if(next<0||next>=total) return;
  examCursor=next; syncExamModeQuestionView();
}

/* ── 모드 전환 ── */
function toggleExamMode() {
  if(!curQuestions.length) return;
  examMode=!examMode; examCursor=0;
  if(!examMode){stopExamTimer();examRevealMode=false;examScopeIndices=[];}
  else{examScopeIndices=curQuestions.map((_,i)=>i);resetExamTimer();startExamTimer();}
  syncExamModeQuestionView();
}

/* ── 제출 모달 ── */
function openSubmitConfirmModal() {
  const m=document.getElementById('submitConfirmModal');
  if(!m) return Promise.resolve(window.confirm('시험을 종료하고 제출할까요?'));
  m.classList.add('is-open');
  return new Promise(r=>{submitConfirmResolver=r;});
}
function closeSubmitConfirmModal(confirmed) {
  document.getElementById('submitConfirmModal')?.classList.remove('is-open');
  const r=submitConfirmResolver; submitConfirmResolver=null; if(r) r(!!confirmed);
}
async function submitExamMode(opts={}) {
  if(!examMode) return;
  if(!opts.skipConfirm){const ok=await openSubmitConfirmModal();if(!ok) return;}
  stopExamTimer(); showResult();
}

/* ── 선택 ── */
function pick(qi,oi) {
  if(examMode){chosen[qi]=oi;answered[qi]=true;applyExamSelectionView(qi);updateProgress();updateExamModeUI();return;}
  if(answered[qi]) return;
  chosen[qi]=oi;answered[qi]=true;applyLearnSelectionView(qi);
  document.getElementById(`qb${qi}`)?.classList.add('answered');
  updateProgress();
  if(answered.every(a=>a)) setTimeout(()=>showResult(),800);
}

/* ── 진행률 ── */
function updateProgress() {
  const total=curQuestions.length;
  const done=answered.filter(Boolean).length;
  const pos=Math.min(examCursor+1,Math.max(total,1));
  const pct=total>0?Math.round((examMode?pos:done)/total*100):0;
  const pFill=document.getElementById('pFill');
  const pLabel=document.getElementById('pLabel');
  if(pFill) pFill.style.width=pct+'%';
  if(pLabel){
    if(examMode){
      const ai=(examScopeIndices.length?examScopeIndices[examCursor]:examCursor)??0;
      const pn=curQuestions[ai]?.tag||'미분류';
      pLabel.classList.add('is-exam');
      pLabel.innerHTML=`<span class="p-part">파트: ${escapeHtml(pn)}</span><span class="p-total">${pos}/${total}</span>`;
      const pe=document.getElementById('examPartName'); if(pe) pe.textContent=`파트: ${pn}`;
      const ce=document.getElementById('examProgressCount'); if(ce) ce.textContent=`${pos}/${total}`;
    } else { pLabel.classList.remove('is-exam'); pLabel.textContent=''; }
  }
}

/* ── 해설 ── */
function showExplanation(qi) {
  const q=curQuestions[qi]; const expV2=q.explainV2||null;
  const optList=Array.isArray(expV2?.options)?expV2.options.map(x=>x?.desc||''):(Array.isArray(q.optWhy)?q.optWhy:[]);
  const concepts=Array.isArray(expV2?.coreConcepts)?expV2.coreConcepts:q.why;
  const tip=expV2?.tipFlow||q.tip;
  const rule=expV2?.eliminationRule||q.rule;
  const link=expV2?.linkInfo||q.linkInfo;

  q.opts.forEach((o,oi)=>{
    const w=document.getElementById(`optWrap${qi}_${oi}`);
    const d=document.getElementById(`optDesc${qi}_${oi}`);
    const tr=document.getElementById(`optTrap${qi}_${oi}`);
    const co=document.getElementById(`optCorr${qi}_${oi}`);
    const v2=Array.isArray(expV2?.options)?expV2.options[oi]:null;
    const why=(optList[oi]||'').replace(/^\[(정답|선택|오답)\]\s*/,'');
    if(d) d.innerHTML=why;
    tr?.classList.remove('is-visible'); co?.classList.remove('is-visible');
    if(oi===q.ans){co?.classList.add('is-visible');}
    else{
      let found=true;
      if(v2?.trap) tr.innerHTML=v2.trap;
      else if(/(구매|단가|BOM)/.test(why)) tr.innerHTML='함정: 구매 업무';
      else if(/(외관|색상|도장)/.test(why)) tr.innerHTML='함정: 외관 사양';
      else if(/(전원|전장|전기)/.test(why)) tr.innerHTML='함정: 전장/전기';
      else if(/(검사|수율)/.test(why)) tr.innerHTML='함정: 수율/검사';
      else found=false;
      if(found&&tr) tr.classList.add('is-visible');
    }
    if(w) w.classList.add('show-desc');
  });

  let why='';
  if(Array.isArray(concepts)) concepts.forEach(c=>{ why+=`<div class="concept"><div class="concept-title">${c.title}</div><div class="concept-desc">${c.desc}</div></div>`; });
  else if(concepts){const m=String(concepts).match(/^([^.?]+[.?])\s*(.*)$/); why=m?`<div class="concept"><div class="concept-title">${m[1].trim()}</div><div class="concept-desc">${m[2].trim()}</div></div>`:`<div class="concept"><div class="concept-title">핵심 개념</div><div class="concept-desc">${concepts}</div></div>`;}

  let steps='';
  if(tip){const ps=tip.split(/①|②|③|④|⑤/).filter(s=>s.trim());
    if(ps.length>1||tip.includes('①')) steps='<div class="steps">'+ps.map((p,i)=>`<div class="step-num">${i+1}</div><span class="step-text">${p.replace(/→/g,'').trim()}</span>${i<ps.length-1?'<span class="arrow">→</span>':''}`).join('')+'</div>';
    else steps=`<div class="step-text step-inline-note">${tip}</div>`;
  }

  let ruleHtml='';
  if(rule) ruleHtml=`<hr class="div"><div class="rule-box"><div class="rule-title">${rule.title}</div>${(rule.rows||[]).map(r=>`<div class="rule-row"><span class="rule-keyword">${r.keyword}</span><span class="rule-action">${r.action}</span></div>`).join('')}</div>`;

  const el=document.getElementById(`exp${qi}`);
  if(el) el.innerHTML=`<div class="card exp-card"><div class="section-label">핵심 개념</div>${why}</div><div class="card exp-card"><div class="section-label">강사 팁</div>${steps}${ruleHtml}${link?`<div class="link-box">${link}</div>`:''}</div>`;
}

/* ── 퀴즈 빌드 ── */
function buildQuiz() {
  const qs=curQuestions;
  const subjects=[{order:[],first:{},count:{},startIndex:0},{order:[],first:{},count:{},startIndex:20},{order:[],first:{},count:{},startIndex:40}];
  const localNo=new Array(qs.length).fill(0);
  qs.forEach((q,qi)=>{
    const si=currentMode==='learn'?Math.min(Math.max(Number.isInteger(q._subjectIndex)?q._subjectIndex:0,0),2):Math.min(Math.floor(qi/20),2);
    const sub=subjects[si];
    if(sub.first[q.tag]===undefined){sub.first[q.tag]=qi;sub.order.push(q.tag);}
    sub.count[q.tag]=(sub.count[q.tag]||0)+1;
    localNo[qi]=(sub.count.__localSeq||0)+1; sub.count.__localSeq=localNo[qi];
  });

  let html='';
  qs.forEach((q,qi)=>{
    const si=currentMode==='learn'?Math.min(Math.max(Number.isInteger(q._subjectIndex)?q._subjectIndex:0,0),2):Math.min(Math.floor(qi/20),2);
    const sub=subjects[si];
    const anchorId=sub.first[q.tag]===qi?`tag-anchor-${q.tag.replace(/[^가-힣a-zA-Z0-9]/g,'_')}_sub${si}`:'';
    const tc=q.type==='암기'?'memory':'understanding';
    const dn=currentMode==='learn'?localNo[qi]:(qi+1);
    html+=`<div class="q-block" id="qb${qi}" data-subidx="${si}" data-tag="${escapeHtml(q.tag||'미분류')}">
      ${anchorId?`<span id="${anchorId}" class="tag-anchor-spacer"></span>`:''}
      <div class="q-meta">
        <span class="q-num-badge">Q${dn}</span>
        <span class="q-tag">${escapeHtml(q.tag||'미분류')}</span>
        <span class="q-type ${tc}">${q.type||'이해'}</span>
        <div class="q-reveal-slot"><label class="q-inline-reveal" for="qIR${qi}"><input id="qIR${qi}" class="q-inline-reveal-input" type="checkbox" onchange="toggleExamRevealModeInline(this.checked)"><span>정답·해설</span></label></div>
        <div class="q-search-actions">
          <button class="q-search-btn youtube" onclick="openYouTubeSearch(${qi})" type="button"><svg class="q-search-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M21.8 8s-.2-1.4-.8-2c-.8-.8-1.6-.8-2-.9C16.8 5 12 5 12 5s-4.8 0-7 .1c-.4.1-1.2.1-2 .9-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.8.8 1.8.8 2.3.8C6.8 19 12 19 12 19s4.8 0 7-.2c.4-.1 1.2-.1 2-.8.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5C22 9.6 21.8 8 21.8 8zM9.7 14.5V9l5.4 2.8-5.4 2.7z"/></svg><span class="q-search-label">YouTube</span></button>
          <button class="q-search-btn gemini" onclick="openGeminiSearch(${qi})" type="button"><svg class="q-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg><span class="q-search-label">Gemini</span></button>
        </div>
      </div>
      <div class="q-text">${q.q}</div>
      <div class="opts">${q.opts.map((o,oi)=>`<div class="option" id="optWrap${qi}_${oi}" onclick="pick(${qi},${oi})"><div class="opt-no">${['①','②','③','④'][oi]}</div><div class="opt-body"><div class="opt-name">${o}<span class="trap" id="optTrap${qi}_${oi}"></span><span class="correct-label" id="optCorr${qi}_${oi}">정답</span></div><div class="opt-desc" id="optDesc${qi}_${oi}"></div></div></div>`).join('')}</div>
      <div class="q-inline-actions">
        <button class="q-inline-btn q-inline-prev" type="button" onclick="moveExamQuestion(-1)">이전</button>
        <button class="q-inline-btn q-inline-next" type="button" onclick="moveExamQuestion(1)">다음</button>
        <button class="q-inline-btn q-inline-submit" type="button" onclick="submitExamMode()">시험 제출</button>
      </div>
      <div class="common-exp" id="exp${qi}"></div>
    </div>`;
  });

  document.getElementById('quizBody').innerHTML=html;
  window.currentSubjects=subjects;
  renderSubjectNav();
  if(!examMode) switchSubject(0);
}

/* ── 네비 ── */
function renderSubjectNav() {
  const nav=document.getElementById('subjectNav'); if(!nav) return;
  nav.innerHTML='';
  ['1과목','2과목','3과목'].forEach((name,i)=>{
    if(!window.currentSubjects[i].order.length) return;
    const btn=document.createElement('button');
    btn.className='sub-nav-btn'+(i===0?' active':''); btn.textContent=name;
    btn.onclick=()=>{document.querySelectorAll('.sub-nav-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');switchSubject(i);};
    nav.appendChild(btn);
  });
}
function switchSubject(si) { if(examMode) return; renderTagNav(si); applyLearnFilter(si,''); window.scrollTo(0,0); }
function applyLearnFilter(si,tag) { document.querySelectorAll('.q-block').forEach(b=>{b.style.display=(b.dataset.subidx===String(si)&&(!tag||b.dataset.tag===tag))?'block':'none';}); }
function renderTagNav(si) {
  const nav=document.getElementById('tagNav'); if(!nav) return;
  nav.innerHTML='';
  const sub=window.currentSubjects[si]; if(!sub) return;
  sub.order.forEach(tag=>{
    const btn=document.createElement('button'); btn.className='tag-btn'; btn.dataset.tag=tag;
    btn.innerHTML=`<span class="tag-btn-dot"></span>${tag}<span class="tag-btn-cnt">${sub.count[tag]}</span>`;
    btn.onclick=()=>{document.querySelectorAll('.tag-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');applyLearnFilter(si,tag);window.scrollTo(0,0);};
    nav.appendChild(btn);
  });
}
function setupTagScrollSpy() {
  setTimeout(()=>{
    const obs=new IntersectionObserver(entries=>{entries.forEach(e=>{if(!e.isIntersecting) return; const m=e.target.id.match(/_sub(\d+)$/); const si=m?m[1]:'0'; document.querySelectorAll('.tag-btn').forEach(b=>b.classList.toggle('active',`tag-anchor-${b.dataset.tag.replace(/[^가-힣a-zA-Z0-9]/g,'_')}_sub${si}`===e.target.id));});},{rootMargin:'-80px 0px -60% 0px',threshold:0});
    document.querySelectorAll('[id^="tag-anchor-"]').forEach(el=>obs.observe(el));
  },200);
}

/* ── 검색 ── */
function openYouTubeSearch(qi) {
  const q=curQuestions[qi]; if(!q) return;
  window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent([q.tag,extractKeywords(q.q,4)].filter(Boolean).join(' '))}`, '_blank','noopener,noreferrer');
}
function openGeminiSearch(qi) {
  const q=curQuestions[qi]; if(!q) return;
  const query=String(q.q||'').trim();
  navigator.clipboard.writeText(query).then(()=>{alert('쿼리가 복사되었습니다. Gemini에 붙여넣기 하세요.');window.open('https://gemini.google.com/app','_blank');})
  .catch(()=>window.open(`https://gemini.google.com/app?q=${encodeURIComponent(query)}`,'_blank','noopener,noreferrer'));
}

/* ── 결과 ── */
function getQuestionTag(q){return q?.tag?.trim()||'미분류';}
function getCoreLine(q){return q?.explainV2?.coreConcepts?.[0]?.desc||q?.why?.[0]?.desc||q?.tip||'핵심 개념 복습이 필요한 문항입니다.';}
function buildWeakTagStats(qs,ch,an){
  const m={};
  qs.forEach((q,i)=>{if(!an[i]) return; const t=getQuestionTag(q); if(!m[t]) m[t]={attempted:0,wrong:0}; m[t].attempted++; if(ch[i]!==q.ans) m[t].wrong++;});
  return Object.entries(m).map(([tag,s])=>({tag,...s,accuracy:s.attempted?Math.round((s.attempted-s.wrong)/s.attempted*100):0})).sort((a,b)=>b.wrong!==a.wrong?b.wrong-a.wrong:a.accuracy-b.accuracy);
}
function buildWrongNoteItems(qs,ch,an){
  const nums=['①','②','③','④'];
  return qs.reduce((acc,q,i)=>{
    if(ch[i]===q.ans) return acc;
    const skip=!an[i]||ch[i]<0;
    acc.push({index:i+1,tag:getQuestionTag(q),type:q?.type||'이해',question:q?.q||'',isSkip:skip,myAnswerText:skip?'미응답':`${nums[ch[i]]||''} ${q.opts?.[ch[i]]||''}`.trim(),correctText:`${nums[q.ans]||''} ${q.opts?.[q.ans]||''}`.trim(),coreLine:getCoreLine(q)});
    return acc;
  },[]);
}
function buildWrongNoteText(label,score,notes,weakTags){
  const lines=[`[${label}] 오답노트`,`점수: ${score}점`];
  if(weakTags.length) lines.push('약점 태그: '+weakTags.slice(0,3).map(t=>`${t.tag}(오답 ${t.wrong})`).join(', '));
  lines.push('');
  notes.forEach(n=>{lines.push(`Q${n.index} [${n.tag}/${n.type}] ${n.isSkip?'미응답':'오답'}`,`문제: ${n.question}`,`내 답: ${n.myAnswerText}`,`정답: ${n.correctText}`,`핵심: ${n.coreLine}`,'');});
  return lines.join('\n').trim();
}
async function copyWrongNote(){
  if(!latestWrongNoteText) return;
  const btn=document.getElementById('copyWrongNoteBtn'); const orig=btn?.textContent||'';
  try{await navigator.clipboard.writeText(latestWrongNoteText);if(btn)btn.textContent='오답노트 복사 완료';}
  catch{if(btn)btn.textContent='복사 실패 (브라우저 권한 확인)';}
  finally{if(btn)setTimeout(()=>{btn.textContent=orig||'오답노트 복사';},1200);}
}

function showResult(){
  stopExamTimer();
  const qs=curQuestions;
  const scope=examMode?(examScopeIndices.length?examScopeIndices:qs.map((_,i)=>i)):qs.map((_,i)=>i);
  const total=scope.length;
  const correct=scope.filter(i=>answered[i]&&chosen[i]===qs[i].ans).length;
  const wrong=scope.filter(i=>answered[i]&&chosen[i]!==qs[i].ans).length;
  const skip=scope.filter(i=>!answered[i]).length;
  const score=Math.round(correct/total*100);
  const pass=score>=60;
  document.getElementById('resExamName').textContent=currentExamLabel||'모의고사';
  document.getElementById('resPct').textContent=score;
  document.getElementById('resGrade').textContent=pass?'✓ 합격권 (60점 이상)':'✗ 불합격권 (60점 미만)';
  document.getElementById('resGrade').className='result-grade '+(pass?'pass':'fail');
  document.getElementById('resCorrect').textContent=correct;
  document.getElementById('resWrong').textContent=wrong;
  document.getElementById('resSkip').textContent=skip;
  document.getElementById('scoreCircle').style.setProperty('--deg',Math.round(score/100*360)+'deg');

  const sQs=scope.map(i=>qs[i]),sCh=scope.map(i=>chosen[i]),sAn=scope.map(i=>answered[i]);
  const wt=buildWeakTagStats(sQs,sCh,sAn);
  const wn=buildWrongNoteItems(sQs,sCh,sAn);
  latestWrongNoteText=buildWrongNoteText(currentExamLabel||'모의고사',score,wn,wt);

  let html='<div class="review-section"><div class="review-title">약점 태그 분석</div>';
  if(!wt.length) html+='<div class="review-perfect">응답 데이터가 없어 약점 분석을 생략했습니다.</div>';
  else{html+='<div class="weak-tag-grid">'; wt.slice(0,6).forEach(s=>{const c=s.accuracy>=80?'high':s.accuracy>=60?'mid':'low'; html+=`<div class="weak-tag-card ${c}"><div class="weak-tag-name">${escapeHtml(s.tag)}</div><div class="weak-tag-meta">정확도 ${s.accuracy}% · 오답 ${s.wrong}/${s.attempted}</div></div>`;});html+='</div>';}
  html+='</div><div class="review-section"><div class="review-title">자동 오답노트</div><button class="btn-secondary compact" id="copyWrongNoteBtn" onclick="copyWrongNote()">오답노트 복사</button>';
  if(!wn.length) html+='<div class="review-perfect">전문항 정답! 오답노트가 비어 있습니다.</div>';
  else{html+='<div class="review-list">'; wn.forEach(n=>{html+=`<div class="review-note-item"><div class="review-note-head"><span class="review-num">Q${n.index}</span><span class="review-chip">${escapeHtml(n.tag)}</span><span class="review-chip">${escapeHtml(n.type)}</span><span class="review-mark ${n.isSkip?'skip':'wrong'}">${n.isSkip?'미응답':'오답'}</span></div><div class="review-q">${escapeHtml(n.question)}</div><div class="review-note-line"><strong>내 답:</strong> ${escapeHtml(n.myAnswerText)}</div><div class="review-note-line"><strong>정답:</strong> ${escapeHtml(n.correctText)}</div><div class="review-note-core">핵심 복습: ${escapeHtml(n.coreLine)}</div></div>`;});html+='</div>';}
  html+='</div>';
  document.getElementById('resReview').innerHTML=html;
  showScreen('result');
}

function reviewExam(){showScreen('quiz');window.scrollTo(0,0);}
function goHome(){
  stopExamTimer();
  currentExamLabel='';currentMode='learn';examMode=false;examRevealMode=false;learnRevealMode=true;
  examScopeIndices=[];examCursor=0;selectedSubjectIdx=-1;selectedPartIndices=[];
  resetExamTimer();setHeaderMode('learn');initHome();showScreen('home');
}

/* ── 데이터 로드 ── */
function createRng(seed){let s=(seed>>>0)||1;return()=>{s=(1664525*s+1013904223)>>>0;return s/0x100000000;};}
function shuffleWithRng(arr,rng){const c=[...arr];for(let i=c.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[c[i],c[j]]=[c[j],c[i]];}return c;}
function cloneQuestionWithShuffledOptions(q,rng){
  const n=JSON.parse(JSON.stringify(q));
  if(!Array.isArray(n.opts)||n.opts.length!==4) return n;
  const mapped=n.opts.map((text,orig)=>({text,orig}));
  const sh=shuffleWithRng(mapped,rng);
  n.opts=sh.map(x=>x.text); n.ans=sh.findIndex(x=>x.orig===q.ans);
  if(Array.isArray(q.optWhy)) n.optWhy=sh.map(x=>q.optWhy[x.orig]);
  if(n.explainV2&&Array.isArray(q.explainV2?.options)) n.explainV2.options=sh.map(x=>q.explainV2.options[x.orig]);
  return n;
}
function pickMany(items,count,rng){if(count<=0) return[];return shuffleWithRng(items,rng).slice(0,Math.min(count,items.length));}
function getSubjectIndexByPartNo(n){for(let i=0;i<SUBJECT_PART_RANGES.length;i++){const[s,e]=SUBJECT_PART_RANGES[i];if(n>=s&&n<=e) return i;}return -1;}

async function loadPartsIndex(){
  if(partsIndexCache) return partsIndexCache;
  partsIndexCache=(async()=>{const r=await fetch(PARTS_INDEX_FILE);if(!r.ok) throw new Error(`parts.json 로드 실패 (HTTP ${r.status})`);const j=await r.json();if(!Array.isArray(j?.parts)||!j.parts.length) throw new Error('parts.json에 파트 목록이 없습니다.');return j;})();
  try{return await partsIndexCache;}catch(e){partsIndexCache=null;throw e;}
}
async function loadPartBanks(opts={}){
  const{onlyIndices=null,forceReload=false}=opts;
  const ni=Array.isArray(onlyIndices)&&onlyIndices.length?[...new Set(onlyIndices.map(Number).filter(n=>Number.isInteger(n)&&n>=0))].sort((a,b)=>a-b):null;
  if(!forceReload&&!ni&&partBanksCache) return partBanksCache;
  const loader=(async()=>{
    const idx=await loadPartsIndex(); const parts=Array.isArray(idx?.parts)?idx.parts:[];
    const targets=ni?ni.map(si=>({part:parts[si],si})).filter(x=>!!x.part):parts.map((part,si)=>({part,si}));
    const banks=(await Promise.all(targets.map(async({part,si})=>{
      if(!forceReload&&partBankByIndexCache.has(si)) return partBankByIndexCache.get(si);
      if(!part.file) return null;
      const m=part.file.match(/part(\d+)\.json$/); const pn=m?Number(m[1]):NaN;
      const subjectIndex=Number.isFinite(pn)?getSubjectIndexByPartNo(pn):-1;
      if(subjectIndex<0) return null;
      const r=await fetch(part.file); if(!r.ok) throw new Error(`${part.file} 로드 실패`);
      const j=await r.json(); const questions=Array.isArray(j?.questions)?j.questions:[];
      if(!questions.length) return null;
      const bank={tag:part.tag||'미분류',partNo:pn,subjectIndex,questions,sourceIndex:si};
      partBankByIndexCache.set(si,bank); return bank;
    }))).filter(Boolean);
    if(!banks.length) throw new Error('문제은행이 비어 있습니다.');
    return banks;
  })();
  if(!forceReload&&!ni){partBanksCache=loader;try{return await partBanksCache;}catch(e){partBanksCache=null;throw e;}}
  return loader;
}
async function loadPartMetadata(){
  if(partsMetadataCache) return partsMetadataCache;
  const idx=await loadPartsIndex(); partsMetadataCache=Array.isArray(idx?.parts)?idx.parts:[];
  return partsMetadataCache;
}

/* ── 시험 생성 ── */
function buildGeneratedExam(banks){
  const rng=createRng(Date.now()); const pools=[[],[],[]];
  banks.forEach(b=>{if(b.subjectIndex>=0&&b.subjectIndex<=2) pools[b.subjectIndex].push({tag:b.tag,questions:shuffleWithRng(b.questions,rng)});});
  const final=[];
  for(let s=0;s<3;s++){
    const sel=[]; const used=new Set();
    pools[s].forEach(p=>{pickMany(p.questions,BASE_PICK_PER_TAG,rng).forEach(q=>{const k=`${p.tag}|${q.q}`;if(!used.has(k)){used.add(k);sel.push({p,q});}});});
    const lft=[];pools[s].forEach(p=>p.questions.forEach(q=>{const k=`${p.tag}|${q.q}`;if(!used.has(k)) lft.push({p,q});}));
    const rem=20-sel.length; if(rem>0) pickMany(lft,rem,rng).forEach(({p,q})=>{const k=`${p.tag}|${q.q}`;if(!used.has(k)){used.add(k);sel.push({p,q});}});
    if(sel.length<20) throw new Error(`${s+1}과목 문제은행 수량 부족: ${sel.length}/20`);
    shuffleWithRng(sel,rng).slice(0,20).forEach(({p,q})=>{const c=cloneQuestionWithShuffledOptions(q,rng);c.tag=p.tag;final.push(c);});
  }
  if(final.length!==TARGET_QUESTION_COUNT) throw new Error(`생성 수량 오류: ${final.length}/${TARGET_QUESTION_COUNT}`);
  return{label:'시험모드',questions:final};
}
function buildLearningExam(banks){
  const rng=createRng(Date.now()); const all=[];
  banks.forEach(b=>b.questions.forEach(q=>{const c=cloneQuestionWithShuffledOptions(q,rng);c._subjectIndex=b.subjectIndex;all.push(c);}));
  return{label:'학습모드',questions:shuffleWithRng(all,rng)};
}
function buildSelectedPartsExam(banks,indices,mode){
  const rng=createRng(Date.now()); let fb=banks.filter(b=>indices.includes(b.sourceIndex)); if(!fb.length) fb=banks;
  const all=[];fb.forEach(b=>b.questions.forEach(q=>{const c=cloneQuestionWithShuffledOptions(q,rng);c._subjectIndex=b.subjectIndex;c.tag=b.tag;all.push(c);}));
  return{label:mode==='exam'?'시험모드':'학습모드',questions:shuffleWithRng(all,rng)};
}

/* ── 시작 흐름 ── */
async function initHome(){
  const list=document.getElementById('examList'); list.innerHTML='';
  const mk=(id,label,desc,fn)=>{const el=document.createElement('div');el.className='exam-card';el.onclick=fn;el.innerHTML=`<div class="exam-card-left"><div class="exam-num">${id}</div><div class="exam-info"><h3>${label}</h3><p>${desc}</p></div></div><div class="exam-arrow">›</div>`;return el;};
  list.appendChild(mk('LEARN','학습모드','전체 파트 문제은행 · 문제별 즉시 해설 · 오답노트',()=>startGeneratedExam('learn')));
  list.appendChild(mk('EXAM','시험모드','즉시 시작 · 정답/해설 숨김 · 제출 후 채점',()=>startGeneratedExam('exam')));
}
function showSubjectSelect(){
  const c=document.getElementById('subjectSelectButtons'); if(!c) return; c.innerHTML='';
  ['1과목 (지수이)','2과목 (제어이)','3과목 (관리이)'].forEach((name,i)=>{const b=document.createElement('button');b.className='subject-select-btn';b.textContent=name;b.onclick=()=>selectSubject(i);c.appendChild(b);});
  showScreen('subjectSelect');
}
async function selectSubject(i){selectedSubjectIdx=i;await showPartSelect();}
async function showPartSelect(){
  if(selectedSubjectIdx<0){showSubjectSelect();return;}
  try{
    const c=document.getElementById('partSelectButtons'); if(!c) return;
    if(!partsMetadata.length) partsMetadata=await loadPartMetadata();
    const[s,e]=SUBJECT_PART_RANGES[selectedSubjectIdx]; const sp=partsMetadata.slice(s-1,e);
    c.innerHTML=''; selectedPartIndices=[];
    sp.forEach((part,i)=>{const gi=s-1+i;const l=document.createElement('label');l.className='part-select-label';l.innerHTML=`<input type="checkbox" class="part-select-checkbox" data-idx="${gi}" onclick="updatePartSelection()"><span class="part-select-text">${part.tag} (${part.count}문항)</span>`;c.appendChild(l);});
    const t=document.getElementById('partSelectTitle'); if(t) t.textContent=`${'1과목 2과목 3과목'.split(' ')[selectedSubjectIdx]} - 파트를 선택하세요`;
    showScreen('partSelect');
  }catch(e){const c=document.getElementById('partSelectButtons');if(c)c.innerHTML=`<div class="error-card">파트 목록을 불러오지 못했습니다.<br><small>${e.message}</small></div>`;}
}
function updatePartSelection(){
  selectedPartIndices=Array.from(document.querySelectorAll('.part-select-checkbox:checked')).map(cb=>Number(cb.dataset.idx));
  const btn=document.getElementById('partSelectSubmitBtn'); if(btn) btn.disabled=!selectedPartIndices.length;
}
function proceedToModeSelect(){if(!selectedPartIndices.length) return;showScreen('modeSelect');}

async function launchQuiz(generated,mode){
  curQuestions=generated.questions;chosen=new Array(curQuestions.length).fill(-1);answered=new Array(curQuestions.length).fill(false);
  latestWrongNoteText='';currentMode=mode;currentExamLabel=generated.label;
  examMode=mode==='exam';examRevealMode=false;learnRevealMode=true;
  examScopeIndices=examMode?curQuestions.map((_,i)=>i):[];examCursor=0;
  stopExamTimer();resetExamTimer();
  setHeaderMode(examMode?'exam':'learn');
  document.getElementById('hTitle').textContent=generated.label;
  buildQuiz();updateProgress();setupTagScrollSpy();
  if(examMode){startExamTimer();syncExamModeQuestionView();}
  else{updateExamModeUI();refreshLearnRevealView();}
}

async function startWithSelectedParts(mode='learn'){
  document.getElementById('hTitle').textContent='로딩 중…'; showScreen('quiz');
  try{const banks=await loadPartBanks({onlyIndices:selectedPartIndices});await launchQuiz(buildSelectedPartsExam(banks,selectedPartIndices,mode),mode);}
  catch(e){document.getElementById('quizBody').innerHTML=`<div class="error-card">문제 파일을 불러오지 못했습니다.<br><small>${e.message}</small></div>`;}
}
async function startGeneratedExam(mode='learn'){
  document.getElementById('hTitle').textContent='로딩 중…'; showScreen('quiz');
  try{const banks=await loadPartBanks();await launchQuiz(mode==='learn'?buildLearningExam(banks):buildGeneratedExam(banks),mode);}
  catch(e){document.getElementById('quizBody').innerHTML=`<div class="error-card">문제 파일을 불러오지 못했습니다.<br><small>${e.message}</small></div>`;}
}

/* ── 이벤트 바인딩 ── */
function bindControls(){
  document.getElementById('modeToggleBtn')?.addEventListener('click',toggleExamMode);
  document.getElementById('learnRevealToggle')?.addEventListener('change',toggleLearnRevealMode);
  document.getElementById('submitConfirmOk')?.addEventListener('click',()=>closeSubmitConfirmModal(true));
  document.getElementById('submitConfirmCancel')?.addEventListener('click',()=>closeSubmitConfirmModal(false));
  document.getElementById('submitConfirmModal')?.querySelector('[data-close="1"]')?.addEventListener('click',()=>closeSubmitConfirmModal(false));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&submitConfirmResolver) closeSubmitConfirmModal(false);});
  const qb=document.getElementById('quizBody');
  if(qb){
    let sx=0,dragging=false;
    const s=x=>{sx=x;dragging=true;};
    const e=x=>{if(!dragging) return;dragging=false;const d=sx-x;if(Math.abs(d)>40) moveExamQuestion(d>0?1:-1);};
    qb.addEventListener('touchstart',evt=>s(evt.changedTouches[0].screenX),false);
    qb.addEventListener('touchend',evt=>e(evt.changedTouches[0].screenX),false);
    qb.addEventListener('mousedown',evt=>s(evt.screenX),false);
    qb.addEventListener('mouseup',evt=>e(evt.screenX),false);
    qb.addEventListener('mouseleave',()=>{dragging=false;},false);
  }
}

function bootApp(){initThemeToggle();bindControls();setHeaderMode('learn');initHome();showScreen('home');}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootApp);
else bootApp();
