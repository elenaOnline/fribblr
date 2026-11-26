#!/usr/bin/env node
// Re-applies fribblr's branding over text that came from upstream Tinka.
//
//   node scripts/rebrand.mjs              dry run: prints every change it would make
//   node scripts/rebrand.mjs --write      rewrites the files
//   node scripts/rebrand.mjs --residual   lists what is still called Tinka after the rules (hand edits, allow-list)
//   node scripts/rebrand.mjs --all        also covers the files that are only temporarily left out (see HELD_BACK)
//   node scripts/rebrand.mjs --quiet      with --write: print only the summary
//   node scripts/rebrand.mjs path ...     limit to these files
//
// Idempotent: a second run changes nothing. Safe after an upstream merge: new upstream copy that says
// Tinka is renamed by the same rules, and only what no rule can decide is left for a hand edit
// (--residual shows it; tests/brand.test.mjs fails until it is dealt with).
//
// What it changes is what a person or an agent reads: strings, markup and prose. It never touches
// code comments (JS, CSS, HTML), identifiers, storage keys, DOM ids and classes, events, env vars or
// the .tinka metadata folder. docs/BRANDING.md lists what still says tinka and why.
//
// No dependencies; Node 22 or later.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// Which files. Explicit, not a crawl of everything.

// Globs relative to the repo root: `*` is within one folder, `**` crosses folders, {a,b} alternates.
export const SURFACES = [
  'public/**/*.{js,html,css,md,txt}',
  'docs/**/*.md',
  'lib/*.{mjs,json}',
  'server.mjs',
  'cli.mjs',
  'scripts/*.mjs',
  'skill/**/*.{md,json,mjs}',
  'examples/**/*.{md,html,json,js,css}',
  'AGENTS.md',
  'IMPLEMENTATION_CONTRACT.md',
  'README.md',
  'package.json',
  'tests/**/*.mjs',
];

// Never ours to edit.
export const NOT_OURS = [
  'public/drawxide/**',      // vendored engine build
  'public/vendor/**',        // vendored UI SDK
  'public/fonts/**',
  'LICENSE',                 // upstream's copyright line stays
  'tests/**/fixtures/**',
  // These name the old name on purpose.
  'scripts/rebrand.mjs', 'tests/brand.test.mjs', 'docs/BRANDING.md',
];

// TEMPORARY. Files another branch (fribblr-install) owns while this one is open, plus the README the lead
// rewrites by hand. They are skipped unless --all is passed. After the two branches are merged, delete this
// list (and the matching one in tests/brand.test.mjs) and run `node scripts/rebrand.mjs --write` over the
// whole tree.
export const HELD_BACK = [
  'lib/project.mjs', 'scripts/install.mjs', 'scripts/package.mjs', 'lib/updates.mjs', 'lib/update-browser.mjs',
  'lib/update-compatibility.json', 'lib/runtime.mjs', 'lib/config.mjs', 'lib/cli.mjs', 'cli.mjs',
  'lib/overview.mjs', 'lib/shot.mjs', 'lib/drawxide.mjs', 'public/update-notice.js', 'skill/**',
  'docs/RELEASE.md', 'docs/INSTALL.md', 'package.json', 'README.md',
  'tests/project.test.mjs', 'tests/agent-section.test.mjs', 'tests/updates.test.mjs',
  'tests/workspace-install.test.mjs', 'tests/update-browser.test.mjs', 'tests/update-notice-browser.mjs',
  // Not on the brief's list, but they assert strings that held-back files print ("Installed Tinka", "Tinka link:"),
  // so they move together with those files.
  'tests/package.test.mjs', 'tests/shot.test.mjs',
];

function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*'; }
      else out += '[^/]*';
    } else if (c === '{') { out += '(?:'; }
    else if (c === '}') { out += ')'; }
    else if (c === ',') { out += out.lastIndexOf('(?:') > out.lastIndexOf(')') ? '|' : ','; }
    else if ('.+?^$()|[]\\'.includes(c)) { out += '\\' + c; }
    else out += c;
  }
  return new RegExp('^' + out + '$');
}
const matcher = globs => { const res = globs.map(globToRegExp); return file => res.some(re => re.test(file)); };

