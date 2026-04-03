/* ────────────────────────────────────────────
   반도체설비보전기능사 모의고사 · app.js
  홈에서 '모의고사 만들기'를 누르면
  파트 문제은행을 조합해 60문항을 생성합니다.
──────────────────────────────────────────── */

const PARTS_INDEX_FILE = 'data/parts.json';
const TARGET_QUESTION_COUNT = 60;
const BASE_PICK_PER_TAG = 3;
const EXAM_DURATION_SECONDS = 60 * 60;
const SUBJECT_PART_RANGES = [
  [1, 6],
  [7, 11],
  [12, 16]
];

/* ── 상태 ── */
let curQuestions = [];
let chosen = [];
let answered = [];
let examMode = false;
let examCursor = 0;
let examRevealMode = false;
let learnRevealMode = true;
let examScopeIndices = [];
let latestWrongNoteText = '';
let currentExamLabel = '';
let currentMode = 'learn';
let selectedSubjectIdx = -1;
let selectedPartIndices = [];
let partsMetadata = [];
let examTimerSecondsLeft = EXAM_DURATION_SECONDS;
let examTimerIntervalId = null;
const THEME_KEY = 'exam-site-theme';
let partsIndexCache = null;
let partsMetadataCache = null;
let partBanksCache = null;
const partBankByIndexCache = new Map();
let submitConfirmResolver = null;

function formatDuration(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function stopExamTimer() {
  if (examTimerIntervalId) {
    clearInterval(examTimerIntervalId);
    examTimerIntervalId = null;
  }
}

function updateExamTimerUI() {
  const totalEl = document.getElementById('examTotalTime');
  const remainEl = document.getElementById('examRemainTime');
  if (!examMode) {
    const frozenTime = formatDuration(EXAM_DURATION_SECONDS);
    if (totalEl) totalEl.textContent = frozenTime;
    if (remainEl) remainEl.textContent = frozenTime;
    return;
  }
  if (totalEl) totalEl.textContent = formatDuration(EXAM_DURATION_SECONDS);
  if (remainEl) remainEl.textContent = formatDuration(examTimerSecondsLeft);
}

function resetExamTimer() {
  examTimerSecondsLeft = EXAM_DURATION_SECONDS;
  updateExamTimerUI();
}

function startExamTimer() {
  stopExamTimer();
  updateExamTimerUI();
  examTimerIntervalId = setInterval(() => {
    if (!examMode) {
      stopExamTimer();
      return;
    }

    examTimerSecondsLeft -= 1;
    if (examTimerSecondsLeft <= 0) {
      examTimerSecondsLeft = 0;
      updateExamTimerUI();
      stopExamTimer();
      submitExamMode({ skipConfirm: true });
      return;
    }

    updateExamTimerUI();
  }, 1000);
}

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('light-mode', isLight);
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = isLight ? '다크 모드' : '화이트 모드';
  }
}

