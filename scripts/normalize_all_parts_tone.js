const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');

function sanitizeKoreanTone(text) {
  if (typeof text !== 'string') return text;
  let t = text;

  const replacements = [
    [/멍청한?/g, '위험한'],
    [/무식한?/g, '근거 없는'],
    [/죽이는/g, '위험에 빠뜨리는'],
    [/100%/g, '대부분'],
    [/무조건/g, '우선'],
    [/절대/g, '원칙적으로'],
    [/야매/g, '임시방편'],
    [/단순무식/g, '근거 없는'],
    [/속 시원한/g, '즉흥적인'],
    [/함\s+정:/g, '함정:']
  ];

  for (const [re, to] of replacements) {
    t = t.replace(re, to);
  }

  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

function normalizeLinkInfo(text) {
  if (typeof text !== 'string') return text;
  let t = text;

  t = t.replace(/<strong>\s*(\d+)\.\s*([^<]+?)\s*<\/strong>/g, (_, p1, p2) => {
    const n = Number(p1);
    if (Number.isFinite(n) && n >= 1 && n <= 16) {
      return `[${n}. ${p2.trim()}](data/part${n}.json)`;
    }
    return `${p1}. ${p2.trim()}`;
  });

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

function normalizeExplainPrefixes(q, idx) {
  if (!q || !q.explainV2 || !Array.isArray(q.explainV2.options)) return q;

  const correctPrefixes = ['정답 포인트:', '핵심 정답:', '실무 정답:'];
  const wrongPrefixes = ['오답 포인트:', '오답 근거:', '주의 포인트:'];

  q.explainV2.options = q.explainV2.options.map((o, oi) => {
    if (!o || typeof o !== 'object' || typeof o.desc !== 'string') return o;
    const out = { ...o };
    out.desc = out.desc
      .replace(/^정답 포인트:/, correctPrefixes[(idx + oi) % correctPrefixes.length])
      .replace(/^오답 포인트:/, wrongPrefixes[(idx + oi) % wrongPrefixes.length]);
    return out;
  });

  return q;
}

function normalizeOneFile(partNo) {
  const filePath = path.join(dataDir, `part${partNo}.json`);
  if (!fs.existsSync(filePath)) return { partNo, changed: false, reason: 'missing' };

  const original = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(original);

  const qs = Array.isArray(json.questions) ? json.questions : [];
  const normalizedQuestions = qs.map((q, idx) => {
    let out = JSON.parse(JSON.stringify(q));
    out = normalizeExplainPrefixes(out, idx);

    if (typeof out.linkInfo === 'string') out.linkInfo = normalizeLinkInfo(out.linkInfo);
    if (out.explainV2 && typeof out.explainV2.linkInfo === 'string') {
      out.explainV2.linkInfo = normalizeLinkInfo(out.explainV2.linkInfo);
    }

    out = deepMapStrings(out, sanitizeKoreanTone);
    out = deepMapStrings(out, normalizeLinkInfo);
    return out;
  });

  json.questions = normalizedQuestions;

  const next = JSON.stringify(json, null, 2);
  const changed = next !== original;
  if (changed) fs.writeFileSync(filePath, next, 'utf8');

  return { partNo, changed };
}

function main() {
  const results = [];
  for (let n = 1; n <= 16; n++) {
    const r = normalizeOneFile(n);
    results.push(r);
  }

  const changed = results.filter(r => r.changed).map(r => r.partNo);
  const skipped = results.filter(r => !r.changed && r.reason === 'missing').map(r => r.partNo);

  console.log(`changedParts: ${changed.length ? changed.join(', ') : '(none)'}`);
  if (skipped.length) console.log(`missingParts: ${skipped.join(', ')}`);
}

main();
