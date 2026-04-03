const fs = require('fs');

const source = JSON.parse(fs.readFileSync('data/exam1.json', 'utf8'));
const questions = source.questions.slice(0, 60);

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithRng(items, rng) {
  const copy = items.map(item => (Array.isArray(item) ? [...item] : { ...item }));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cloneQuestion(question, rng) {
  const next = JSON.parse(JSON.stringify(question));
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

function buildExam(seed) {
  const rng = createRng(seed);
  const shuffledQuestions = shuffleWithRng(questions, rng).map(q => cloneQuestion(q, rng));

  return {
    meta: {
      title: `모의고사 ${seed - 2026000}`,
      count: shuffledQuestions.length,
      pass_score: source.meta?.pass_score ?? 60,
      version: `1.${seed - 2026000}`,
      source: 'exam1.json',
      seed
    },
    questions: shuffledQuestions
  };
}

const exam1 = {
  meta: {
    title: source.meta?.title || '1회차 모의고사',
    count: questions.length,
    pass_score: source.meta?.pass_score ?? 60,
    version: source.meta?.version || '1.0'
  },
  questions
};

fs.writeFileSync('data/exam1.json', JSON.stringify(exam1, null, 2), 'utf8');
console.log(`✓ data/exam1.json updated (${exam1.questions.length} questions)`);

for (let i = 2; i <= 5; i++) {
  const seed = 2026000 + i;
  const exam = buildExam(seed);
  fs.writeFileSync(`data/exam${i}.json`, JSON.stringify(exam, null, 2), 'utf8');
  console.log(`✓ data/exam${i}.json created (${exam.questions.length} questions)`);
}