function initThemeToggle() {
  const btn = document.getElementById('themeToggle');
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(saved);
  if (!btn) return;

  btn.addEventListener('click', () => {
    const next = document.body.classList.contains('light-mode') ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

/* ── 화면 전환 ── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ── 시험모드 제어 ── */
function updateExamModeUI() {
  const modeBtn = document.getElementById('examModeQuickBtn');
  const timerBox = document.getElementById('examTimerBox');
  const titleEl = document.getElementById('hTitle');
  const learnWrap = document.getElementById('learnRevealToggleWrap');
  const learnToggle = document.getElementById('learnRevealToggle');
  const subjectWrap = document.querySelector('.subject-nav-wrap');
  const tagWrap = document.querySelector('.tag-nav-wrap');
  const progressWrap = document.querySelector('.progress-bar-wrap');
  const inlineActions = document.querySelectorAll('.q-inline-actions');
  const revealSlots = document.querySelectorAll('.q-reveal-slot');
  const inlineRevealInputs = document.querySelectorAll('.q-inline-reveal-input');
  const inlinePrevBtns = document.querySelectorAll('.q-inline-prev');
  const inlineNextBtns = document.querySelectorAll('.q-inline-next');

  /* ── is-collapsed 먼저 적용 후 exam-layout-mode 붙임 (흔들림 방지) ── */
  if (subjectWrap) subjectWrap.classList.toggle('is-collapsed', examMode);
  if (tagWrap) tagWrap.classList.toggle('is-collapsed', examMode);

  document.body.classList.toggle('exam-layout-mode', examMode);

  if (modeBtn) {
    modeBtn.style.display = 'block';
    modeBtn.textContent = examMode ? '학습모드 가기' : '시험모드 가기';
  }
  if (titleEl) {
    titleEl.textContent = examMode ? '시험모드' : '학습모드';
  }

  if (timerBox) {
    timerBox.style.display = '';
    timerBox.classList.toggle('visible', examMode);
    timerBox.classList.remove('is-learn');
  }

  inlineActions.forEach(el => {
    el.style.display = '';
    el.classList.toggle('is-visible', examMode);
  });
  revealSlots.forEach(el => {
    el.style.display = '';
    el.classList.toggle('is-visible', examMode);
  });
  inlineRevealInputs.forEach(input => {
    input.checked = examRevealMode;
    input.disabled = !examMode;
  });
  if (progressWrap) progressWrap.style.display = 'block';

  if (examMode) {
    const scope = examScopeIndices.length ? examScopeIndices : curQuestions.map((_, i) => i);
    const total = scope.length || 0;
    inlinePrevBtns.forEach(btn => {
      btn.disabled = examCursor <= 0;
    });
    inlineNextBtns.forEach(btn => {
      btn.disabled = examCursor >= total - 1;
    });
  }

  if (learnWrap) {
    const showLearnToggle = currentMode === 'learn' && !examMode;
    learnWrap.classList.toggle('is-hidden', !showLearnToggle);
  }
  if (learnToggle) {
    learnToggle.checked = learnRevealMode;
    learnToggle.disabled = currentMode !== 'learn' || examMode;
  }

  updateExamTimerUI();
}

function clearOptionExplanation(qi) {
  const exp = document.getElementById(`exp${qi}`);
  if (exp) exp.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const wrap = document.getElementById(`optWrap${qi}_${i}`);
    const desc = document.getElementById(`optDesc${qi}_${i}`);
    const trap = document.getElementById(`optTrap${qi}_${i}`);
    const corr = document.getElementById(`optCorr${qi}_${i}`);

    if (wrap) {
      wrap.classList.remove('correct', 'wrong', 'locked', 'show-desc');
    }
    if (desc) desc.innerHTML = '';
    if (trap) {
      trap.innerHTML = '';
      trap.classList.remove('is-visible');
    }
    if (corr) corr.classList.remove('is-visible');
  }
}

function applyExamSelectionView(qi) {
  const q = curQuestions[qi];
  if (!q) return;
  const picked = chosen[qi];

  for (let i = 0; i < 4; i++) {
    const wrap = document.getElementById(`optWrap${qi}_${i}`);
    if (!wrap) continue;
    wrap.classList.remove('selected', 'correct', 'wrong', 'locked', 'exam-picked');
    if (i === picked) wrap.classList.add('selected', 'exam-picked');
  }

  if (!examRevealMode || picked < 0) {
    clearOptionExplanation(qi);
    return;
  }

  for (let i = 0; i < 4; i++) {
    const wrap = document.getElementById(`optWrap${qi}_${i}`);
    if (!wrap) continue;
    wrap.classList.add('locked');
    if (i === q.ans) wrap.classList.add('correct');
    else if (i === picked) wrap.classList.add('wrong');
  }
  showExplanation(qi);
}

function toggleExamRevealMode() {
  const revealToggle = document.getElementById('examRevealToggle');
  examRevealMode = !!revealToggle?.checked;
  document.querySelectorAll('.q-inline-reveal-input').forEach(input => {
    input.checked = examRevealMode;
  });
  if (examMode) {
    const scope = examScopeIndices.length ? examScopeIndices : curQuestions.map((_, i) => i);
    const activeIdx = scope[Math.min(examCursor, Math.max(scope.length - 1, 0))] ?? 0;
    applyExamSelectionView(activeIdx);
  }
}

function toggleExamRevealModeInline(checked) {
  examRevealMode = !!checked;
  const revealToggle = document.getElementById('examRevealToggle');
  if (revealToggle) revealToggle.checked = examRevealMode;
  document.querySelectorAll('.q-inline-reveal-input').forEach(input => {
    input.checked = examRevealMode;
  });
  if (examMode) {
    const scope = examScopeIndices.length ? examScopeIndices : curQuestions.map((_, i) => i);
    const activeIdx = scope[Math.min(examCursor, Math.max(scope.length - 1, 0))] ?? 0;
    applyExamSelectionView(activeIdx);
  }
}

function applyLearnSelectionView(qi) {
  const q = curQuestions[qi];
  if (!q) return;
  const picked = chosen[qi];
  const hasAnswered = answered[qi] && picked >= 0;

  clearOptionExplanation(qi);

  for (let i = 0; i < 4; i++) {
    const wrap = document.getElementById(`optWrap${qi}_${i}`);
    if (!wrap) continue;
    wrap.classList.remove('selected', 'correct', 'wrong', 'locked', 'exam-picked');
    if (i === picked) wrap.classList.add('selected');
    if (hasAnswered) wrap.classList.add('locked');
  }

  if (!hasAnswered || !learnRevealMode) return;

  for (let i = 0; i < 4; i++) {
    const wrap = document.getElementById(`optWrap${qi}_${i}`);
    if (!wrap) continue;
    if (i === q.ans) wrap.classList.add('correct');
    else if (i === picked) wrap.classList.add('wrong');
  }

  showExplanation(qi);
}

function refreshLearnRevealView() {
  for (let i = 0; i < curQuestions.length; i++) {
    applyLearnSelectionView(i);
  }
}

function toggleLearnRevealMode() {
  const learnToggle = document.getElementById('learnRevealToggle');
  learnRevealMode = !!learnToggle?.checked;
  if (currentMode === 'learn') refreshLearnRevealView();
}

function syncExamModeQuestionView() {
  updateExamModeUI();

  if (!examMode) {
    const activeSubjectBtn = document.querySelector('.sub-nav-btn.active');
    const activeIdx = activeSubjectBtn
      ? Array.from(document.querySelectorAll('.sub-nav-btn')).indexOf(activeSubjectBtn)
      : 0;
    switchSubject(Math.max(activeIdx, 0));
    return;
  }

  const scope = examScopeIndices.length ? examScopeIndices : curQuestions.map((_, i) => i);
  const safeCursor = Math.min(examCursor, Math.max(scope.length - 1, 0));
  const activeIdx = scope[safeCursor] ?? 0;
  examCursor = safeCursor;

  document.querySelectorAll('.q-block').forEach((qb, idx) => {
    qb.style.display = idx === activeIdx ? 'block' : 'none';
  });

  applyExamSelectionView(activeIdx);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = document.getElementById(`qb${activeIdx}`);
      if (target) {
        const header = document.querySelector('.quiz-header');
        const offset = header ? header.offsetHeight + 8 : 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      } else if (scope.length) {
        const first = document.getElementById(`qb${scope[0]}`);
        if (first) first.style.display = 'block';
      }
    });
  });
}

function moveExamQuestion(delta) {
  if (!examMode) return;
  const total = examScopeIndices.length ? examScopeIndices.length : curQuestions.length;
  const next = examCursor + delta;
  if (next < 0 || next >= total) return;
  examCursor = next;
  syncExamModeQuestionView();
}

function closeSubmitConfirmModal(confirmed) {
  const modal = document.getElementById('submitConfirmModal');
  if (modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  const resolver = submitConfirmResolver;
  submitConfirmResolver = null;
  if (resolver) resolver(!!confirmed);
}

function openSubmitConfirmModal() {
  const modal = document.getElementById('submitConfirmModal');
  if (!modal) return Promise.resolve(window.confirm('시험을 종료하고 제출할까요?'));

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  return new Promise(resolve => {
    submitConfirmResolver = resolve;
  });
}

async function submitExamMode(options = {}) {
  const { skipConfirm = false } = options;
  if (!examMode) return;

  if (!skipConfirm) {
    const ok = await openSubmitConfirmModal();
    if (!ok) return;
  }

  stopExamTimer();
  showResult();
}

function toggleExamMode() {
  if (!curQuestions.length) return;
  examMode = !examMode;
  examCursor = 0;
  if (!examMode) {
    stopExamTimer();
    examRevealMode = false;
    examScopeIndices = [];
  } else {
    examScopeIndices = curQuestions.map((_, i) => i);
    resetExamTimer();
    startExamTimer();
  }
  syncExamModeQuestionView();
}

function bindExamModeControls() {
  const modeBtn = document.getElementById('examModeQuickBtn');
  const prevBtn = document.getElementById('examPrevBtn');
  const nextBtn = document.getElementById('examNextBtn');
  const submitBtn = document.getElementById('examSubmitBtn');
  const learnToggle = document.getElementById('learnRevealToggle');
  const quizBody = document.getElementById('quizBody');

  if (modeBtn) modeBtn.addEventListener('click', toggleExamMode);
  if (prevBtn) prevBtn.addEventListener('click', () => moveExamQuestion(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => moveExamQuestion(1));
  if (submitBtn) submitBtn.addEventListener('click', submitExamMode);
  if (learnToggle) learnToggle.addEventListener('change', toggleLearnRevealMode);

  const modal = document.getElementById('submitConfirmModal');
  const confirmOk = document.getElementById('submitConfirmOk');
  const confirmCancel = document.getElementById('submitConfirmCancel');
  const backdrop = modal ? modal.querySelector('[data-close="1"]') : null;

  if (confirmOk) confirmOk.addEventListener('click', () => closeSubmitConfirmModal(true));
  if (confirmCancel) confirmCancel.addEventListener('click', () => closeSubmitConfirmModal(false));
  if (backdrop) backdrop.addEventListener('click', () => closeSubmitConfirmModal(false));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && submitConfirmResolver) {
      closeSubmitConfirmModal(false);
    }
  });

  let startX = 0;
  let isDragging = false;

  if (quizBody) {
    quizBody.addEventListener('touchstart', e => {
      startX = e.changedTouches[0].screenX;
      isDragging = true;
    }, false);

    quizBody.addEventListener('touchend', e => {
      if (!isDragging) return;
      const endX = e.changedTouches[0].screenX;
      handleGesture(startX, endX);
      isDragging = false;
    }, false);

    quizBody.addEventListener('mousedown', e => {
      startX = e.screenX;
      isDragging = true;
    }, false);

    quizBody.addEventListener('mouseup', e => {
      if (!isDragging) return;
      const endX = e.screenX;
      handleGesture(startX, endX);
      isDragging = false;
    }, false);

    quizBody.addEventListener('mouseleave', () => {
      isDragging = false;
    }, false);
  }

  function handleGesture(startX, endX) {
    const swipeThreshold = 40;
    const diff = startX - endX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        moveExamQuestion(1);
      } else {
        moveExamQuestion(-1);
      }
    }
  }

  updateExamModeUI();
}