function walk(dir, out = []) {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (name === 'node_modules' || name === '.git') continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

// Files in scope, relative paths, sorted. `all` includes the HELD_BACK files.
export function listFiles({ all = false } = {}) {
  const surface = matcher(SURFACES), notOurs = matcher(NOT_OURS), held = matcher(HELD_BACK);
  const files = [];
  for (const top of readdirSync(ROOT)) {
    if (top === 'node_modules' || top === '.git') continue;
    const st = statSync(path.join(ROOT, top));
    (st.isDirectory() ? walk(top) : [top]).forEach(f => files.push(f));
  }
  return files.filter(f => surface(f) && !notOurs(f) && (all || !held(f))).sort();
}

// ---------------------------------------------------------------------------------------------
// Comments. Rules never run inside them (developer notes are plumbing).

function scanJs(src, start = 0, stopAtBrace = false, out = []) {
  const n = src.length;
  let i = start, last = '', depth = 0;
  const regexAfter = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const regexWords = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);
  let word = '';
  const flushWord = () => { if (word) { last = regexWords.has(word) ? '' : 'w'; word = ''; } };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (/[A-Za-z0-9_$]/.test(c)) { word += c; i++; if (!/[A-Za-z0-9_$]/.test(src[i] || '')) { const w = word; flushWord(); if (/^\d/.test(w)) last = 'w'; } continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out.push([i, end]); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out.push([i, end]); i = end; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++; last = 'w'; continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { i = scanJs(src, i + 2, true, out); continue; }
        i++;
      }
      i++; last = 'w'; continue;
    }
    if (c === '/' && regexAfter.has(last)) {
      i++; let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++; last = 'w'; continue;
    }
    if (stopAtBrace) {
      if (c === '{') depth++;
      else if (c === '}') { if (depth === 0) return i + 1; depth--; }
    }
    if (!/\s/.test(c)) last = c === ')' || c === ']' ? 'w' : c;
    i++;
  }
  return n;
}

function scanCss(src, out = [], offset = 0) {
  let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out.push([offset + i, offset + end]); i = end; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; continue; }
    i++;
  }
  return out;
}

function scanHtml(src) {
  const out = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<script\b[^>]*>([\s\S]*?)<\/script>|<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) out.push([m.index, m.index + m[0].length]);
    else if (m[1] !== undefined && !/\bsrc=/.test(m[0].slice(0, m[0].indexOf('>')))) {
      const bodyStart = m.index + m[0].indexOf('>') + 1;
      const type = /type=["']?([^"'\s>]+)/i.exec(m[0].slice(0, m[0].indexOf('>')))?.[1];
      if (!type || /javascript|module/.test(type)) { const r = []; scanJs(m[1], 0, false, r); r.forEach(([a, b]) => out.push([bodyStart + a, bodyStart + b])); }
    } else if (m[2] !== undefined) scanCss(m[2], out, m.index + m[0].indexOf('>') + 1);
  }
  return out;
}

// [start, end) ranges of comments in a file's text; none for prose and data files.
export function commentRanges(file, src) {
  if (/\.(m?js)$/.test(file)) return collectJs(src);
  if (/\.css$/.test(file)) return scanCss(src);
  if (/\.html?$/.test(file)) return scanHtml(src);
  return [];
}
function collectJs(src) { const out = []; scanJs(src, 0, false, out); return out.sort((a, b) => a[0] - b[0]); }

// Splits text into pieces: { text, comment }. Rules run on the pieces that are not comments.
export function segments(file, src) {
  const ranges = commentRanges(file, src).sort((a, b) => a[0] - b[0]);
  const out = []; let pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue; // nested (a comment inside a template literal inside a comment cannot occur; be safe)
    if (a > pos) out.push({ text: src.slice(pos, a), comment: false });
    out.push({ text: src.slice(a, b), comment: true });
    pos = b;
  }
  if (pos < src.length) out.push({ text: src.slice(pos), comment: false });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The rules. Ordered: the first rules (items, host-project paths) run before the general product-name
