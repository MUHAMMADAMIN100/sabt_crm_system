// Одноразовый свип: перевод всех цветных tailwind-классов и hex-кодов
// в монохром. Красный и зелёный сохраняются (сигнальные цвета).
// Запуск: node scripts/mono-sweep.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../frontend/src', import.meta.url));

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (['.tsx', '.ts'].includes(extname(p))) files.push(p);
  }
})(ROOT);

// Цветные hue → surface (тот же оттенок). red/green не трогаем.
const HUES = 'violet|purple|indigo|fuchsia|amber|orange|sky|cyan|teal|blue|pink|rose|yellow|lime|slate';
const PREFIXES = 'bg|text|border|ring|from|to|via|divide|decoration|fill|stroke|shadow|accent|caret|outline';
const hueRe = new RegExp(`\\b(${PREFIXES})-(?:${HUES})-`, 'g');
const emeraldRe = new RegExp(`\\b(${PREFIXES})-emerald-`, 'g');

// Hex-карта: фиолетовые/жёлтые/синие → серые. Зелёный/красный остаются.
const HEX_MAP = {
  '#6b4fcf': '#18181b',
  '#a855f7': '#71717a',
  '#f59e0b': '#8a8a93',
  '#06b6d4': '#a1a1aa',
  '#ec4899': '#b4b4bb',
  '#fbbf24': '#a1a1aa',
  '#facc15': '#b4b4bb',
  '#f97316': '#8a8a93',
  '#fb7185': '#b4b4bb',
  '#f472b6': '#b4b4bb',
  '#ddd6fe': '#e4e4e7',
  '#eff2ff': '#f4f4f5',
  '#e2e8f0': '#e4e4e7',
  '#94a3b8': '#a1a1aa',
  '#f8fafc': '#fafafa',
  '#1e293b': '#27272a',
  '#64748b': '#71717a',
  '#f1f5f9': '#f4f4f5',
  '#8b5cf6': '#71717a',
  '#7c3aed': '#52525b',
  '#6366f1': '#71717a',
  '#4f46e5': '#3f3f46',
  '#3b82f6': '#8a8a93',
  '#0ea5e9': '#a1a1aa',
  '#14b8a6': '#a1a1aa',
  '#eab308': '#b4b4bb',
  '#d946ef': '#b4b4bb',
};
const hexRe = new RegExp(`(${Object.keys(HEX_MAP).join('|')})`, 'gi');

let changedFiles = 0, totalRepl = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  let n = 0;
  let after = before
    .replace(hueRe, (m, p1) => { n++; return `${p1}-surface-`; })
    .replace(emeraldRe, (m, p1) => { n++; return `${p1}-green-`; })
    .replace(hexRe, (m) => { n++; return HEX_MAP[m.toLowerCase()] || m; });
  if (after !== before) {
    writeFileSync(f, after, 'utf8');
    changedFiles++;
    totalRepl += n;
    console.log(`${f.replace(ROOT, '')}: ${n}`);
  }
}
console.log(`\nDone: ${changedFiles} files, ~${totalRepl} replacements`);