function createRng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithRng(arr, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cloneQuestionWithShuffledOptions(question, rng) {
  const next = JSON.parse(JSON.stringify(question));
  if (!Array.isArray(next.opts) || next.opts.length !== 4) return next;

  const mapped = next.opts.map((text, original) => ({ text, original }));
  const shuffled = shuffleWithRng(mapped, rng);
  next.opts = shuffled.map(item => item.text);
  next.ans = shuffled.findIndex(item => item.original === question.ans);

  if (Array.isArray(question.optWhy)) {
    next.optWhy = shuffled.map(item => question.optWhy[item.original]);
  }
  if (next.explainV2 && Array.isArray(question.explainV2?.options)) {
    next.explainV2.options = shuffled.map(item => question.explainV2.options[item.original]);
  }
  return next;
}

function pickMany(items, count, rng) {
  if (count <= 0) return [];
  return shuffleWithRng(items, rng).slice(0, Math.min(count, items.length));
}

function getSubjectIndexByPartNo(partNo) {
  for (let i = 0; i < SUBJECT_PART_RANGES.length; i++) {
    const [start, end] = SUBJECT_PART_RANGES[i];
    if (partNo >= start && partNo <= end) return i;
  }
  return -1;
}

async function loadPartsIndex() {
  if (partsIndexCache) return partsIndexCache;

  partsIndexCache = (async () => {
    const res = await fetch(PARTS_INDEX_FILE);
    if (!res.ok) throw new Error(`parts.json 로드 실패 (HTTP ${res.status})`);
    const partsIndex = await res.json();
    const parts = Array.isArray(partsIndex?.parts) ? partsIndex.parts : [];
    if (!parts.length) throw new Error('parts.json에 파트 목록이 없습니다.');
    return partsIndex;
  })();

  try {
    return await partsIndexCache;
  } catch (e) {
    partsIndexCache = null;
    throw e;
  }
}

async function loadPartBanks(options = {}) {
  const { onlyIndices = null, forceReload = false } = options;
  const normalizedIndices = Array.isArray(onlyIndices) && onlyIndices.length
    ? [...new Set(onlyIndices
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b)
    : null;

  if (!forceReload && !normalizedIndices && partBanksCache) {
    return partBanksCache;
  }

  const loader = (async () => {
    const partsIndex = await loadPartsIndex();
    const parts = Array.isArray(partsIndex?.parts) ? partsIndex.parts : [];

    const targets = normalizedIndices
      ? normalizedIndices
        .map(sourceIndex => ({ part: parts[sourceIndex], sourceIndex }))
        .filter(item => !!item.part)
      : parts.map((part, sourceIndex) => ({ part, sourceIndex }));

    const jobs = targets.map(async ({ part, sourceIndex }) => {
      if (!forceReload && partBankByIndexCache.has(sourceIndex)) {
        return partBankByIndexCache.get(sourceIndex);
      }

      const file = part.file;
      const tag = part.tag || '미분류';
      if (!file) return null;

      const partNoMatch = file.match(/part(\d+)\.json$/);
      const partNo = partNoMatch ? Number(partNoMatch[1]) : NaN;
      const subjectIndex = Number.isFinite(partNo) ? getSubjectIndexByPartNo(partNo) : -1;
      if (subjectIndex < 0) return null;

      const partRes = await fetch(file);
      if (!partRes.ok) throw new Error(`${file} 로드 실패 (HTTP ${partRes.status})`);

      const partJson = await partRes.json();
      const questions = Array.isArray(partJson?.questions) ? partJson.questions : [];
      if (!questions.length) return null;

      const bank = { tag, partNo, subjectIndex, questions, sourceIndex };
      partBankByIndexCache.set(sourceIndex, bank);
      return bank;
    });

    const banks = (await Promise.all(jobs)).filter(Boolean);
    if (!banks.length) throw new Error('문제은행이 비어 있습니다.');
    return banks;
  })();

  if (!forceReload && !normalizedIndices) {
    partBanksCache = loader;
    try {
      return await partBanksCache;
    } catch (e) {
      partBanksCache = null;
      throw e;
    }
  }

  return loader;
}

function buildGeneratedExam(banks) {
  const seed = Date.now();
  const rng = createRng(seed);
  const subjectPools = [[], [], []];

  banks.forEach(bank => {
    const sIdx = bank.subjectIndex;
    if (sIdx < 0 || sIdx > 2) return;
    subjectPools[sIdx].push({
      tag: bank.tag,
      partNo: bank.partNo,
      questions: shuffleWithRng(bank.questions, rng)
    });
  });

  const finalQuestions = [];
  for (let sIdx = 0; sIdx < 3; sIdx++) {
    const selected = [];
    const used = new Set();
    const pools = subjectPools[sIdx];

    pools.forEach(pool => {
      const basePick = pickMany(pool.questions, BASE_PICK_PER_TAG, rng);
      basePick.forEach(q => {
        const key = `${pool.tag}|${q.q}`;
        if (used.has(key)) return;
        used.add(key);
        selected.push({ pool, q });
      });
    });

    const leftovers = [];
    pools.forEach(pool => {
      pool.questions.forEach(q => {
        const key = `${pool.tag}|${q.q}`;
        if (!used.has(key)) leftovers.push({ pool, q });
      });
    });

    const remain = 20 - selected.length;
    if (remain > 0) {
      pickMany(leftovers, remain, rng).forEach(({ pool, q }) => {
        const key = `${pool.tag}|${q.q}`;
        if (used.has(key)) return;
        used.add(key);
        selected.push({ pool, q });
      });
    }

    if (selected.length < 20) {
      throw new Error(`${sIdx + 1}과목 문제은행 수량 부족: ${selected.length}/20`);
    }

    const subjectQuestions = shuffleWithRng(selected, rng)
      .slice(0, 20)
      .map(({ pool, q }) => {
        const cloned = cloneQuestionWithShuffledOptions(q, rng);
        cloned.tag = pool.tag; // 파트명(태그) 주입
        return cloned;
      });

    finalQuestions.push(...subjectQuestions);
  }

  if (finalQuestions.length !== TARGET_QUESTION_COUNT) {
    throw new Error(`생성 수량 오류: ${finalQuestions.length}/${TARGET_QUESTION_COUNT}`);
  }

  return {
    label: '시험모드',
    meta: {
      title: '모의고사 생성본',
      count: finalQuestions.length,
      pass_score: 60,
      version: 'gen-1.0',
      source: 'parts.json',
      seed
    },
    questions: finalQuestions
  };
}

function buildLearningExam(banks) {
  const seed = Date.now();
  const rng = createRng(seed);
  const allQuestions = [];

  banks.forEach(bank => {
    bank.questions.forEach(q => {
      const cloned = cloneQuestionWithShuffledOptions(q, rng);
      cloned._subjectIndex = bank.subjectIndex;
      allQuestions.push(cloned);
    });
  });

  const finalQuestions = shuffleWithRng(allQuestions, rng);

  return {
    label: '학습모드',
    meta: {
      title: '학습모드 전체 파트',
      count: finalQuestions.length,
      pass_score: 60,
      version: 'learn-1.0',
      source: 'parts.json',
      seed
    },
    questions: finalQuestions
  };
}

/* ── 홈 초기화: 회차 카드 동적 생성 ── */
async function initHome() {
  const list = document.getElementById('examList');
  list.innerHTML = '';

  const learnCard = document.createElement('div');
  learnCard.className = 'exam-card';
  learnCard.onclick = () => startGeneratedExam('learn');
  learnCard.innerHTML = `
    <div class="exam-card-left">
      <div class="exam-num">LEARN</div>
      <div class="exam-info">
        <h3>학습모드</h3>
        <p>전체 파트 문제은행 · 문제별 즉시 해설 · 오답노트</p>
      </div>
    </div>
    <div class="exam-arrow">›</div>`;

  const examCard = document.createElement('div');
  examCard.className = 'exam-card';
  examCard.onclick = () => startGeneratedExam('exam');
  examCard.innerHTML = `
    <div class="exam-card-left">
      <div class="exam-num">EXAM</div>
      <div class="exam-info">
        <h3>시험모드</h3>
        <p>즉시 시작 · 정답/해설 숨김 · 제출 후 채점</p>
      </div>
    </div>
    <div class="exam-arrow">›</div>`;

  list.appendChild(learnCard);
  list.appendChild(examCard);
}

/* ── 과목 선택 화면 ── */
function showSubjectSelect() {
  const subjectNames = ['1과목 (지수이)', '2과목 (제어이)', '3과목 (관리이)'];
  const container = document.getElementById('subjectSelectButtons');

  if (!container) {
    console.error('subjectSelectButtons 요소를 찾을 수 없습니다');
    return;
  }

  container.innerHTML = '';

  subjectNames.forEach((name, idx) => {
    const btn = document.createElement('button');
    btn.className = 'subject-select-btn';
    btn.textContent = name;
    btn.onclick = () => selectSubject(idx);
    container.appendChild(btn);
  });

  showScreen('subjectSelect');
}

/* ── 과목 선택 처리 ── */
async function selectSubject(subjectIdx) {
  selectedSubjectIdx = subjectIdx;
  await showPartSelect();
}

/* ── 파트 선택 화면 표시 ── */
async function showPartSelect() {
  if (selectedSubjectIdx < 0) {
    showSubjectSelect();
    return;
  }

  try {
    const container = document.getElementById('partSelectButtons');
    if (!container) {
      console.error('partSelectButtons 요소를 찾을 수 없습니다');
      return;
    }

    if (partsMetadata.length === 0) {
      partsMetadata = await loadPartMetadata();
    }

    const partRange = SUBJECT_PART_RANGES[selectedSubjectIdx];
    const subjectParts = partsMetadata.slice(partRange[0] - 1, partRange[1]);

    container.innerHTML = '';
    selectedPartIndices = [];

    subjectParts.forEach((part, idx) => {
      const globalIdx = partRange[0] - 1 + idx;
      const label = document.createElement('label');
      label.className = 'part-select-label';
      label.innerHTML = `
        <input type="checkbox" class="part-select-checkbox" data-idx="${globalIdx}" onclick="updatePartSelection()">
        <span class="part-select-text">${part.tag} (${part.count}문항)</span>
      `;
      container.appendChild(label);
    });

    const titleEl = document.getElementById('partSelectTitle');
    if (titleEl) {
      const subjectName = ['1과목 (지수이)', '2과목 (제어이)', '3과목 (관리이)'][selectedSubjectIdx];
      titleEl.textContent = `${subjectName} - 파트를 선택하세요`;
    }

    showScreen('partSelect');
  } catch (e) {
    console.error('파트 선택 실패:', e);
    const container = document.getElementById('partSelectButtons');
    if (container) {
      container.innerHTML = `<div class="error-card">파트 목록을 불러오지 못했습니다.<br><small>${e.message}</small></div>`;
    }
  }
}

/* ── 파트 선택 업데이트 ── */
function updatePartSelection() {
  const checkboxes = document.querySelectorAll('.part-select-checkbox:checked');
  selectedPartIndices = Array.from(checkboxes).map(cb => Number(cb.dataset.idx));

  const submitBtn = document.getElementById('partSelectSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = selectedPartIndices.length === 0;
  }
}

/* ── 모드 선택으로 진행 ── */
function proceedToModeSelect() {
  if (selectedPartIndices.length === 0) return;
  showModeSelect();
}

/* ── 모드 선택 화면 ── */
async function showModeSelect() {
  showScreen('modeSelect');
}

/* ── 선택된 파트로 시험 시작 ── */
async function startWithSelectedParts(mode = 'learn') {
  document.getElementById('hTitle').textContent = '로딩 중…';
  showScreen('quiz');

  try {
    const banks = await loadPartBanks({ onlyIndices: selectedPartIndices });
    const generated = buildSelectedPartsExam(banks, selectedPartIndices, mode);
    const modeTitle = mode === 'exam' ? '시험모드' : '학습모드';

    curQuestions = generated.questions;
    chosen = new Array(curQuestions.length).fill(-1);
    answered = new Array(curQuestions.length).fill(false);
    latestWrongNoteText = '';
    currentMode = mode;
    currentExamLabel = modeTitle;
    examMode = mode === 'exam';
    examRevealMode = false;
    learnRevealMode = true;
    examScopeIndices = examMode ? curQuestions.map((_, i) => i) : [];
    examCursor = 0;
    stopExamTimer();
    resetExamTimer();

    document.getElementById('hTitle').textContent = modeTitle;
    buildQuiz();
    updateProgress();
    setupTagScrollSpy();
    if (examMode) {
      startExamTimer();
      syncExamModeQuestionView();
    } else {
      updateExamModeUI();
      refreshLearnRevealView();
    }

  } catch (e) {
    document.getElementById('quizBody').innerHTML =
      `<div class="error-card">문제 파일을 불러오지 못했습니다.<br><small>${e.message}</small></div>`;
  }
}

/* ── 선택된 파트로 시험 생성 ── */
function buildSelectedPartsExam(banks, selectedPartIndices, mode = 'learn') {
  let filteredBanks = banks.filter(bank => selectedPartIndices.includes(bank.sourceIndex));
  if (!filteredBanks.length) filteredBanks = banks;

  if (filteredBanks.length === 0) {
    throw new Error('선택한 파트가 없습니다.');
  }

  const seed = Date.now();
  const rng = createRng(seed);
  const questions = [];

  filteredBanks.forEach(bank => {
    bank.questions.forEach(q => {
      const cloned = cloneQuestionWithShuffledOptions(q, rng);
      cloned._subjectIndex = bank.subjectIndex;
      cloned.tag = bank.tag; // _partTag 대신 tag 사용 (레이아웃 호환성)
      questions.push(cloned);
    });
  });

  const finalQuestions = shuffleWithRng(questions, rng);

  const partNames = filteredBanks.map(b => b.tag).join(', ');
  const label = mode === 'exam' ? '시험모드' : '학습모드';

  return {
    label,
    meta: {
      title: partNames,
      count: finalQuestions.length,
      pass_score: 60,
      version: 'custom-1.0',
      source: 'parts.json',
      seed,
      selectedParts: selectedPartIndices
    },
    questions: finalQuestions
  };
}

/* ── 파트 메타데이터 로드 ── */
async function loadPartMetadata() {
  if (partsMetadataCache) return partsMetadataCache;

  const index = await loadPartsIndex();
  partsMetadataCache = Array.isArray(index?.parts) ? index.parts : [];
  return partsMetadataCache;
}

async function startGeneratedExam(mode = 'learn') {
  document.getElementById('hTitle').textContent = '로딩 중…';
  showScreen('quiz');

  try {
    const banks = await loadPartBanks();
    const generated = mode === 'learn' ? buildLearningExam(banks) : buildGeneratedExam(banks);
    const modeTitle = mode === 'exam' ? '시험모드' : '학습모드';

    curQuestions = generated.questions;
    chosen = new Array(curQuestions.length).fill(-1);
    answered = new Array(curQuestions.length).fill(false);
    latestWrongNoteText = '';
    currentMode = mode;
    currentExamLabel = modeTitle;
    examMode = mode === 'exam';
    examRevealMode = false;
    learnRevealMode = true;
    examScopeIndices = examMode ? curQuestions.map((_, i) => i) : [];
    examCursor = 0;
    stopExamTimer();
    resetExamTimer();

    document.getElementById('hTitle').textContent = modeTitle;
    buildQuiz();
    updateProgress();
    setupTagScrollSpy();
    if (examMode) {
      startExamTimer();
      syncExamModeQuestionView();
    } else {
      updateExamModeUI();
      refreshLearnRevealView();
    }

  } catch (e) {
    document.getElementById('quizBody').innerHTML =
      `<div class="error-card">문제 파일을 불러오지 못했습니다.<br><small>${e.message}</small></div>`;
  }
}

/* ── 퀴즈 HTML 생성 ── */
function buildQuiz() {
  const qs = curQuestions;
  let html = '';
  const localNoByQuestionIndex = new Array(qs.length).fill(0);

  const subjects = [
    { order: [], first: {}, count: {}, startIndex: 0 },
    { order: [], first: {}, count: {}, startIndex: 20 },
    { order: [], first: {}, count: {}, startIndex: 40 }
  ];

  qs.forEach((q, qi) => {
    const subIdx = currentMode === 'learn'
      ? Math.min(Math.max(Number.isInteger(q._subjectIndex) ? q._subjectIndex : 0, 0), 2)
      : Math.min(Math.floor(qi / 20), 2);
    const sub = subjects[subIdx];
    if (sub.first[q.tag] === undefined) { sub.first[q.tag] = qi; sub.order.push(q.tag); }
    sub.count[q.tag] = (sub.count[q.tag] || 0) + 1;
    localNoByQuestionIndex[qi] = (sub.count.__localSeq || 0) + 1;
    sub.count.__localSeq = localNoByQuestionIndex[qi];
  });

  qs.forEach((q, qi) => {
    const subIdx = currentMode === 'learn'
      ? Math.min(Math.max(Number.isInteger(q._subjectIndex) ? q._subjectIndex : 0, 0), 2)
      : Math.min(Math.floor(qi / 20), 2);
    const sub = subjects[subIdx];
    const anchorId = sub.first[q.tag] === qi
      ? `tag-anchor-${q.tag.replace(/[^가-힣a-zA-Z0-9]/g, '_')}_sub${subIdx}`
      : '';

    const typeClass = q.type === '암기' ? 'memory' : 'understanding';
    const typeLabel = q.type || '이해';
    const safeTag = escapeHtml(q.tag || '미분류');

    const displayNo = currentMode === 'learn'
      ? localNoByQuestionIndex[qi]
      : (qi + 1);

    html += `
      <div class="q-block" id="qb${qi}" data-subidx="${subIdx}" data-tag="${safeTag}">
        ${anchorId ? `<span id="${anchorId}" class="tag-anchor-spacer"></span>` : ''}
        <div class="q-meta">
          <span class="q-num-badge">Q${displayNo}</span>
          <span class="q-tag">${safeTag}</span>
          <span class="q-type ${typeClass}">${typeLabel}</span>
          <div class="q-reveal-slot" style="margin-left:auto;">
            <label class="q-inline-reveal" for="qInlineReveal${qi}">
              <input id="qInlineReveal${qi}" class="q-inline-reveal-input" type="checkbox" onchange="toggleExamRevealModeInline(this.checked)">
              <span>정답·해설</span>
            </label>
          </div>
        </div>
        <div class="q-text">${q.q}</div>
        <div class="opts">
          ${q.opts.map((o, oi) => `
            <div class="option" id="optWrap${qi}_${oi}" onclick="pick(${qi},${oi})">
              <div class="opt-no">${['①', '②', '③', '④'][oi]}</div>
              <div class="opt-body">
                <div class="opt-name">
                  ${o} 
                  <span class="trap" id="optTrap${qi}_${oi}"></span>
                  <span class="correct-label" id="optCorr${qi}_${oi}">정답</span>
                </div>
                <div class="opt-desc" id="optDesc${qi}_${oi}"></div>
              </div>
            </div>`).join('')}
        </div>
        <div class="q-inline-actions">
          <button class="q-inline-btn q-inline-prev" type="button" onclick="moveExamQuestion(-1)">이전</button>
          <button class="q-inline-btn q-inline-next" type="button" onclick="moveExamQuestion(1)">다음</button>
          <button class="q-inline-btn q-inline-submit" type="button" onclick="submitExamMode()">시험 제출</button>
        </div>
        <div class="common-exp" id="exp${qi}"></div>
      </div>`;
  });

  document.getElementById('quizBody').innerHTML = html;

  window.currentSubjects = subjects;
  renderSubjectNav();
  if (!examMode) switchSubject(0);
}

function renderSubjectNav() {
  const wrap = document.querySelector('.subject-nav-wrap');
  const nav = document.getElementById('subjectNav');
  if (wrap) wrap.style.display = 'flex';
  if (nav) nav.style.display = 'flex';
  nav.innerHTML = '';
  const names = ['1과목', '2과목', '3과목'];
  names.forEach((name, i) => {
    if (window.currentSubjects[i].order.length === 0) return;
    const btn = document.createElement('button');
    btn.className = 'sub-nav-btn' + (i === 0 ? ' active' : '');
    btn.textContent = name;
    btn.onclick = () => {
      document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchSubject(i);
    };
    nav.appendChild(btn);
  });
}

function switchSubject(subIdx) {
  if (examMode) return;

  renderTagNav(subIdx);
  applyLearnFilter(subIdx, '');

  window.scrollTo(0, 0);
}

function applyLearnFilter(subIdx, tag) {
  document.querySelectorAll('.q-block').forEach(qb => {
    const isSubjectMatch = qb.dataset.subidx === String(subIdx);
    const isTagMatch = !tag || qb.dataset.tag === tag;
    qb.style.display = (isSubjectMatch && isTagMatch) ? 'block' : 'none';
  });
}

function renderTagNav(subIdx) {
  const nav = document.getElementById('tagNav');
  if (!nav) return;

  nav.innerHTML = '';
  const sub = window.currentSubjects[subIdx];
  if (!sub) return;

  sub.order.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag-btn';
    btn.dataset.tag = tag;
    btn.innerHTML = `<span class="tag-btn-dot"></span>${tag}<span class="tag-btn-cnt">${sub.count[tag]}</span>`;
    btn.onclick = () => {
      document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyLearnFilter(subIdx, tag);
      window.scrollTo(0, 0);
    };
    nav.appendChild(btn);
  });
}