// rule at the end, so that "a Tinka" never becomes "a fribblr". A rule is [name, regex, replacement].
//
// "Tinka" as the product name is only ever the capitalised word. Identifiers, storage keys, events and
// the like contain it in other shapes, and the lookarounds keep the rules off them: a match must not be
// glued to a word character, `-`, `$`, `#`, `/` or `@` on the left, nor to a word character, `$` or `-`
// on the right.

const L = String.raw`(?<![\w$#@/.-])`;           // left edge of the word Tinka
const R = String.raw`(?![\w$-])`;                // right edge
// words that make a following "Tinka" the noun for a thing on a board (either case for the first letter)
const either = w => w.replace(/^[A-Za-z]/, c => `[${c.toUpperCase()}${c.toLowerCase()}]`);
const DET = '(?:' + ['this', 'these', 'that', 'those', 'each', 'every', 'one', 'any', 'another', 'other', 'all of the', 'selected', 'opened', 'open', 'placed', 'whose', 'board-only', 'zoomed', 'fitted', 'loaded', 'copied', 'pasted', 'cut', 'duplicated', 'dragged',
  'previous', 'next', 'first', 'last', 'current', 'focused', 'single', 'its', 'which', 'per', 'their', 'your', 'my', 'same',
  'new', 'archived', 'active', 'whole', 'the', 'an', "placement's"].map(either).join('|') + ')';

