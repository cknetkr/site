const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');

const COUNT_PER_PART = 30;
const DIFFICULTY_RATIO = { low: 12, mid: 12, high: 6 }; // 4:4:2

const scenarios = [
  '신입 작업자 인수인계 상황',
  '야간 긴급 복구 상황',
  '월간 정기 PM 상황',
  '재가동 직전 상황',
  '품질 이슈 재현 점검 상황',
  '교대 직후 초기 대응 상황'
];

const coachingOpeners = [
  '정답 한 줄로 끝낸다.',
  '실무에서 바로 먹히는 포인트만 본다.',
  '헷갈리는 선택지는 용어만 번지르르하다.',
  '기능사는 기본 순서를 지키는 사람이 붙는다.',
  '가장 비싼 실수는 기본 절차 생략이다.'
];

const safetyCostLines = [
  '순서 하나 틀리면 다운타임과 재작업 비용이 같이 터진다.',
  '임시방편은 당장은 빨라 보여도, 다음 교대에서 사고로 돌아온다.',
  '재현성 없는 조치는 품질과 안전 둘 다 잃는다.',
  '이 단계에서 기준값 확인을 빼면 불량 원인 추적이 막힌다.',
  '기록과 검증을 남겨야 같은 고장을 반복하지 않는다.'
];