/* ── 태그 앵커 스크롤 스파이 ── */
function setupTagScrollSpy() {
  setTimeout(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const id = e.target.id;
          const match = id.match(/_sub(\d+)$/);
          const subIdx = match ? match[1] : '0';

          document.querySelectorAll('.tag-btn').forEach(b => {
            const anchor = `tag-anchor-${b.dataset.tag.replace(/[^가-힣a-zA-Z0-9]/g, '_')}_sub${subIdx}`;
            b.classList.toggle('active', anchor === id);
          });
        }
      });
    }, { rootMargin: '-80px 0px -60% 0px', threshold: 0 });

    document.querySelectorAll('[id^="tag-anchor-"]').forEach(el => obs.observe(el));
  }, 200);
}

function scrollToTag(anchorId, btn) {
  const el = document.getElementById(anchorId);
  if (!el) return;
  const header = document.querySelector('.quiz-header');
  const offset = header ? header.offsetHeight + 8 : 80;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
  document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

/* ── 선택 처리 ── */
function pick(qi, oi) {
  const q = curQuestions[qi];
  if (examMode) {
    chosen[qi] = oi;
    answered[qi] = true;
    applyExamSelectionView(qi);
    updateProgress();
    updateExamModeUI();
    return;
  }

  if (answered[qi]) return;
  chosen[qi] = oi;
  answered[qi] = true;

  applyLearnSelectionView(qi);
  document.getElementById(`qb${qi}`).classList.add('answered');
  updateProgress();

  if (answered.every(a => a)) setTimeout(() => showResult(), 800);
}

/* ── 해설 표시 (카드형 구조) ── */
function showExplanation(qi) {
  const q = curQuestions[qi];
  const expV2 = q.explainV2 || null;
  const optionExplainList = Array.isArray(expV2?.options)
    ? expV2.options.map(item => item?.desc || '')
    : (Array.isArray(q.optWhy) ? q.optWhy : []);
  const conceptList = Array.isArray(expV2?.coreConcepts) ? expV2.coreConcepts : q.why;
  const tipFlow = expV2?.tipFlow || q.tip;
  const eliminationRule = expV2?.eliminationRule || q.rule;
  const linkedInfo = expV2?.linkInfo || q.linkInfo;

  q.opts.forEach((o, oi) => {
    const wrap = document.getElementById(`optWrap${qi}_${oi}`);
    const desc = document.getElementById(`optDesc${qi}_${oi}`);
    const trap = document.getElementById(`optTrap${qi}_${oi}`);
    const corr = document.getElementById(`optCorr${qi}_${oi}`);
    const v2Meta = Array.isArray(expV2?.options) ? expV2.options[oi] : null;

    let cleanWhy = (optionExplainList[oi] || '').replace(/^\[(정답|선택|오답)\]\s*/, '');
    desc.innerHTML = cleanWhy;

    trap.classList.remove('is-visible');
    corr.classList.remove('is-visible');

    if (oi === q.ans) {
      corr.classList.add('is-visible');
    } else {
      let isTrapFound = true;
      if (v2Meta?.trap) trap.innerHTML = v2Meta.trap;
      else if (/(구매|단가|BOM)/.test(cleanWhy)) trap.innerHTML = '함정: 구매 업무';
      else if (/(외관|색상|도장)/.test(cleanWhy)) trap.innerHTML = '함정: 외관 사양';
      else if (/(전원|전장|전기)/.test(cleanWhy)) trap.innerHTML = '함정: 전장/전기';
      else if (/(검사|수율)/.test(cleanWhy)) trap.innerHTML = '함정: 수율/검사';
      else isTrapFound = false;

      if (isTrapFound) trap.classList.add('is-visible');
    }

    wrap.classList.add('show-desc');
  });

  let whyHtml = '';
  if (Array.isArray(conceptList)) {
    conceptList.forEach(item => {
      whyHtml += `
        <div class="concept">
          <div class="concept-title">${item.title}</div>
          <div class="concept-desc">${item.desc}</div>
        </div>`;
    });
  } else if (conceptList) {
    let title = '핵심 개념';
    let desc = conceptList;
    const dotMatch = conceptList.match(/^([^.?]+[.?])\s*(.*)$/);
    if (dotMatch) { title = dotMatch[1].trim(); desc = dotMatch[2].trim(); }
    whyHtml = `<div class="concept"><div class="concept-title">${title}</div><div class="concept-desc">${desc}</div></div>`;
  }

  let stepsHtml = '';
  if (tipFlow) {
    const stepParts = tipFlow.split(/①|②|③|④|⑤/).filter(s => s.trim());
    if (stepParts.length > 1 || tipFlow.includes('①')) {
      let html = '<div class="steps">';
      stepParts.forEach((part, idx) => {
        const cleanPart = part.replace(/→/g, '').trim();
        if (cleanPart) {
          html += `<div class="step-num">${idx + 1}</div><span class="step-text">${cleanPart}</span>`;
          if (idx < stepParts.length - 1) html += `<span class="arrow">→</span>`;
        }
      });
      html += '</div>';
      stepsHtml = html;
    } else {
      stepsHtml = `<div class="step-text step-inline-note">${tipFlow}</div>`;
    }
  }

  let ruleHtml = '';
  if (eliminationRule) {
    ruleHtml = `
      <hr class="div">
      <div class="rule-box">
        <div class="rule-title">${eliminationRule.title}</div>
        ${(eliminationRule.rows || []).map(row => `
          <div class="rule-row">
            <span class="rule-keyword">${row.keyword}</span>
            <span class="rule-action">${row.action}</span>
          </div>
        `).join('')}
      </div>`;
  }

  let linkHtml = '';
  if (linkedInfo) {
    linkHtml = `<div class="link-box">${linkedInfo}</div>`;
  }

  document.getElementById(`exp${qi}`).innerHTML = `
    <div class="card exp-card">
      <div class="section-label">핵심 개념</div>
      ${whyHtml}
    </div>
    <div class="card exp-card">
      <div class="section-label">강사 팁</div>
      ${stepsHtml}
      ${ruleHtml}
      ${linkHtml}
    </div>
  `;
}

/* ── 진행률 업데이트 ── */
function updateProgress() {
  const scope = curQuestions.map((_, i) => i);
  const total = scope.length;
  const done = scope.filter(i => answered[i]).length;
  const correct = scope.filter(i => answered[i] && chosen[i] === curQuestions[i].ans).length;
  const examPos = Math.min(examCursor + 1, Math.max(total, 1));
  const examPct = total > 0 ? Math.round(examPos / total * 100) : 0;
  const learnPct = total > 0 ? Math.round(done / total * 100) : 0;
  const pFill = document.getElementById('pFill');
  const pLabel = document.getElementById('pLabel');
  const examPartNameEl = document.getElementById('examPartName');
  const examProgressCountEl = document.getElementById('examProgressCount');
  const hScore = document.getElementById('hScore');
  if (pFill) pFill.style.width = (examMode ? examPct : learnPct) + '%';
  if (pLabel) {
    if (examMode) {
      const activeIdx = (examScopeIndices.length ? examScopeIndices[examCursor] : examCursor) ?? 0;
      const partName = curQuestions[activeIdx]?.tag || '미분류';
      pLabel.classList.add('is-exam');
      pLabel.innerHTML = `<span class="p-part">파트: ${escapeHtml(partName)}</span><span class="p-total">총 ${examPos}/${total}</span>`;
      if (examPartNameEl) examPartNameEl.textContent = `파트: ${partName}`;
      if (examProgressCountEl) examProgressCountEl.textContent = `총 ${examPos}/${total}`;
    } else {
      pLabel.classList.remove('is-exam');
      pLabel.textContent = '';
      if (examPartNameEl) examPartNameEl.textContent = '파트: -';
      if (examProgressCountEl) examProgressCountEl.textContent = '총 1/60';
    }
  }
  if (hScore) hScore.textContent = `${correct} / ${done} 정답`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractKeywords(text, maxCount = 4) {
  const stopwords = new Set(['무엇', '무엇이', '무엇을', '무엇은', '어떤', '어느', '가장', '다음', '관련', '경우', '상황', '위한', '대한', '에서', '으로', '한다', '된다']);
  const tokens = String(text || '')
    .replace(/[()\[\]{}?.,!~:;·/\\-]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !stopwords.has(token));

  return [...new Set(tokens)].slice(0, maxCount).join(' ');
}

function buildSearchQuery(q) {
  const tag = String(q?.tag || '').trim();
  const keywords = extractKeywords(q?.q || '', 4);
  return [tag, keywords].filter(Boolean).join(' ');
}

function openYouTubeSearch(qi) {
  const q = curQuestions[qi];
  if (!q) return;
  const query = buildSearchQuery(q);
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openGeminiSearch(qi) {
  const q = curQuestions[qi];
  if (!q) return;
  const query = String(q.q || '').trim();
  navigator.clipboard.writeText(query).then(() => {
    alert('쿼리가 복사되었습니다. Gemini에 붙여넣기 하세요.');
    window.open('https://gemini.google.com/app', '_blank');
  }).catch(() => {
    const link = document.getElementById('geminiLink');
    if (link) {
      link.href = `https://gemini.google.com/app?q=${encodeURIComponent(query)}`;
      link.click();
      return;
    }
    window.open(`https://gemini.google.com/app?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
  });
}

function getQuestionTag(q) {
  return (q && typeof q.tag === 'string' && q.tag.trim()) ? q.tag.trim() : '미분류';
}

function getQuestionCoreLine(q) {
  if (q?.explainV2?.coreConcepts?.[0]?.desc) return q.explainV2.coreConcepts[0].desc;
  if (q?.why?.[0]?.desc) return q.why[0].desc;
  if (q?.tip) return q.tip;
  return '핵심 개념 복습이 필요한 문항입니다.';
}

function buildWeakTagStats(qs, chosenAnswers, answeredFlags) {
  const byTag = {};
  qs.forEach((q, i) => {
    if (!answeredFlags[i]) return;
    const tag = getQuestionTag(q);
    if (!byTag[tag]) byTag[tag] = { attempted: 0, wrong: 0 };
    byTag[tag].attempted += 1;
    if (chosenAnswers[i] !== q.ans) byTag[tag].wrong += 1;
  });

  return Object.entries(byTag)
    .map(([tag, stat]) => {
      const correct = stat.attempted - stat.wrong;
      const accuracy = stat.attempted ? Math.round((correct / stat.attempted) * 100) : 0;
      return { tag, ...stat, accuracy };
    })
    .sort((a, b) => {
      if (b.wrong !== a.wrong) return b.wrong - a.wrong;
      if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
      return b.attempted - a.attempted;
    });
}

function buildWrongNoteItems(qs, chosenAnswers, answeredFlags) {
  const notes = [];
  qs.forEach((q, i) => {
    const picked = chosenAnswers[i];
    if (picked === q.ans) return;

    const isSkip = !answeredFlags[i] || picked < 0;
    const myAnswerText = isSkip
      ? '미응답'
      : `${['①', '②', '③', '④'][picked] || ''} ${q.opts?.[picked] || ''}`.trim();
    const correctText = `${['①', '②', '③', '④'][q.ans] || ''} ${q.opts?.[q.ans] || ''}`.trim();

    notes.push({
      index: i + 1,
      tag: getQuestionTag(q),
      type: q?.type || '이해',
      question: q?.q || '',
      myAnswerText,
      correctText,
      coreLine: getQuestionCoreLine(q),
      isSkip
    });
  });
  return notes;
}

function buildWrongNoteText(examLabel, score, notes, weakTags) {
  const lines = [];
  lines.push(`[${examLabel}] 오답노트`);
  lines.push(`점수: ${score}점`);
  if (weakTags.length) {
    lines.push('약점 태그: ' + weakTags.slice(0, 3).map(t => `${t.tag}(오답 ${t.wrong})`).join(', '));
  }
  lines.push('');

  notes.forEach(n => {
    lines.push(`Q${n.index} [${n.tag}/${n.type}] ${n.isSkip ? '미응답' : '오답'}`);
    lines.push(`문제: ${n.question}`);
    lines.push(`내 답: ${n.myAnswerText}`);
    lines.push(`정답: ${n.correctText}`);
    lines.push(`핵심: ${n.coreLine}`);
    lines.push('');
  });

  return lines.join('\n').trim();
}

async function copyWrongNote() {
  if (!latestWrongNoteText) return;
  const btn = document.getElementById('copyWrongNoteBtn');
  const original = btn ? btn.textContent : '';
  try {
    await navigator.clipboard.writeText(latestWrongNoteText);
    if (btn) btn.textContent = '오답노트 복사 완료';
  } catch {
    if (btn) btn.textContent = '복사 실패 (브라우저 권한 확인)';
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.textContent = original || '오답노트 복사';
      }, 1200);
    }
  }
}

/* ── 결과 화면 ── */
function showResult() {
  stopExamTimer();
  const qs = curQuestions;
  const progressWrap = document.querySelector('.progress-bar-wrap');
  const scope = examMode
    ? (examScopeIndices.length ? examScopeIndices : qs.map((_, i) => i))
    : qs.map((_, i) => i);
  const total = scope.length;
  const correct = scope.filter(i => answered[i] && chosen[i] === qs[i].ans).length;
  const wrong = scope.filter(i => answered[i] && chosen[i] !== qs[i].ans).length;
  const skip = scope.filter(i => !answered[i]).length;
  if (progressWrap) progressWrap.style.display = examMode ? 'block' : 'none';
  const score = Math.round(correct / total * 100);
  const isPass = score >= 60;
  const deg = Math.round(score / 100 * 360);

  document.getElementById('resExamName').textContent = currentExamLabel || '모의고사';
  document.getElementById('resPct').textContent = score;
  document.getElementById('resGrade').textContent = isPass ? '✓ 합격권 (60점 이상)' : '✗ 불합격권 (60점 미만)';
  document.getElementById('resGrade').className = 'result-grade ' + (isPass ? 'pass' : 'fail');
  document.getElementById('resCorrect').textContent = correct;
  document.getElementById('resWrong').textContent = wrong;
  document.getElementById('resSkip').textContent = skip;
  document.getElementById('scoreCircle').style.setProperty('--deg', deg + 'deg');

  const scopedQuestions = scope.map(i => qs[i]);
  const scopedChosen = scope.map(i => chosen[i]);
  const scopedAnswered = scope.map(i => answered[i]);
  const weakTagStats = buildWeakTagStats(scopedQuestions, scopedChosen, scopedAnswered);
  const wrongNotes = buildWrongNoteItems(scopedQuestions, scopedChosen, scopedAnswered);
  latestWrongNoteText = buildWrongNoteText(currentExamLabel || '모의고사', score, wrongNotes, weakTagStats);

  let reviewHTML = '<div class="review-section">';
  reviewHTML += '<div class="review-title">약점 태그 분석</div>';
  if (weakTagStats.length === 0) {
    reviewHTML += '<div class="review-perfect">응답 데이터가 없어 약점 분석을 생략했습니다.</div>';
  } else {
    reviewHTML += '<div class="weak-tag-grid">';
    weakTagStats.slice(0, 6).forEach(stat => {
      const rateClass = stat.accuracy >= 80 ? 'high' : (stat.accuracy >= 60 ? 'mid' : 'low');
      reviewHTML += `
        <div class="weak-tag-card ${rateClass}">
          <div class="weak-tag-name">${escapeHtml(stat.tag)}</div>
          <div class="weak-tag-meta">정확도 ${stat.accuracy}% · 오답 ${stat.wrong}/${stat.attempted}</div>
        </div>`;
    });
    reviewHTML += '</div>';
  }
  reviewHTML += '</div>';

  reviewHTML += '<div class="review-section">';
  reviewHTML += '<div class="review-title">자동 오답노트</div>';
  reviewHTML += '<button class="btn-secondary compact" id="copyWrongNoteBtn" onclick="copyWrongNote()">오답노트 복사</button>';
  if (!wrongNotes.length) {
    reviewHTML += '<div class="review-perfect">전문항 정답! 오답노트가 비어 있습니다.</div>';
  } else {
    reviewHTML += '<div class="review-list">';
    wrongNotes.forEach(note => {
      reviewHTML += `
        <div class="review-note-item">
          <div class="review-note-head">
            <span class="review-num">Q${note.index}</span>
            <span class="review-chip">${escapeHtml(note.tag)}</span>
            <span class="review-chip">${escapeHtml(note.type)}</span>
            <span class="review-mark ${note.isSkip ? 'skip' : 'wrong'}">${note.isSkip ? '미응답' : '오답'}</span>
          </div>
          <div class="review-q">${escapeHtml(note.question)}</div>
          <div class="review-note-line"><strong>내 답:</strong> ${escapeHtml(note.myAnswerText)}</div>
          <div class="review-note-line"><strong>정답:</strong> ${escapeHtml(note.correctText)}</div>
          <div class="review-note-core">핵심 복습: ${escapeHtml(note.coreLine)}</div>
        </div>`;
    });
    reviewHTML += '</div>';
  }
  reviewHTML += '</div>';

  document.getElementById('resReview').innerHTML = reviewHTML;

  showScreen('result');
}

function reviewExam() { showScreen('quiz'); window.scrollTo(0, 0); }
function goHome() {
  stopExamTimer();
  currentExamLabel = '';
  currentMode = 'learn';
  examMode = false;
  examRevealMode = false;
  learnRevealMode = true;
  examScopeIndices = [];
  examCursor = 0;
  selectedSubjectIdx = -1;
  selectedPartIndices = [];
  resetExamTimer();
  updateExamModeUI();
  initHome();
  showScreen('home');
}

/* ────진입점──── */
function bootApp() {
  initThemeToggle();
  bindExamModeControls();
  initHome();
  showScreen('home');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}