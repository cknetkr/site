const fs = require('fs');
const path = require('path');

function createRng(seed) {
  let state = seed >>> 0;
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

function parseArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const arg = process.argv.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const fileArg = parseArg('file');
const countArg = Number(parseArg('count', '4'));
const seedArg = Number(parseArg('seed', String(Date.now() & 0xffffffff)));
const outArg = parseArg('out', '');

if (!fileArg) {
  console.error('Usage: node scripts/sample_part_questions.js --file=data/part3.json --count=4 --seed=12345 [--out=data/part3_sample.json]');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.isAbsolute(fileArg) ? fileArg : path.join(rootDir, fileArg);

if (!fs.existsSync(sourcePath)) {
  console.error(`File not found: ${sourcePath}`);
  process.exit(1);
}

const partData = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const questions = Array.isArray(partData.questions) ? partData.questions : [];

if (questions.length === 0) {
  console.error('No questions found in source file.');
  process.exit(1);
}

const pickCount = Math.min(Math.max(1, countArg), questions.length);
const rng = createRng(seedArg);
const sampled = shuffleWithRng(questions, rng).slice(0, pickCount);

const output = {
  meta: {
    title: partData.meta?.title || '파트 샘플',
    part: partData.meta?.part || null,
    count: sampled.length,
    tag: partData.meta?.tag || partData.meta?.title || 'Unknown',
    source: path.relative(rootDir, sourcePath).replace(/\\/g, '/'),
    sampledAt: new Date().toISOString(),
    seed: seedArg
  },
  questions: sampled
};

if (outArg) {
  const outPath = path.isAbsolute(outArg) ? outArg : path.join(rootDir, outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Saved: ${outPath}`);
  console.log(`Picked: ${sampled.length} / ${questions.length}`);
} else {
  console.log(JSON.stringify(output, null, 2));
}
