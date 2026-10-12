#!/usr/bin/env node
// Static safety check for index.html — no browser needed.
//  1. Every inline <script> parses (catches syntax errors and duplicate let/const names).
//  2. No top-level function is declared twice (the later one silently wins).
//  3. No action name is defined in two action tables (A_*) unless it is a known, intentional override.
//  4. Runtime dependency scripts and styles are local, not executable CDN assets.
// Usage: node scripts/check.mjs [path/to/index.html]
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
let failed = false;
const fail = msg => { failed = true; console.error(`✗ ${msg}`); };
const ok = msg => console.log(`✓ ${msg}`);

// 1. Syntax
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((src, i) => { try { new Function(src); } catch (e) { fail(`inline script #${i + 1}: ${e.message}`); } });
if (!failed) ok(`${scripts.length} inline scripts parse`);

// 2. Duplicate top-level function declarations
const fnCount = {};
for (const m of html.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\s*\(/gm)) fnCount[m[1]] = (fnCount[m[1]] || 0) + 1;
const dupFns = Object.entries(fnCount).filter(([, n]) => n > 1).map(([k]) => k);
if (dupFns.length) fail(`functions declared more than once: ${dupFns.join(', ')}`); else ok(`${Object.keys(fnCount).length} top-level functions, no duplicates`);

// 3. Action-name collisions across action tables. Tables are merged with
//    Object.assign(A, A_FIT, A_NUT, …) so a later table overrides an earlier one.
const INTENTIONAL = new Set([
  'mediaNew', 'mediaOpen',                                     // A_MEDIA replaces the original Faith media modal
  'diDone',                                                    // A_FAMILY: "We did this" opens the date-night log
  'recSave', 'recToPlan', 'planPick', 'groceryBuild', 'grocAdd', 'grocCopy', // A_RECIPES upgrades A_HOME
  'taskAdd', 'taskSave'                                        // A_TASKS upgrades A_HOME
]);
const lines = html.split('\n'), owner = {}; let cur = null;
lines.forEach((l, i) => {
  const m = l.match(/^const (A_[A-Z_]+|A) = \{/); if (m) { cur = m[1]; return; }
  if (cur && l.startsWith('};')) { cur = null; return; }
  if (!cur) return;
  const k = l.match(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\s*[:(]/); if (!k) return;
  (owner[k[1]] = owner[k[1]] || []).push(`${cur}:${i + 1}`);
});
const clashes = Object.entries(owner).filter(([k, v]) => new Set(v.map(x => x.split(':')[0])).size > 1);
const bad = clashes.filter(([k]) => !INTENTIONAL.has(k));
bad.forEach(([k, v]) => fail(`action "${k}" is defined in more than one table: ${v.join(', ')}`));
if (!bad.length) ok(`${Object.keys(owner).length} actions, ${clashes.length} intentional overrides, no accidental collisions`);

// 4. Remote web services are allowed, but executable dependencies must be vendored.
const remoteScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']https?:\/\/[^"']+/gi)].map(m => m[0]);
const remoteStyles = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']https?:\/\/[^"']+/gi)].map(m => m[0]);
const remoteLoaders = [...html.matchAll(/loadScript\(\s*["'`]https?:\/\/[^"'`]+/gi)].map(m => m[0]);
const remoteExec = [...remoteScripts, ...remoteStyles, ...remoteLoaders];
if (remoteExec.length) fail(`remote executable dependencies found: ${remoteExec.join(', ')}`); else ok('runtime dependency scripts and styles are local');

process.exit(failed ? 1 : 0);
