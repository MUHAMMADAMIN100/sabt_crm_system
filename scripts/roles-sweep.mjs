// Одноразовый свип реструктуризации ролей (12.06.2026):
//   - project_manager + head_smm (пара) → video_director
//   - marketer + targetologist (пара)  → video_editor, organizer, storymaker
// Спец-места (SMM-списки, ключи объектов, union-типы) правятся вручную.
// Запуск: node scripts/roles-sweep.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOTS = [
  fileURLToPath(new URL('../backend/src/modules', import.meta.url)),
  fileURLToPath(new URL('../frontend/src', import.meta.url)),
];

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (['.tsx', '.ts'].includes(extname(p))) files.push(p);
  }
}
ROOTS.forEach(walk);

const RULES = [
  // PM+HEAD_SMM пары → VIDEO_DIRECTOR
  [/UserRole\.PROJECT_MANAGER,\s*UserRole\.HEAD_SMM/g, 'UserRole.VIDEO_DIRECTOR'],
  [/\bPROJECT_MANAGER,\s*HEAD_SMM\b/g, 'VIDEO_DIRECTOR'],
  [/'project_manager',\s*'head_smm'/g, "'video_director'"],
  // expression-форма: role === 'project_manager' || role === 'head_smm'
  [/(\w+(?:\.\w+)*)\s*===\s*'project_manager'\s*\|\|\s*\1\s*===\s*'head_smm'/g, "$1 === 'video_director'"],
  // marketer+targetologist пары → новые исполнители
  [/UserRole\.MARKETER,\s*UserRole\.TARGETOLOGIST/g, 'UserRole.VIDEO_EDITOR, UserRole.ORGANIZER, UserRole.STORYMAKER'],
  [/'marketer',\s*'targetologist'/g, "'video_editor', 'organizer', 'storymaker'"],
];

let changed = 0, total = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  let after = before, n = 0;
  for (const [re, to] of RULES) {
    after = after.replace(re, (..._args) => { n++; return to; });
  }
  if (after !== before) {
    writeFileSync(f, after, 'utf8');
    changed++; total += n;
    console.log(`${f.split(/[\\/]/).slice(-2).join('/')}: ${n}`);
  }
}
console.log(`\nDone: ${changed} files, ${total} replacements`);