export const RULES = [
  // 1. Places where Tinka is only ever the product (or a credit), decided before any noun rule.
  ['link-preview user agent', /Tinka-Link-Preview\//g, 'fribblr-link-preview/'],
  ['heading anchors', /(?<=\]\(#[\w-]*-)tinka(?=[\w-]*\))/g, 'fribblr'],
  ['artifact names', /(?<![\w-])tinka-(install\.mjs|skill\.zip|v(?:VERSION|X\.Y\.Z))/g, 'fribblr-$1'],
  ['product + its own nouns', new RegExp(`${L}Tinka (tools|home|server|instance|folder|app|skill|install(?:ation)?|metadata|board room|board|boards|item link|link|links|page|clipboard|canvas|comments?|commands?|workspace|SDK|inbox|section|answers|appearance|version|versions|update|updates|marks?|brand|logo|icon)${R}`, 'g'), 'fribblr $1'],
  ['Back to / Open / to Tinka', new RegExp(`${L}(Back to|Open|Opens|to) Tinka${R}`, 'g'), '$1 fribblr'],
  ['Tinka tools', new RegExp(`${L}Tinka tools${R}`, 'g'), 'fribblr tools'],

  // 2. Things on a board are items. Plurals first (never the product), then singular after a determiner.
  ['Tinkas', new RegExp(`${L}Tinkas${R}`, 'g'), 'items'],
  ['"Tinka" : "items"', /(["'])Tinka\1(?=\s*:\s*["']items["'])/g, '$1item$1'],
  ['Tinka${n === 1 ? "" : "s"}', /Tinka(?=\$\{[^}]*\?\s*(?:""|'')\s*:\s*(?:"s"|'s')\})/g, 'item'],
  ['Tinka placements', new RegExp(`${L}Tinka (placements?|cards?|tiles?|kinds?)${R}`, 'g'), 'item $1'],
  ['A Tinka', new RegExp(`${L}A Tinka${R}`, 'g'), 'An item'],
  ['a Tinka', new RegExp(`${L}a Tinka${R}`, 'g'), 'an item'],
  ['the/this/... Tinka', new RegExp(`(?<=\\b${DET} )Tinka${R}`, 'g'), 'item'],
  ['opened-Tinka, current-Tinka', /(?<=\b(?:opened|current|selected)-)Tinka(?![\w$-])/g, 'item'],
  ['Tinka-managed', /(?<![\w$#@/.-])Tinka(?=-managed\b)/g, 'fribblr'],
  ['Tinka after a label', new RegExp(`(?<=\\$\\{[^}]*\\} )Tinka${R}`, 'g'), 'item'],
  ['"Tinka N of M"', /(?<=`)Tinka(?= \$\{)/g, 'Item'],
  ['inspector kind placeholder', /(?<=id="reader-info-kind">)Tinka(?=<)/g, 'Item'],
  ['item in a list of kinds', /(?<=\b(?:shape|shapes|Text|text|drawn element),? (?:or |and )?)Tinka(?=\s+(?:into|to|from|on|in)\b)/g, 'item'],

  // 3. Host-project paths and the files a project sees (the install branch writes these names).
  ['TINKA.md', /(?<![\w-])TINKA\.md\b/g, 'FRIBBLR.md'],
  ['section markers', /<!-- tinka:(start|end) -->/g, '<!-- fribblr:$1 -->'],
  ['host folder paths', /(?<![\w./$-])tinka\/(?=app\b|local\b|project\.json|setup\.mjs|packages\b|\.gitignore|\.pid)/g, 'fribblr/'],
  ['host folder, named alone', /([`'"( ])tinka\/([`'") ,.])/g, '$1fribblr/$2'],

  // 4. The product name, last. Not after "upstream" / "fork of" / "forked from" (credit), nor in "Tinka by bladnman", not as a release
  //    number ("Tinka 1.3" is upstream's release).
  ['Tinka', new RegExp(`(?<!\\b(?:[Uu]pstream|fork of|forked from) )${L}Tinka(?! \\d+\\.\\d)${R}`, 'g'), 'fribblr'],
];

// ---------------------------------------------------------------------------------------------

export function rebrandText(file, src) {
  const parts = segments(file, src);
  let changed = false;
  const out = parts.map(p => {
    if (p.comment) return p.text;
    let t = p.text;
    for (const [, re, to] of RULES) t = t.replace(re, to);
    if (t !== p.text) changed = true;
    return t;
  }).join('');
  return changed ? out : src;
}

// Every remaining mention (any case) outside comments, as {line, text}; the guard test uses the same view.
export function mentions(file, src) {
  const out = [];
  let offset = 0;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = pos => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  for (const p of segments(file, src)) {
    if (!p.comment) {
      const re = /tinka/gi; let m;
      while ((m = re.exec(p.text))) out.push({ line: lineOf(offset + m.index), index: offset + m.index });
    }
    offset += p.text.length;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const flag = f => args.includes(f);
  const only = args.filter(a => !a.startsWith('--'));
  let files = listFiles({ all: flag('--all') });
  if (only.length) files = files.filter(f => only.includes(f));
  const write = flag('--write'), quiet = flag('--quiet');

  if (flag('--residual')) {
    let count = 0;
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      const after = rebrandText(f, src);
      const lines = after.split('\n');
      const seen = new Set();
      for (const m of mentions(f, after)) {
        if (seen.has(m.line)) continue; seen.add(m.line); count++;
        console.log(`${f}:${m.line}: ${lines[m.line - 1].trim().slice(0, 220)}`);
      }
    }
    console.error(`${count} lines still mention tinka (before the allow-list in tests/brand.test.mjs)`);
    return;
  }

  let changedFiles = 0, changedLines = 0;
  for (const f of files) {
    const abs = path.join(ROOT, f);
    const src = readFileSync(abs, 'utf8');
    const out = rebrandText(f, src);
    if (out === src) continue;
    changedFiles++;
    const a = src.split('\n'), b = out.split('\n');
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
      changedLines++;
      if (!quiet) { console.log(`${f}:${i + 1}\n  - ${a[i].trim().slice(0, 240)}\n  + ${b[i].trim().slice(0, 240)}`); }
    }
    if (write) writeFileSync(abs, out);
  }
  console.log(`${write ? 'Changed' : 'Would change'} ${changedLines} lines in ${changedFiles} files (${files.length} files in scope${flag('--all') ? '' : ', held-back files skipped'}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