const trapLabels = [
  '함정: 단어만 그럴듯한 오답',
  '함정: 순서 뒤집기',
  '함정: 장치 목적 혼동',
  '함정: 임시방편 유도',
  '함정: 타 태그 개념 침범'
];

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle(arr, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(arr, idx) {
  return arr[idx % arr.length];
}

function buildDifficultyPlan(rng) {
  const plan = [
    ...Array(DIFFICULTY_RATIO.low).fill('하'),
    ...Array(DIFFICULTY_RATIO.mid).fill('중'),
    ...Array(DIFFICULTY_RATIO.high).fill('상')
  ];
  return shuffle(plan, rng);
}

function levelTip(level) {
  if (level === '하') return '① 핵심 단어 먼저 고정 → ② 장치 목적 확인 → ③ 노골적 오답 제거';
  if (level === '중') return '① 현상 파악 → ② 기준 절차 대조 → ③ 순서/목적 혼동 오답 소거';
  return '① 위험·품질 우선순위 판단 → ② 기준값/인터록 대조 → ③ 그럴듯한 임시방편 제거';
}

function levelRuleRows(level) {
  if (level === '하') {
    return [
      { keyword: '기본 점검 생략', action: '→ 무조건 소거 (기능사 기초 위반)' },
      { keyword: '장치 목적 오해', action: '→ 무조건 소거 (핵심 개념 불일치)' },
      { keyword: '근거 없는 단정', action: '→ 무조건 소거 (재현성 없음)' }
    ];
  }
  if (level === '중') {
    return [
      { keyword: '순서 뒤바뀜', action: '→ 무조건 소거 (현장 불량/알람 유발)' },
      { keyword: '타 공정 개념 혼입', action: '→ 무조건 소거 (태그 침범)' },
      { keyword: '기준값 확인 누락', action: '→ 무조건 소거 (검증 실패)' }
    ];
  }
  return [
    { keyword: '인터록/안전 우회', action: '→ 즉시 소거 (중대사고 리스크)' },
    { keyword: '임시방편 고착', action: '→ 즉시 소거 (재발 확률 증가)' },
    { keyword: '원인 분석 생략', action: '→ 즉시 소거 (품질 이력 단절)' }
  ];
}

function reorderChoices(correct, wrongs, rng) {
  const mapped = [
    { text: correct, isCorrect: true },
    ...wrongs.map(text => ({ text, isCorrect: false }))
  ];
  const shuffled = shuffle(mapped, rng);
  const ans = shuffled.findIndex(x => x.isCorrect);
  return { shuffled, ans };
}

function buildQuestion(tag, template, qIndex, difficulty, rng) {
  const scene = pick(scenarios, qIndex);
  const qText = `${template.q} (${scene})`;
  const { shuffled, ans } = reorderChoices(template.correct, template.wrongs, rng);
  const opts = shuffled.map(x => x.text);

  const optWhy = shuffled.map((choice, i) => {
    if (i === ans) {
      return `[정답] ${choice.text}가 정석입니다. ${pick(coachingOpeners, qIndex)} 안전·품질·재현성 기준을 동시에 만족합니다.`;
    }
    const reasons = [
      '절차 우선순위가 틀렸습니다.',
      '장치 목적과 다른 조치입니다.',
      '현장에선 재발 리스크가 큽니다.',
      '기준값 검증 없이 단정한 오답입니다.'
    ];
    return `${choice.text}는 ${pick(reasons, qIndex + i)}`;
  });

  const explainOptions = shuffled.map((choice, i) => {
    if (i === ans) {
      return {
        desc: `정답 포인트: ${choice.text}를 먼저 고정하면 판단이 흔들리지 않습니다.`,
        isCorrect: true
      };
    }
    return {
      desc: `오답 포인트: ${choice.text}는 현장에서 가장 자주 나오는 착각 패턴입니다.`,
      trap: pick(trapLabels, qIndex + i)
    };
  });

  const wrongRows = shuffled
    .map((choice, i) => ({ choice, i }))
    .filter(v => v.i !== ans)
    .slice(0, 3)
    .map((v, idx) => ({
      keyword: v.choice.text.slice(0, 22),
      action: `→ 오답 소거 이유: ${pick([
        '핵심 절차를 비켜갑니다.',
        '장치 역할과 맞지 않습니다.',
        '현장 재현성이 떨어집니다.',
        '안전 우선순위를 위반합니다.'
      ], qIndex + idx)}`
    }));

  return {
    tag,
    type: template.type,
    difficulty,
    q: qText,
    opts,
    ans,
    why: [
      { title: '핵심 개념', desc: template.whyCore },
      { title: '실무 판단 포인트', desc: template.whyPractical }
    ],
    tip: levelTip(difficulty),
    rule: { title: '오답 소거 공식', rows: levelRuleRows(difficulty) },
    linkInfo: template.linkInfo,
    optWhy,
    explainV2: {
      coreConcepts: [
        {
          title: '현장 실무 한 줄 요약',
          desc: `${pick(coachingOpeners, qIndex)} ${template.coachLine}`
        },
        {
          title: '안전/비용 직결 포인트',
          desc: pick(safetyCostLines, qIndex)
        }
      ],
      tipFlow: levelTip(difficulty),
      eliminationRule: {
        title: '1타 소거 공식 - 이 문구가 보이면 버린다',
        rows: wrongRows
      },
      options: explainOptions,
      linkInfo: template.linkInfo
    }
  };
}

function buildPart(partNo, tag, templates) {
  const rng = createRng(20260403 + partNo * 101);
  const difficultyPlan = buildDifficultyPlan(rng);

  const questions = [];
  for (let i = 0; i < COUNT_PER_PART; i++) {
    const t = templates[i % templates.length];
    questions.push(buildQuestion(tag, t, i, difficultyPlan[i], rng));
  }

  const payload = {
    meta: {
      title: tag,
      part: partNo,
      count: COUNT_PER_PART,
      tag,
      difficultyRatio: '4:4:2',
      difficultyCount: { 하: 12, 중: 12, 상: 6 }
    },
    questions
  };

  fs.writeFileSync(path.join(dataDir, `part${partNo}.json`), JSON.stringify(payload, null, 2), 'utf8');
  console.log(`✓ part${partNo}.json regenerated (${COUNT_PER_PART}, ratio 4:4:2)`);
}

function t(type, q, correct, wrongs, whyCore, whyPractical, coachLine, linkInfo) {
  return { type, q, correct, wrongs, whyCore, whyPractical, coachLine, linkInfo };
}

const part11Templates = [
  t('이해', '유도전동기 과부하 알람이 반복될 때 1차 점검 순서로 옳은 것은?', '부하 상태, 전류값, 냉각 상태를 순서대로 확인한다.', ['모터 외관 색상만 보고 판단한다.', '알람을 무시하고 연속 운전한다.', '정격표 확인 없이 차단기 용량부터 올린다.'], '모터 보호는 증상보다 원인 경로를 따라 점검해야 정확합니다.', '과부하는 부하·전류·냉각의 복합 문제로 나타나는 경우가 많습니다.', '알람은 끄는 게 목적이 아니라, 원인을 끝내는 게 목적입니다.', '이 개념은 [16. PM/유지보수](data/part16.json) 점검 루틴과 직결됩니다.'),
  t('암기', '인버터(VFD)로 모터 속도를 제어할 때 기본 제어 대상은?', '인가 주파수를 조절해 회전 속도를 제어한다.', ['전원 케이블 굵기만 바꿔 속도를 조절한다.', '접지 저항값만 바꾸면 속도가 변한다.', '베어링 윤활량만 조절하면 속도가 변한다.'], 'VFD의 핵심은 주파수 제어이며, 이것이 회전 속도를 결정합니다.', '전기적 제어 변수와 기계적 유지보수 변수는 구분해서 판단해야 합니다.', '속도 제어 문제에서 주파수를 놓치면 반은 틀린 겁니다.', '이 개념은 [14. 자동제어](data/part14.json) 제어 변수 개념과 연결됩니다.'),
  t('이해', '모터 기동 시 전압 강하로 주변 장비가 리셋될 때 적절한 조치는?', '기동 방식(소프트스타트/인버터)과 전원 용량 여유를 함께 점검한다.', ['리셋 장비의 알람 부저만 끄고 운전한다.', '모든 보호 계전기를 우회해 기동한다.', '모터를 정격보다 큰 퓨즈로 임시 교체한다.'], '기동 전류 영향은 전원 품질과 기동 방식 선택으로 관리해야 합니다.', '보호 우회는 단기 동작은 가능해도 사고 확률을 급격히 높입니다.', '기동 문제는 힘으로 밀어붙이는 게 아니라 방식으로 해결합니다.', '이 개념은 [8. 안전관리](data/part8.json) 인터록 준수 원칙과 직결됩니다.'),
  t('암기', '모터 베어링 이상 징후로 가장 대표적인 것은?', '진동·소음 증가와 온도 상승이 함께 나타난다.', ['회전 속도가 항상 2배로 증가한다.', '절연저항이 자동으로 무한대가 된다.', '기동전류가 항상 0A로 떨어진다.'], '베어링 이상은 기계적 마찰 증가 신호로 먼저 드러납니다.', '조기 징후를 놓치면 샤프트·하우징 손상으로 확대됩니다.', '진동과 온도는 베어링이 보내는 가장 솔직한 경고입니다.', '이 개념은 [10. 센서](data/part10.json) 상태 감시 데이터 해석과 연결됩니다.'),
  t('이해', '삼상 모터에서 한 상 결상(Phase Loss) 발생 시 나타나는 현상으로 옳은 것은?', '토크 저하와 과전류 증가로 과열 위험이 커진다.', ['정상보다 효율이 높아져 전류가 감소한다.', '모터가 자동으로 단상 최적 운전으로 전환된다.', '결상 상태일수록 진동이 줄어든다.'], '결상은 전류 불균형과 발열 증가를 유발하는 대표 고장입니다.', '결상 운전을 지속하면 권선 손상으로 이어집니다.', '결상은 버티는 문제가 아니라 즉시 차단해야 하는 문제입니다.', '이 개념은 [2. 전장조립](data/part2.json) 전원 분배 점검과 직결됩니다.'),
  t('암기', '모터 절연저항 측정의 주된 목적은?', '권선 절연 열화 여부를 사전에 파악하기 위해서다.', ['축 정렬 오차를 직접 보정하기 위해서다.', '베어링 윤활 상태를 정량화하기 위해서다.', '모터 회전수를 즉시 변경하기 위해서다.'], '절연저항 측정은 전기적 건전성 확인 절차입니다.', '절연 열화 조기 발견은 돌발 정지를 예방하는 핵심입니다.', '절연은 보이지 않지만, 고장은 가장 먼저 거기서 시작됩니다.', '이 개념은 [16. PM/유지보수](data/part16.json) 예방 점검 항목과 연결됩니다.'),
  t('이해', '인버터 운전 중 저속에서 토크 부족이 발생할 때 우선 점검할 것은?', '파라미터의 토크 보상 및 주파수-전압 설정(V/f)을 확인한다.', ['모터 커버 색상을 어둡게 도색한다.', '출력 케이블 길이를 임의로 3배 연장한다.', '팬 회전 방향만 바꾸면 해결된다고 본다.'], '저속 토크는 설정 파라미터와 제어 곡선 영향이 큽니다.', '기계적 조치보다 제어 설정 점검이 우선입니다.', '저속 토크 문제는 하드웨어보다 파라미터에서 먼저 잡습니다.', '이 개념은 [14. 자동제어](data/part14.json) 제어 파라미터 최적화와 이어집니다.'),
  t('암기', '모터 축정렬(Misalignment) 불량이 주는 영향으로 옳은 것은?', '진동 증가와 커플링/베어링 수명 단축을 유발한다.', ['모터 효율이 항상 100%로 고정된다.', '기동 전류가 완전히 사라진다.', '권선 절연이 자동 복구된다.'], '축정렬 불량은 기계적 하중 편중을 유발합니다.', '초기에는 작은 진동으로 시작해 장기 손상으로 확대됩니다.', '정렬 1mm 오차가 수명 수천 시간을 날릴 수 있습니다.', '이 개념은 [13. 공기압 장치](data/part13.json) 정렬/체결 기본과 유사한 원리입니다.'),
  t('이해', '모터 교체 후 회전 방향이 반대로 나온 경우 가장 기본적인 조치는?', '삼상 중 임의 두 상을 교체해 회전 방향을 수정한다.', ['접지선을 제거해 방향을 바꾼다.', '모터 하우징을 180도 돌려 설치한다.', '보호 계전기 설정값을 2배로 높인다.'], '삼상 회전 방향은 상순서에 의해 결정됩니다.', '안전 접지와 보호 설정은 회전 방향 조정 수단이 아닙니다.', '방향 문제는 상순서, 안전 문제는 보호회로. 섞지 마세요.', '이 개념은 [2. 전장조립](data/part2.json) 상배열 점검과 직결됩니다.'),
  t('암기', '모터 제어반 점검 시 필수로 확인할 항목은?', '단자 체결 상태와 발열 흔적(변색/탄화)을 확인하는 것이다.', ['패널 외관 먼지 유무만 확인한다.', '작업자 서명란만 먼저 작성한다.', '라벨 폰트 크기만 확인한다.'], '제어반 불량은 접속 불량과 국부 발열에서 자주 시작됩니다.', '체결 점검은 화재·정지 사고를 막는 기본 예방입니다.', '전장 점검은 보이는 곳보다, 타는 냄새 나는 곳을 먼저 봅니다.', '이 개념은 [8. 안전관리](data/part8.json) 전기 화재 예방 항목과 연결됩니다.')
];

const part12Templates = [
  t('이해', '공기압 실린더 속도 제어에서 미터아웃(Meter-out) 방식이 자주 쓰이는 이유는?', '배기측 유량을 제어해 부하 변동 시에도 비교적 안정한 속도를 얻기 위해서다.', ['공급 압력을 무제한으로 높이기 위해서다.', '실린더 스트로크 길이를 자동 변경하기 위해서다.', '방향제어 밸브를 생략하기 위해서다.'], '속도 안정성은 유량 제어 위치에 크게 영향을 받습니다.', '부하 변동 환경에서는 미터아웃이 일반적으로 안정적입니다.', '속도 제어는 압력보다 유량, 유량보다 제어 위치입니다.', '이 개념은 [13. 공기압 장치](data/part13.json) 실린더 동작 안정화와 직결됩니다.'),
  t('암기', '릴리프 밸브(Relief Valve)의 주된 기능은?', '설정 압력 초과 시 배기를 통해 과압을 제한하는 것이다.', ['방향 전환을 수행하는 것이다.', '실린더 위치를 정밀 계측하는 것이다.', '공압 신호를 전기 신호로 변환하는 것이다.'], '릴리프 밸브는 압력 안전장치이지 방향 제어 장치가 아닙니다.', '과압 보호는 배관/장비 보호의 기본입니다.', '압력 제어와 방향 제어를 혼동하면 문제를 절대 못 풉니다.', '이 개념은 [8. 안전관리](data/part8.json) 설비 보호 개념과 연결됩니다.'),
  t('이해', '공기압 회로에서 실린더가 끝까지 가지 못하고 중간에서 멈출 때 우선 확인할 것은?', '공급 압력, 누설 여부, 부하 과다 여부를 순서대로 확인한다.', ['실린더 색상을 바꿔 오염을 줄인다.', '배기 소음기가 없으면 무조건 정상이라 본다.', '밸브 코일 전압과 무관하다고 가정한다.'], '스트로크 미완료는 압력 부족·누설·부하 문제 가능성이 큽니다.', '원인 축을 분리해서 보지 않으면 불필요 교체가 반복됩니다.', '멈춤 증상은 단순해 보여도, 원인은 세 갈래로 봐야 빨리 잡습니다.', '이 개념은 [16. PM/유지보수](data/part16.json) 원인 분리 점검과 직결됩니다.'),
  t('암기', 'FRL 유닛의 구성 순서로 맞는 것은?', 'Filter → Regulator → Lubricator 순서다.', ['Regulator → Filter → Lubricator 순서다.', 'Lubricator → Filter → Regulator 순서다.', '순서는 성능에 영향을 주지 않는다.'], 'FRL은 오염 제거 후 압력 조정, 그 다음 윤활 공급 순서가 기본입니다.', '순서가 틀리면 장치 수명과 제어 안정성이 나빠집니다.', '공기질 먼저, 압력 다음, 윤활 마지막. FRL은 순서 암기입니다.', '이 개념은 [13. 공기압 장치](data/part13.json) 유지관리 기본과 연결됩니다.'),
  t('이해', '공기압 회로에서 배관 길이가 과도하게 길어질 때 나타나는 영향은?', '응답 지연과 압력 손실 증가로 동작 품질이 떨어질 수 있다.', ['압력 손실이 사라져 항상 효율이 향상된다.', '응답성이 무한히 좋아진다.', '밸브 없이도 제어가 가능해진다.'], '배관 길이는 지연과 손실을 동시에 증가시키는 요인입니다.', '불필요한 길이는 제어 성능 저하와 에너지 손실로 이어집니다.', '배관은 길수록 안전하지도, 빠르지도 않습니다.', '이 개념은 [14. 자동제어](data/part14.json) 응답 지연 개념과 유사합니다.'),
  t('암기', '공기압 회로의 체크 밸브(Check Valve) 기능은?', '유체를 한 방향으로만 흐르게 해 역류를 방지한다.', ['유량을 정밀하게 비례 제어한다.', '압력을 자동으로 생성한다.', '실린더 위치를 기억한다.'], '체크 밸브는 단방향 유동을 보장하는 부품입니다.', '역류 방지는 회로 안정성과 보호에 중요합니다.', '체크 밸브 문제는 방향 화살표만 제대로 보면 끝납니다.', '이 개념은 [13. 공기압 장치](data/part13.json) 배관 보호와 직결됩니다.'),
  t('이해', '복동 실린더 반복 동작 시 속도 편차가 점점 커질 때 적절한 조치는?', '유량 제어 밸브 막힘, 수분 혼입, 윤활 상태를 함께 점검한다.', ['압력을 최대로 올려 편차를 덮는다.', '회로도 없이 라인을 임의 교차 결선한다.', '센서 브래킷만 교체하면 해결된다고 본다.'], '속도 편차 증가는 오염·윤활·제어 불균형의 복합 징후일 수 있습니다.', '단일 부품 교체보다 조건 점검이 선행되어야 정확합니다.', '편차는 숨기지 말고 원인을 나눠서 잡아야 재발이 줄어듭니다.', '이 개념은 [16. PM/유지보수](data/part16.json) 트렌드 기반 점검과 연결됩니다.'),
  t('암기', '공기압 제어에서 시퀀스 밸브(Sequence Valve)의 역할은?', '설정 압력 도달 후 다음 동작을 개시하도록 순서를 제어한다.', ['배기 소음을 줄이는 전용 장치다.', '전기 신호를 아날로그로 증폭한다.', '압축기의 회전수를 직접 제어한다.'], '시퀀스 밸브는 압력 조건 기반 순차 동작 제어에 사용됩니다.', '동작 순서 설계는 인터록과 함께 사고 예방에 중요합니다.', '시퀀스는 시간보다 조건. 조건은 결국 압력입니다.', '이 개념은 [14. 자동제어](data/part14.json) 조건 기반 제어와 직결됩니다.'),
  t('이해', '공기압 라인에서 누설이 의심될 때 가장 기본적인 현장 확인 방법은?', '비눗물 또는 누설 전용 검지법으로 연결부를 순차 점검한다.', ['라인 전체를 무조건 교체한다.', '압력계를 제거해 흐름을 눈으로 확인한다.', '누설음이 없으면 점검 없이 종료한다.'], '누설 점검은 단계적 확인이 기본이며 전량 교체가 정답이 아닙니다.', '초기 누설 발견은 에너지 손실과 불량 재발을 줄입니다.', '누설은 추측이 아니라 검지로 확인해야 합니다.', '이 개념은 [3. 진공/플라즈마](data/part3.json) Leak Check 사고와 연결됩니다.'),
  t('암기', '공기압 제어 회로 점검 기록에서 핵심 항목은?', '설정 압력, 유량 조정값, 조치 전후 결과를 남기는 것이다.', ['작업자 메모만 간단히 남긴다.', '정상 시 기록은 생략한다.', '부품 단가만 상세히 기록한다.'], '점검 기록은 재현성과 재발 방지의 기반 데이터입니다.', '조치 전후 비교 데이터가 있어야 원인 검증이 가능합니다.', '기록 없는 조치는 다음 날 다시 같은 고장을 부릅니다.', '이 개념은 [16. PM/유지보수](data/part16.json) 이력 관리 핵심과 직결됩니다.')
];

buildPart(11, '모터 제어', part11Templates);
buildPart(12, '공기압 제어', part12Templates);

const partsPath = path.join(dataDir, 'parts.json');
if (fs.existsSync(partsPath)) {
  const partsData = JSON.parse(fs.readFileSync(partsPath, 'utf8'));
  if (Array.isArray(partsData.parts)) {
    partsData.parts = partsData.parts.map(p => {
      if (/part1[1-2]\.json$/.test(p.file)) return { ...p, count: COUNT_PER_PART };
      return p;
    });
    fs.writeFileSync(partsPath, JSON.stringify(partsData, null, 2), 'utf8');
    console.log('✓ parts.json synced for part11~12');
  }
}
