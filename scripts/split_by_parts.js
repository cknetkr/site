const fs = require('fs');
const path = require('path');

// exam1.json 읽기
const exam = JSON.parse(fs.readFileSync('data/exam1.json', 'utf8'));
const questions = exam.questions;

// 파트별로 그룹화
const parts = {};
questions.forEach(q => {
  const tag = q.tag || 'Unknown';
  if (!parts[tag]) {
    parts[tag] = [];
  }
  parts[tag].push(q);
});

// 각 파트별 파일 생성
const partFiles = {};
let partNum = 1;

Object.entries(parts).forEach(([tag, qs]) => {
  const partFile = `part${partNum}.json`;
  const meta = {
    title: tag,
    part: partNum,
    count: qs.length,
    tag: tag
  };
  
  const partData = {
    meta,
    questions: qs
  };
  
  fs.writeFileSync(`data/${partFile}`, JSON.stringify(partData, null, 2), 'utf8');
  partFiles[tag] = `data/${partFile}`;
  console.log(`✓ ${partFile} created: ${tag} (${qs.length} questions)`);
  partNum++;
});

// parts.json 생성 (로드 메타데이터)
const partsMeta = {
  parts: Object.entries(parts).map(([tag, qs]) => ({
    tag,
    count: qs.length,
    file: `data/part${Object.keys(parts).length === 1 ? 1 : Object.keys(parts).indexOf(tag) + 1}.json`
  }))
};

fs.writeFileSync('data/parts.json', JSON.stringify(partsMeta, null, 2), 'utf8');
console.log('\n✓ parts.json created (metadata for all parts)');
console.log(`\nTotal: ${partNum - 1} parts, ${questions.length} questions`);
