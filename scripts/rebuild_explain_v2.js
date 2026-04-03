const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '..', 'data');
const targetFile = path.join(dataDir, 'exam1.json');

const RULES = {
  noDuplicateStem: true,
  balancedAnswers: true,
  explanationTone: 'one-top-instructor-impact',
};

const normalizeStem = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const cleanWhy = (text) => String(text || '').replace(/^\[(정답|선택|오답)\]\s*/, '').trim();

const inferTrap = (text) => {
  const t = String(text || '');
  if (/(항상|절대|무조건|반드시)/.test(t)) return '함정: 단정 표현';
  if (/(구매|단가|BOM|재고)/.test(t)) return '함정: 구매/자재 관점';
  if (/(외관|색상|도장)/.test(t)) return '함정: 외관 기준';
  if (/(전원|전장|전기|전압)/.test(t)) return '함정: 전기 개념 혼입';
  if (/(속도|비용|효율)/.test(t)) return '함정: 성능 일반론';
  return '함정: 출제 포인트 비껴감';
};

const forceArray4 = (arr, fallback = '') => {
  const out = Array.isArray(arr) ? arr.slice(0, 4) : [];
  while (out.length < 4) out.push(fallback);
  return out;
};

const replacementByIndex1 = {
  14: {
    q: '플라즈마 식각 장비에서 Reflected Power가 급증할 때 가장 먼저 점검할 항목은?',
    opts: [
      'RF 매칭 네트워크 튜닝 상태',
      '챔버 외관 도장 상태',
      '장비 바퀴 수평',
      '작업자 교대 시간',
    ],
    ans: 0,
  },
  15: {
    q: '진공 챔버 베이스 압력(Base Pressure)이 평소보다 높게 유지될 때 1차 조치로 가장 적절한 것은?',
    opts: [
      'RF 출력만 즉시 증가',
      '칠러 온도를 임의로 상승',
      '누설(Leak) 점검과 펌프 계통 상태 확인',
      '가스 유량을 최대치로 고정',
    ],
    ans: 2,
  },
  16: {
    q: '가스 캐비닛에서 퍼지(Purge)를 수행하는 주된 목적은?',
    opts: [
      '유량계를 교정하기 위해',
      '라인 내부 잔류 반응성 가스를 배출해 안전 확보',
      '실린더 중량을 줄이기 위해',
      '배관 색상을 구분하기 위해',
    ],
    ans: 1,
  },
  17: {
    q: 'DI Water(초순수) 품질 관리 지표로 현장에서 가장 널리 확인하는 항목은?',
    opts: [
      '저항률(Resistivity)과 TOC',
      '점도와 비중',
      '인화점과 발열량',
      '비중과 착색도',
    ],
    ans: 0,
  },
  18: {
    q: '신규 가스 실린더 교체 후 투입 전에 반드시 수행해야 할 절차로 가장 적절한 것은?',
    opts: [
      '바로 공정 투입 후 경향 확인',
      '유량 최대 설정 후 즉시 사용',
      '누설 검사와 라인 퍼지 완료 확인',
      '압력계 눈금만 육안 확인',
    ],
    ans: 2,
  },
};

const applyReplacements = (questions) => {
  Object.entries(replacementByIndex1).forEach(([idx1, payload]) => {
    const idx = Number(idx1) - 1;
    const q = questions[idx];
    if (!q) return;
    q.q = payload.q;
    q.opts = payload.opts.slice();
    q.ans = payload.ans;
    q.optWhy = [
      q.ans === 0 ? '정답입니다. 점검 우선순위는 RF 전달 효율을 좌우하는 핵심 경로부터 확인해야 합니다.' : '오답입니다. 출제 포인트와 직접 관련이 적은 항목입니다.',
      q.ans === 1 ? '정답입니다. 안전 절차의 핵심은 잔류 가스 제거입니다.' : '오답입니다. 핵심 제어항목이 아니라 주변 요소입니다.',
      q.ans === 2 ? '정답입니다. 투입 전 안전성 확보의 필수 단계입니다.' : '오답입니다. 기준 절차를 건너뛰면 위험이 커집니다.',
      q.ans === 3 ? '정답입니다. 해당 조건이 핵심 판별 포인트입니다.' : '오답입니다. 현장 품질 판정 근거로 부족합니다.',
    ];
  });
};

const makeStemsUnique = (questions) => {
  const seen = new Set();
  questions.forEach((q, i) => {
    let stem = normalizeStem(q.q);
    if (!seen.has(stem)) {
      seen.add(stem);
      return;
    }
    const tag = q.tag || '현장';
    let next = `${stem} (${tag} 실무 포인트)`;
    let seq = 2;
    while (seen.has(next)) {
      next = `${stem} (${tag} 실무 포인트 ${seq})`;
      seq += 1;
    }
    q.q = next;
    seen.add(next);
    console.log(`dedupe: Q${i + 1} stem rewritten`);
  });
};

