const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const filePath = path.join(root, 'data', 'part10.json');

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sanitizeKoreanTone(text) {
  if (typeof text !== 'string') return text;
  let t = text;

  const replacements = [
    [/멍청한?/g, '위험한'],
    [/무식한?/g, '근거 없는'],
    [/죽이는/g, '위험에 빠뜨리는'],
    [/동료를\s*위험에\s*빠뜨리는\s*가장\s*위험한\s*짓/g, '현장 안전을 크게 해치는 위험한 행동'],
    [/100%/g, '대부분'],
    [/무조건/g, '우선'],
    [/절대/g, '원칙적으로'],
    [/야매/g, '임시방편'],
    [/단순무식/g, '근거 없는'],
    [/속 시원한/g, '즉흥적인']
  ];

  for (const [re, to] of replacements) {
    t = t.replace(re, to);
  }

  // trap 라벨 오탈자/공백 정리
  t = t.replace(/함\s+정:/g, '함정:');
  t = t.replace(/\s{2,}/g, ' ').trim();

  return t;
}

function normalizeLinkInfo(text) {
  if (typeof text !== 'string') return text;
  let t = text;

  // <strong>16. PM/유지보수</strong> -> [16. PM/유지보수](data/part16.json)
  t = t.replace(/<strong>\s*(\d+)\.\s*([^<]+?)\s*<\/strong>/g, (_, p1, p2) => {
    const n = Number(p1);
    if (Number.isFinite(n) && n >= 1 && n <= 16) {
      return `[${n}. ${p2.trim()}](data/part${n}.json)`;
    }
    return `${p1}. ${p2.trim()}`;
  });

  // 불필요한 strong 제거
  t = t.replace(/<\/?strong>/g, '');
  return t;
}

function deepMapStrings(value, mapper) {
  if (typeof value === 'string') return mapper(value);
  if (Array.isArray(value)) return value.map(v => deepMapStrings(v, mapper));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = deepMapStrings(value[k], mapper);
    return out;
  }
  return value;
}

function main() {
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw);

  const qs = Array.isArray(json.questions) ? json.questions : [];

  // 메타 정합성 개선
  json.meta = json.meta || {};
  json.meta.title = `센서_기능사실무_${qs.length}제`;
  json.meta.count = qs.length;
  const diffCount = qs.reduce((a, q) => {
    const d = q.difficulty || '중';
    a[d] = (a[d] || 0) + 1;
    return a;
  }, {});
  json.meta.difficultyCount = {
    하: diffCount['하'] || 0,
    중: diffCount['중'] || 0,
    상: diffCount['상'] || 0
  };
  json.meta.difficultyRatio = `${json.meta.difficultyCount.하}:${json.meta.difficultyCount.중}:${json.meta.difficultyCount.상}`;

  // 정답 위치 분산 + 문구 정리 + 링크 포맷 정규화
  const correctPrefixes = ['정답 포인트:', '핵심 정답:', '실무 정답:'];
  const wrongPrefixes = ['오답 포인트:', '오답 근거:', '주의 포인트:'];

  const normalizedQuestions = qs.map((q, idx) => {
    const rng = createRng(20260403 + (idx + 1) * 97);

    const opts = Array.isArray(q.opts) ? q.opts : [];
    const ans = Number.isInteger(q.ans) ? q.ans : 0;

    if (opts.length === 4 && ans >= 0 && ans < 4) {
      const mapped = opts.map((text, i) => ({ text, isCorrect: i === ans }));
      const shuffled = shuffle(mapped, rng);
      q.opts = shuffled.map(v => v.text);
      q.ans = shuffled.findIndex(v => v.isCorrect);
    }

    if (q.explainV2 && Array.isArray(q.explainV2.options)) {
      q.explainV2.options = q.explainV2.options.map((o, oi) => {
        if (!o || typeof o !== 'object') return o;
        const copy = { ...o };
        if (typeof copy.desc === 'string') {
          copy.desc = copy.desc
            .replace(/^정답 포인트:/, correctPrefixes[(idx + oi) % correctPrefixes.length])
            .replace(/^오답 포인트:/, wrongPrefixes[(idx + oi) % wrongPrefixes.length]);
        }
        if (typeof copy.trap === 'string') copy.trap = sanitizeKoreanTone(copy.trap);
        return copy;
      });
    }

    if (typeof q.linkInfo === 'string') q.linkInfo = normalizeLinkInfo(q.linkInfo);
    if (q.explainV2 && typeof q.explainV2.linkInfo === 'string') {
      q.explainV2.linkInfo = normalizeLinkInfo(q.explainV2.linkInfo);
    }

    const cleaned = deepMapStrings(q, sanitizeKoreanTone);
    return deepMapStrings(cleaned, normalizeLinkInfo);
  });

  json.questions = normalizedQuestions;

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
  console.log(`✓ normalized ${path.relative(root, filePath)} (${normalizedQuestions.length} questions)`);
}

main();
