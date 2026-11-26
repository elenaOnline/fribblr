// Guards the rebrand: the old product name must not come back into anything a person or an agent reads.
//
// Scans the same files as scripts/rebrand.mjs (strings, markup and prose; code comments are ignored) for the
// word "tinka" in any case, including "Tinkas", and fails on every occurrence that is not in ALLOWED below.
//
// When this fails after an upstream merge:
//   1. node scripts/rebrand.mjs --write      renames what its rules can decide
//   2. node scripts/rebrand.mjs --residual   lists what is left; fix those by hand
//   3. a name that is plumbing (storage key, DOM class, event, file format, a credit to upstream) goes into
//      ALLOWED, with the reason. docs/BRANDING.md says what still says tinka and why.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, mentions } from '../scripts/rebrand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each entry says why a remaining "tinka" is allowed. `token` is tested against the text from the start of
// the surrounding token (letters, digits, `_ $ . / : @ -`) onward; `line` against the whole line; `file`
// narrows an entry to one file. Anything a person or an agent reads as the product name does not belong here.
export const ALLOWED = [
  // Plumbing: names inside the code that nothing visible shows.
  { why: 'camelCase / glued identifiers (focusTinka, readerTinkaFocus, tinkaFocus, tinkaPage, window.tinkaAppearance)',
    token: /^[\w$.-]*(?:[a-z0-9_$]Tinka|(?:tinka|Tinka)(?=[A-Z0-9_$]))/ },
  { why: 'DOM ids, CSS classes, container names, keyframes, event and message types, meta names (tinka-card, .tinka-overview, tinka-return)',
    token: /^(?:[\w$]+\.)?\.?tinka-[\w-]+/ },
  { why: 'custom events (tinka:selection, tinka:navigator-open)', token: /^tinka:[\w-]+/ },
  { why: 'browser storage keys (tinka/ground, tinka/appearance, tinka/${workspace}/…): renaming would drop saved preferences',
    token: /^tinka\/(?:\$|<|ground|appearance|return-hidden|pointing-|emoji-skin-tone|WORKSPACE|[a-z-]+-draft)/ },
  { why: 'the localStorage key that remembers recently opened items (tinka/WORKSPACE/recent-tinkas)', token: /^[\w$./-]*recent-tinkas/ },
  { why: "internal focus-state values ('tinka' | 'keep'), never shown", file: 'public/canvas.js', line: /focus\s*(?:===|=)\s*'tinka'|focus\s*=\s*'tinka'|\? 'tinka' : 'keep'/ },
  { why: 'the opt-out query name the return mark reads (?tinka=off)', file: 'public/return-mark.js', line: /get\('tinka'\)/ },
  { why: 'the metadata folder .tinka/ is the on-disk format; boards open in either app', token: /^(?:[\w$./-]*\/)?\.tinka(?![\w-])/ },
  { why: 'the workspace HTTP header and the clipboard / drag MIME types are the wire format',
    token: /^(?:x-tinka-workspace|application\/x-tinka-[\w+-]+)/i },
  { why: 'internal environment variables and clipboard envelope prefix (TINKA_OPERATION_TOKEN, TINKA_CLIPBOARD_V1)', token: /^(?:[\w$]+\.)*TINKA_[A-Z0-9_]+/ },
  { why: 'test file names in the npm scripts (tests/tinka-view-browser.mjs)', token: /^tests\/tinka-[\w-]+\.mjs/ },
  { why: 'a local helper function in lib/shot.mjs that builds an app page target', file: 'lib/shot.mjs', token: /^(?:\.\.\.)?tinka(?=\(|=)/ },
  { why: 'the per-user legacy workspace list lives at ~/.config/tinka/', token: /^[\w$./~-]*\.config\/tinka\// },
  { why: 'the opt-out for the return mark pages carry (?tinka=off); existing pages use it', token: /^tinka(?==off)/ },
  { why: 'return-mark opt-out query name, read by the server', file: 'lib/return-mark.mjs', line: /searchParams\.get\("tinka"\)/ },
  { why: 'internal clipboard kind value, never shown', file: 'public/clipboard.js', line: /"tinkas"/ },

  // Credit: what fribblr was forked from, and upstream's own addresses and release numbers.
  { why: 'upstream project address and site', token: /^(?:github\.com\/bladnman\/tinka|[\w./:-]*bladnman\/tinka|tinka\.metal-sole\.com)/ },
  { why: 'a link to upstream\'s repository, [Tinka](https://github.com/bladnman/tinka)', token: /^Tinka\]\(https:\/\/github\.com\/bladnman\/tinka\)/ },
  { why: 'credit to the project fribblr is forked from', line: /\b(?:[Uu]pstream|forked from|fork of) Tinka\b|Tinka by bladnman/ },
  { why: "upstream's release numbers (Tinka 1.3 is upstream's release, not ours)", line: /\bTinka \d+\.\d+/ },
  { why: 'docs/BRANDING.md explains the old name; it is the one file that names it freely', file: 'docs/BRANDING.md', line: /./ },
];


function tokenStart(src, index) {
  let a = index;
  while (a > 0 && /[\w$./:@~-]/.test(src[a - 1])) a--;
  return a;
}

function allowed(file, src, index, lineText) {
  const tail = src.slice(tokenStart(src, index), tokenStart(src, index) + 200);
  return ALLOWED.some(a => {
    if (a.file && a.file !== file) return false;
    if (a.token && a.token.test(tail)) return true;
    if (a.line && a.line.test(lineText)) return true;
    return false;
  });
}

// Tests are not a surface: they may name the old name in fixtures, env vars and their own descriptions.
export function findings(files = listFiles().filter(f => !f.startsWith('tests/'))) {
  const out = [];
  for (const file of files) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    const lines = src.split('\n');
    const seen = new Set();
    for (const m of mentions(file, src)) {
      const lineText = lines[m.line - 1];
      if (allowed(file, src, m.index, lineText)) continue;
      if (seen.has(m.line)) continue;
      seen.add(m.line);
      out.push(`${file}:${m.line}: ${lineText.trim().slice(0, 160)}`);
    }
  }
  return out;
}

test('nothing a person or an agent reads calls the product Tinka', () => {
  const bad = findings();
  assert.equal(bad.length, 0,
    `\nThe old product name is back in ${bad.length} place(s):\n  ${bad.slice(0, 40).join('\n  ')}${bad.length > 40 ? `\n  … and ${bad.length - 40} more` : ''}\n\n` +
    `Fix: run \`node scripts/rebrand.mjs --write\`, then \`node scripts/rebrand.mjs --residual\` for what it could not decide and edit those lines by hand.\n` +
    `If a line is plumbing or a credit to upstream, add it to ALLOWED in tests/brand.test.mjs with the reason (see docs/BRANDING.md).\n`);
});

test('the guard sees strings and prose but not code comments', () => {
  const sample = 'const a = "Tinka"; // Tinka in a comment\n/* Tinka */ const b = `x Tinkas y`; const c = "https://x.test/Tinka"; // x\n';
  const hits = mentions('x.js', sample).map(m => m.line);
  assert.deepEqual(hits, [1, 2, 2]);
});
