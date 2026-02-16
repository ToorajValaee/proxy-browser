#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'VERSION');
if (!fs.existsSync(file)) {
  console.error('VERSION file not found');
  process.exit(1);
}
const raw = fs.readFileSync(file, 'utf8').trim();
if (!raw) {
  console.error('VERSION file empty');
  process.exit(1);
}
const parts = raw.split('.').map(Number);
if (parts.length < 3) parts.push(0);
parts[2] = (parts[2] || 0) + 1; // bump patch
const next = `${parts[0]}.${parts[1]}.${parts[2]}`;
fs.writeFileSync(file, next + '\n', 'utf8');
console.log('Bumped VERSION:', raw, '->', next);