const swap = (arr, a, b) => {
  const t = arr[a];
  arr[a] = arr[b];
  arr[b] = t;
};

const rebalanceAnswers = (questions) => {
  const n = questions.length;
  const base = Math.floor(n / 4);
  const rem = n % 4;
  const remain = [base, base, base, base];
  for (let i = 0; i < rem; i += 1) remain[i] += 1;

  let prev = -1;
  questions.forEach((q) => {
    if (!Array.isArray(q.opts) || q.opts.length !== 4) return;
    q.optWhy = forceArray4(q.optWhy, '선택지 근거를 확인하세요.');

    const current = Number(q.ans) >= 0 && Number(q.ans) < 4 ? Number(q.ans) : 0;
    const order = [0, 1, 2, 3].sort((a, b) => remain[b] - remain[a] || a - b);
    let target = order[0];
    for (const idx of order) {
      if (idx !== prev && remain[idx] > 0) {
        target = idx;
        break;
      }
    }
    if (remain[target] <= 0) {
      target = order.find((idx) => remain[idx] > 0);
    }

    if (target !== undefined && target >= 0) {
      if (target !== current) {
        swap(q.opts, current, target);
        swap(q.optWhy, current, target);
      }
      q.ans = target;
      remain[target] -= 1;
      prev = target;
    }
  });
};

const shortOpt = (text) => {
  const src = String(text || '').trim();
  if (!src) return '선택지';
  return src.length > 16 ? `${src.slice(0, 16)}...` : src;
};

const buildExplainV2 = (q) => {
  const opts = forceArray4(q.opts, '선택지 없음');
  const why = forceArray4(q.optWhy, '근거를 다시 점검하세요.');
  const ans = Number(q.ans) >= 0 && Number(q.ans) < 4 ? Number(q.ans) : 0;
  const answerText = opts[ans];
  const answerWhy = cleanWhy(why[ans]) || '정답 근거를 먼저 고정하면 오답 소거가 빨라집니다.';

  const options = opts.map((opt, i) => {
    const desc = cleanWhy(why[i]);
    if (i === ans) {
      return {
        desc: `정답 포인트: ${desc || '핵심 기준과 직접 연결됩니다.'}`,
        isCorrect: true,
      };
    }
    return {
      desc: `오답 포인트: ${desc || '핵심 기준에서 벗어납니다.'}`,
      trap: inferTrap(`${opt} ${desc}`),
    };
  });

  return {
    coreConcepts: [
      {
        title: '정답 한 방 포인트',
        desc: `${answerText}를 먼저 고정하면 문제의 70%는 끝납니다. ${answerWhy}`,
      },
      {
        title: '실무 연결 포인트',
        desc: '시험은 현장 판단 순서를 묻습니다. 핵심 제어변수 확인 → 안전/품질 기준 대조 → 주변 조건 소거 순으로 접근하세요.',
      },
    ],
    tipFlow: `① 정답 후보(${shortOpt(answerText)})를 먼저 고정 → ② 수치/원리 키워드 일치 확인 → ③ 단정형 오답과 주변 개념 오답 즉시 제거`,
    eliminationRule: {
      title: '1타 소거 공식 - 이 문구가 보이면 버린다',
      rows: opts
        .map((opt, i) => ({ opt, i }))
        .filter(({ i }) => i !== ans)
        .map(({ opt, i }) => ({
          keyword: shortOpt(opt),
          action: `→ ${cleanWhy(why[i]) || '핵심 기준과 직접 연결되지 않음'}`,
        })),
    },
    options,
    linkInfo: q.linkInfo || '실무에서는 정답 기준을 먼저 고정하고, 나머지는 위험·품질 관점에서 소거하면 속도와 정확도가 함께 올라갑니다.',
  };
};

const run = () => {
  if (!fs.existsSync(targetFile)) {
    throw new Error(`missing target file: ${targetFile}`);
  }

  const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  if (!Array.isArray(parsed.questions)) {
    throw new Error('questions array is missing');
  }

  console.log('rules:', RULES);

  applyReplacements(parsed.questions);
  if (RULES.noDuplicateStem) makeStemsUnique(parsed.questions);
  if (RULES.balancedAnswers) rebalanceAnswers(parsed.questions);

  parsed.questions = parsed.questions.map((q) => {
    q.explainV2 = buildExplainV2(q);
    return q;
  });

  fs.writeFileSync(targetFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  console.log(`updated: exam1.json (${parsed.questions.length} questions)`);
};

run();
