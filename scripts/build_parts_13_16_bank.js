const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const TARGET_COUNT = 30;

const targetParts = [13, 14, 15, 16];

const situationPhrases = [
  '야간 점검 직전',
  '라인 재기동 직전',
  'PM 완료 직후',
  '초기 셋업 단계',
  '이상 알람 발생 직후',
  '교대 인수인계 직후',
  '월간 정기 점검',
  '시운전 단계',
  '긴급 복구 상황',
  '품질 이슈 재현 점검'
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

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function remapQuestion(base, rng, variantIndex) {
  const q = deepClone(base);
  const mapped = q.opts.map((text, idx) => ({ text, idx }));
  const shuffled = shuffle(mapped, rng);

  q.opts = shuffled.map(v => v.text);
  q.ans = shuffled.findIndex(v => v.idx === base.ans);

  if (Array.isArray(base.optWhy)) {
    q.optWhy = shuffled.map(v => base.optWhy[v.idx]);
  }

  if (q.explainV2 && Array.isArray(base.explainV2?.options)) {
    q.explainV2.options = shuffled.map(v => base.explainV2.options[v.idx]);
  }

  const phrase = situationPhrases[variantIndex % situationPhrases.length];
  q.q = `${base.q} (${phrase})`;

  return q;
}

function buildBank(partNo) {
  const filePath = path.join(dataDir, `part${partNo}.json`);
  const src = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const base = src.questions || [];
  if (!base.length) {
    throw new Error(`part${partNo}.json has no questions.`);
  }

  const rng = createRng(20260403 + partNo);
  const out = [];

  for (let i = 0; i < TARGET_COUNT; i++) {
    const picked = base[i % base.length];
    out.push(remapQuestion(picked, rng, i));
  }

  const payload = {
    meta: {
      title: src.meta?.title || `Part ${partNo}`,
      part: partNo,
      count: out.length,
      tag: src.meta?.tag || src.meta?.title || `part${partNo}`
    },
    questions: out
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`✓ part${partNo}.json -> ${out.length} questions`);
}

for (const partNo of targetParts) {
  buildBank(partNo);
}

const partsPath = path.join(dataDir, 'parts.json');
if (fs.existsSync(partsPath)) {
  const parts = JSON.parse(fs.readFileSync(partsPath, 'utf8'));
  if (Array.isArray(parts.parts)) {
    parts.parts = parts.parts.map(p => {
      if (targetParts.includes(p.file.match(/part(\d+)\.json/) ? Number(p.file.match(/part(\d+)\.json/)[1]) : -1)) {
        return { ...p, count: TARGET_COUNT };
      }
      return p;
    });
    fs.writeFileSync(partsPath, JSON.stringify(parts, null, 2), 'utf8');
    console.log('✓ parts.json counts updated for part13~16');
  }
}
