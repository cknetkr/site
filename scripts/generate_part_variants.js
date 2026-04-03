const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const partsMeta = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'parts.json'), 'utf8'));

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle(items, rng) {
  const copy = items.map(item => JSON.parse(JSON.stringify(item)));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function shuffleQuestion(question, rng) {
  const copy = JSON.parse(JSON.stringify(question));
  const mapped = copy.opts.map((text, original) => ({ text, original }));
  const shuffled = shuffle(mapped, rng);

  copy.opts = shuffled.map(item => item.text);
  copy.ans = shuffled.findIndex(item => item.original === question.ans);

  if (Array.isArray(question.optWhy)) {
    copy.optWhy = shuffled.map(item => question.optWhy[item.original]);
  }

  if (copy.explainV2?.options && Array.isArray(question.explainV2?.options)) {
    copy.explainV2.options = shuffled.map(item => question.explainV2.options[item.original]);
  }

  return copy;
}

const outputDir = path.join(rootDir, 'data', 'part-variants');
fs.mkdirSync(outputDir, { recursive: true });

const manifest = [];

partsMeta.parts.forEach((part, partIndex) => {
  const source = JSON.parse(fs.readFileSync(path.join(rootDir, part.file), 'utf8'));
  const variants = [];

  for (let variant = 1; variant <= 5; variant++) {
    const rng = createRng((partIndex + 1) * 1000 + variant);
    const questions = shuffle(source.questions, rng).map(q => shuffleQuestion(q, rng));
    const payload = {
      meta: {
        title: `${part.tag} 변형 ${variant}`,
        part: part.tag,
        count: questions.length,
        variant,
        source: part.file
      },
      questions
    };

    const outFile = path.join(outputDir, `${String(partIndex + 1).padStart(2, '0')}_v${variant}.json`);
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
    variants.push(outFile);
  }

  manifest.push({
    tag: part.tag,
    source: part.file,
    variants
  });
});

fs.writeFileSync(path.join(rootDir, 'data', 'part-variants.json'), JSON.stringify({ parts: manifest }, null, 2), 'utf8');
console.log(`✓ generated ${manifest.length} part groups x 5 variants`);