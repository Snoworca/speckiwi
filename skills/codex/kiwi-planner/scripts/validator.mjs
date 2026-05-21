#!/usr/bin/env node
// kiwi-planner validator v0.2.0
// Usage:
//   node validator.mjs <plan.md> <sidecar.json> \
//     --target T --inventory-file <path> [--out <path>] \
//     [--check-files] [--dry-run]
//
// Exit codes: 0=pass, 1=warn-only, 2=error.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = '0.6.0';
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

const PLAN_CONTRACT_ENUM = ['1.1.0', '1.2.0'];
const TDD_POLICY_ENUM = ['strict', 'relaxed', 'disabled'];
const REQUIRED_FRONTMATTER = [
  'run_id', 'target', 'plan_version', 'plan_contract',
  'generated_at', 'tool_versions', 'sidecar_path'
];
const RX_RUN_ID   = /^[a-z0-9.-]{4,40}$/;
const RX_PHASE_ID = /^PH-\d{3}$/;
const RX_TASK_ID  = /^T-PH(\d{3})-(\d{2})$/;
const RX_TASK_HEADING = /^####\s+§3\.(PH-\d{3})\.(T-PH\d{3}-\d{2})\b/gm;
// §9.6 test_case.id SSOT — `TC-REQ-` literal prefix + capture: (1) REQ id (matches task.req_ids), (2) AC number, (3) seq
const RX_TEST_CASE_ID = /^TC-REQ-([A-Z][A-Z0-9-]*?)-AC(\d+)-(\d{2})$/;

const ACCEPTANCE_KIND_BY_TYPE = {
  code:      ['shell', 'http', 'perf', 'checklist'],
  doc:       ['checklist', 'file_state'],
  file_op:   ['file_state', 'shell'],
  issue:     ['checklist'],
  pr:        ['checklist', 'file_state'],
  perf_test: ['perf', 'shell'],
  infra:     ['shell', 'file_state', 'http'],
  review:    ['checklist'],
};

function sha1Hex(s) { return crypto.createHash('sha1').update(s, 'utf8').digest('hex'); }
function sha256Hex(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

function readFileBounded(p) {
  const st = fs.statSync(p);
  if (st.size > MAX_INPUT_BYTES) throw new Error(`file too large: ${p} (${st.size} > ${MAX_INPUT_BYTES})`);
  return fs.readFileSync(p, 'utf8');
}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let key, val;
      if (eq > 0) { key = a.slice(2, eq); val = a.slice(eq + 1); }
      else {
        key = a.slice(2);
        const next = argv[i + 1];
        const valuelessFlags = new Set(['check-files', 'dry-run']);
        if (valuelessFlags.has(key)) val = true;
        else if (next !== undefined) { val = next; i++; }
        else val = true;
      }
      opts[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { fm: null, body: md, errors: ['no frontmatter delimiters'] };
  const block = m[1];
  const body = m[2];
  const fm = {};
  const errors = [];
  const lines = block.split(/\r?\n/);
  let currentKey = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (raw.trim().startsWith('#')) continue;
    if (/^\s*-\s+/.test(raw)) {
      errors.push(`list notation not supported in frontmatter: ${raw.trim()}`);
      continue;
    }
    const indent = raw.match(/^[ \t]*/)[0].length;
    const line = raw.trim();
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) { errors.push(`unparsed frontmatter line: ${line}`); continue; }
    const [, k, vRaw] = kv;
    const v = stripQuotes(vRaw);
    if (indent === 0) {
      currentKey = k;
      if (v === '') fm[k] = {};
      else if (v.startsWith('[') || v.startsWith('{')) {
        errors.push(`inline json/array not supported in frontmatter: ${k}: ${v}`);
        fm[k] = v;
      } else fm[k] = v;
    } else {
      if (currentKey === null) { errors.push(`indented line with no parent: ${line}`); continue; }
      if (typeof fm[currentKey] !== 'object' || fm[currentKey] === null) fm[currentKey] = {};
      fm[currentKey][k] = v;
    }
  }
  return { fm, body, errors };
}

function stripQuotes(v) {
  v = String(v).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function stripFencedCodeBlocks(body) {
  // Replace fenced code block bodies with same-length spaces so offsets remain stable.
  return body.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '));
}

function extractSection(body, sectionNum) {
  const masked = stripFencedCodeBlocks(body);
  const startRe = new RegExp(`^##\\s+§${sectionNum}\\b`, 'm');
  const startMatch = masked.match(startRe);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  const rest = masked.slice(startIdx + startMatch[0].length);
  const endRe = /^##\s+§\d/m;
  const endMatch = rest.match(endRe);
  const endIdx = endMatch ? (startIdx + startMatch[0].length + endMatch.index) : body.length;
  return body.slice(startIdx, endIdx);
}

function countMdPhases(body) {
  const sec = extractSection(body, 2);
  if (!sec) return 0;
  const lines = sec.split(/\r?\n/);
  let inTable = false;
  let headerSeen = false;
  let sepSeen = false;
  let count = 0;
  for (const ln of lines) {
    if (!ln.trim().startsWith('|')) {
      if (inTable && headerSeen && sepSeen) break;
      continue;
    }
    if (!inTable) {
      inTable = true; headerSeen = true; continue;
    }
    if (headerSeen && !sepSeen) {
      if (/^\s*\|\s*[:\-\| ]+\|/.test(ln)) { sepSeen = true; continue; }
      headerSeen = false;
      continue;
    }
    if (headerSeen && sepSeen) {
      const cells = ln.split('|').map(c => c.trim()).filter((c, idx, arr) => !(idx === 0 || idx === arr.length - 1));
      if (cells.length === 0) continue;
      if (/^PH-\d{3}$/.test(cells[0])) count++;
    }
  }
  return count;
}

function extractTaskHeadings(body) {
  const sec = extractSection(body, 3);
  if (!sec) return { sec: '', headings: [] };
  const out = [];
  const re = new RegExp(RX_TASK_HEADING.source, 'gm');
  let m;
  while ((m = re.exec(sec)) !== null) {
    out.push({ phase_id: m[1], task_id: m[2], offset: m.index });
  }
  return { sec, headings: out };
}

function canonicalReqIds(arr) {
  return [...new Set((arr || []).map(s => String(s).trim()).filter(Boolean))].sort().join(',');
}

function canonicalFiles(files) {
  const flat = (files || []).map(f => {
    if (typeof f === 'string') return f.trim();
    const p = String(f.path || '').trim();
    const lr = f.line_range ? `:${String(f.line_range).trim()}` : '';
    return p + lr;
  }).filter(Boolean);
  return [...new Set(flat)].sort().join(',');
}

function parseMdFieldList(s) {
  if (!s) return [];
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

function parseTaskMdFields(block) {
  const get = (key) => {
    const m = block.match(new RegExp(`^\\s*[-*]\\s*${key}:\\s*(.+?)\\s*$`, 'm'));
    return m ? m[1] : '';
  };
  const stripBrackets = (v) => v.replace(/^\[|\]$/g, '').trim();
  const title = get('title');
  const type = get('type').toLowerCase();
  const reqIdsRaw = stripBrackets(get('req_ids'));
  const filesRaw = stripBrackets(get('files'));
  return {
    title: title.trim(),
    type,
    req_ids: parseMdFieldList(reqIdsRaw),
    files: parseMdFieldList(filesRaw),
  };
}

function taskCanonicalSignature(taskId, title, type, reqIdsCanon, filesCanon) {
  return sha1Hex(`${taskId}|${title.trim()}|${type.toLowerCase()}|${reqIdsCanon}|${filesCanon}`);
}

function makeCheck(id, title) {
  return { id, title, status: 'pass', severity: null, detail: null };
}

function rotateCanonicalCycle(arr) {
  // arr is a cycle like [a,b,c,a]; drop tail, rotate so min element is first
  const ring = arr.slice(0, -1);
  if (ring.length === 0) return arr.join('->');
  let minIdx = 0;
  for (let i = 1; i < ring.length; i++) if (ring[i] < ring[minIdx]) minIdx = i;
  const rotated = ring.slice(minIdx).concat(ring.slice(0, minIdx));
  return rotated.join('->');
}

function checkDagCycle(phases) {
  const adj = new Map();
  for (const p of phases) adj.set(p.id, p.depends_on || []);
  const visiting = new Set(), visited = new Set();
  const cycleSet = new Set();
  const cycles = [];
  function dfs(node, stack) {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      const cyc = stack.slice(idx).concat(node);
      const key = rotateCanonicalCycle(cyc);
      if (!cycleSet.has(key)) { cycleSet.add(key); cycles.push(cyc); }
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of (adj.get(node) || [])) dfs(next, stack);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const p of phases) dfs(p.id, []);
  return cycles;
}

function multisetDiff(a, b) {
  const ma = new Map(), mb = new Map();
  for (const x of a) ma.set(x, (ma.get(x) || 0) + 1);
  for (const x of b) mb.set(x, (mb.get(x) || 0) + 1);
  const onlyA = [], onlyB = [];
  for (const [k, v] of ma) {
    const w = mb.get(k) || 0;
    if (v > w) onlyA.push({ key: k, count: v - w });
  }
  for (const [k, v] of mb) {
    const w = ma.get(k) || 0;
    if (v > w) onlyB.push({ key: k, count: v - w });
  }
  return { onlyA, onlyB };
}

function runChecks(planMd, sidecar, planMdBody, inventory, opts) {
  const checks = [];
  const push = (c) => checks.push(c);

  // C01 — sidecar parse (handled before; placeholder)
  push(makeCheck('C01', 'sidecar JSON parse'));

  // C02 — frontmatter required fields + parse errors (list/inline-json rejection)
  {
    const c = makeCheck('C02', 'plan.md frontmatter required fields + parse errors');
    const detail = {};
    if (!planMd.fm) { detail.reason = 'no frontmatter'; }
    else {
      const missing = REQUIRED_FRONTMATTER.filter(k => planMd.fm[k] === undefined || planMd.fm[k] === null || planMd.fm[k] === '');
      if (missing.length) detail.missing = missing;
    }
    if (planMd.errors && planMd.errors.length) detail.parse_errors = planMd.errors;
    if (Object.keys(detail).length) { c.status='error'; c.severity='error'; c.detail = detail; }
    push(c);
  }

  // R01 — id regex + max constraints (run early so other id-based checks have valid ids)
  {
    const c = makeCheck('R01', 'id regex (run_id / phase.id / task.id) + max constraints');
    const bad = [];
    if (sidecar.run_id && !RX_RUN_ID.test(String(sidecar.run_id))) bad.push({ field: 'run_id', value: sidecar.run_id });
    for (const p of (sidecar.phases || [])) if (!RX_PHASE_ID.test(p.id)) bad.push({ field: 'phase.id', value: p.id });
    if ((sidecar.phases || []).length > 999) bad.push({ field: 'phase_count', value: sidecar.phases.length, max: 999 });
    const perPhase = new Map();
    for (const t of (sidecar.tasks || [])) {
      if (!RX_TASK_ID.test(t.id)) bad.push({ field: 'task.id', value: t.id });
      perPhase.set(t.phase_id, (perPhase.get(t.phase_id) || 0) + 1);
    }
    for (const [pid, cnt] of perPhase) {
      if (cnt > 99) bad.push({ field: 'tasks_per_phase', phase_id: pid, value: cnt, max: 99 });
    }
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ bad }; }
    push(c);
  }

  // C03 — id uniqueness (phase + task + trace_link.link_id) + link_id required
  {
    const c = makeCheck('C03', 'id uniqueness: phase + task + trace_link.link_id (link_id required)');
    const phaseIds = (sidecar.phases || []).map(p => p.id);
    const taskIds  = (sidecar.tasks  || []).map(t => t.id);
    const allLinks = (sidecar.tasks || []).flatMap(t => (t.trace_links || []).map(tl => ({ task_id: t.id, link_id: tl.link_id })));
    const missingLinkId = allLinks.filter(x => !x.link_id);
    const linkIds = allLinks.map(x => x.link_id).filter(Boolean);
    const dup = (arr) => [...new Set(arr.filter((v,i,a) => a.indexOf(v) !== i))];
    const dupP = dup(phaseIds), dupT = dup(taskIds), dupL = dup(linkIds);
    if (dupP.length || dupT.length || dupL.length || missingLinkId.length) {
      c.status='error'; c.severity='error';
      c.detail={ dup_phases: dupP, dup_tasks: dupT, dup_link_ids: dupL, missing_link_id: missingLinkId };
    }
    push(c);
  }

  // C04 — task.phase_id ∈ phases.id AND phase.task_ids multiset-eq tasks per phase
  {
    const c = makeCheck('C04', 'task.phase_id FK + phase.task_ids bidirectional');
    const phaseMap = new Map((sidecar.phases || []).map(p => [p.id, p]));
    const issues = [];
    for (const t of (sidecar.tasks || [])) {
      if (!phaseMap.has(t.phase_id)) issues.push({ task_id: t.id, reason: `unknown phase_id ${t.phase_id}` });
    }
    for (const p of (sidecar.phases || [])) {
      const declared = [...(p.task_ids || [])].sort();
      const actual = (sidecar.tasks || []).filter(t => t.phase_id === p.id).map(t => t.id).sort();
      if (JSON.stringify(declared) !== JSON.stringify(actual)) {
        issues.push({ phase_id: p.id, declared, actual });
      }
    }
    if (issues.length) { c.status='error'; c.severity='error'; c.detail={ issues }; }
    push(c);
  }

  // C05 — task.req_ids ⊆ inventory; missing inventory = ERROR
  {
    const c = makeCheck('C05', 'task.req_ids ⊆ inventory (non-deprecated)');
    if (!inventory) {
      c.status='error'; c.severity='error';
      c.detail={ reason: 'inventory-file required but not provided (skill §0.11 / §8.1)' };
    } else {
      const validIds = new Set(
        inventory.filter(r => (r.stability || '').toLowerCase() !== 'deprecated')
                 .map(r => r.id || r.req_id)
      );
      const bad = [];
      for (const t of (sidecar.tasks || [])) {
        for (const rid of (t.req_ids || [])) {
          if (!validIds.has(rid)) bad.push({ task_id: t.id, req_id: rid });
        }
      }
      if (bad.length) { c.status='error'; c.severity='error'; c.detail={ unknown_refs: bad }; }
    }
    push(c);
  }

  // C06 — md phase count == sidecar.phases.length
  {
    const c = makeCheck('C06', 'plan.md §2 phase rows == sidecar.phases.length');
    const mdN = countMdPhases(planMdBody);
    const scN = (sidecar.phases || []).length;
    if (mdN !== scN) { c.status='error'; c.severity='error'; c.detail={ md: mdN, sidecar: scN }; }
    push(c);
  }

  // C07 — md task heading count == sidecar.tasks.length (h4 exact)
  {
    const c = makeCheck('C07', 'plan.md §3 task headings (h4) == sidecar.tasks.length');
    const { headings } = extractTaskHeadings(planMdBody);
    const mdN = headings.length;
    const scN = (sidecar.tasks || []).length;
    if (mdN !== scN) { c.status='error'; c.severity='error'; c.detail={ md: mdN, sidecar: scN }; }
    push(c);
  }

  // C08 — task canonical signature equality
  {
    const c = makeCheck('C08', 'task md ↔ sidecar canonical signature match');
    const { sec: secText, headings } = extractTaskHeadings(planMdBody);
    const diff = [];
    const taskMap = new Map((sidecar.tasks || []).map(t => [t.id, t]));
    const seen = new Set();
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const next = headings[i + 1];
      const block = secText.slice(h.offset, next ? next.offset : secText.length);
      const mdFields = parseTaskMdFields(block);
      const mdSig = taskCanonicalSignature(
        h.task_id, mdFields.title, mdFields.type,
        canonicalReqIds(mdFields.req_ids), canonicalFiles(mdFields.files)
      );
      const t = taskMap.get(h.task_id);
      if (!t) { diff.push({ task_id: h.task_id, reason: 'sidecar entry missing' }); continue; }
      seen.add(h.task_id);
      const scSig = taskCanonicalSignature(
        t.id, String(t.title || ''), String(t.type || ''),
        canonicalReqIds(t.req_ids), canonicalFiles(t.files)
      );
      if (mdSig !== scSig) {
        diff.push({ task_id: h.task_id, reason: 'signature mismatch',
                    md: { ...mdFields }, sidecar: { title: t.title, type: t.type, req_ids: t.req_ids, files: t.files } });
      }
    }
    for (const t of (sidecar.tasks || [])) if (!seen.has(t.id)) diff.push({ task_id: t.id, reason: 'md heading missing' });
    if (diff.length) { c.status='error'; c.severity='error'; c.detail={ diff }; }
    push(c);
  }

  // C09 — coverage arithmetic + non-negative integers + req_id uniqueness
  {
    const c = makeCheck('C09', 'coverage arithmetic + non-negative integers + req_id unique');
    const bad = [];
    const seenReqs = new Set();
    const dupReqs = [];
    for (const cov of (sidecar.coverage || [])) {
      if (cov.req_id) {
        if (seenReqs.has(cov.req_id)) dupReqs.push(cov.req_id);
        seenReqs.add(cov.req_id);
      }
      const acTotal = cov.ac_total, acCovered = cov.ac_covered;
      const missing = cov.missing_ac_ids || [];
      if (!Number.isInteger(acTotal) || acTotal < 0 ||
          !Number.isInteger(acCovered) || acCovered < 0 ||
          !Array.isArray(missing)) {
        bad.push({ req_id: cov.req_id, ac_total: acTotal, ac_covered: acCovered, missing_len: missing.length, reason: 'invalid types' });
        continue;
      }
      if (acCovered + missing.length !== acTotal) {
        bad.push({ req_id: cov.req_id, ac_total: acTotal, ac_covered: acCovered, missing_len: missing.length });
      }
    }
    if (bad.length || dupReqs.length) {
      c.status='error'; c.severity='error';
      c.detail={ bad, duplicate_req_ids: [...new Set(dupReqs)] };
    }
    push(c);
  }

  // C10 — orphans threshold
  {
    const c = makeCheck('C10', 'orphans threshold (0=ok, 1-2=warn, ≥3=error)');
    const n = (sidecar.orphans || []).length;
    if (n >= 3) { c.status='error'; c.severity='error'; c.detail={ orphan_count: n, task_ids: sidecar.orphans.map(o=>o.task_id) }; }
    else if (n >= 1) { c.status='warn'; c.severity='warn'; c.detail={ orphan_count: n, task_ids: sidecar.orphans.map(o=>o.task_id) }; }
    push(c);
  }

  // C11 — unreferenced_reqs non-deprecated
  {
    const c = makeCheck('C11', 'unreferenced_reqs (non-deprecated) ≥1 = error');
    const entries = sidecar.unreferenced_reqs || [];
    const noStability = entries.filter(r => !r.stability);
    const bad = entries.filter(r => r.stability && r.stability.toLowerCase() !== 'deprecated');
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ req_ids: bad.map(r=>r.req_id) }; }
    else if (noStability.length) { c.status='warn'; c.severity='warn'; c.detail={ no_stability_req_ids: noStability.map(r=>r.req_id) }; }
    push(c);
  }

  // C12 — acceptance_tests.kind ↔ task.type
  {
    const c = makeCheck('C12', 'acceptance_tests.kind ↔ task.type compatibility');
    const bad = [];
    for (const t of (sidecar.tasks || [])) {
      const allowed = ACCEPTANCE_KIND_BY_TYPE[t.type] || [];
      const tests = t.acceptance_tests || [];
      if (tests.length === 0) {
        bad.push({ task_id: t.id, reason: 'empty acceptance_tests' });
        continue;
      }
      for (const ac of tests) {
        if (!ac || !ac.kind || !allowed.includes(ac.kind)) {
          bad.push({ task_id: t.id, type: t.type, ac_kind: ac && ac.kind, allowed });
        }
      }
    }
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ bad }; }
    push(c);
  }

  // C13 — verification_cmd null or both non-empty (no empty-string sneaking)
  {
    const c = makeCheck('C13', 'verification_cmd: null OR {posix, windows} both non-empty');
    const bad = [];
    for (const t of (sidecar.tasks || [])) {
      const v = t.verification_cmd;
      if (v === null || v === undefined) continue;
      if (typeof v !== 'object') { bad.push({ task_id: t.id, reason: 'not an object' }); continue; }
      const p = v.posix, w = v.windows;
      const okP = typeof p === 'string' && p.trim().length > 0;
      const okW = typeof w === 'string' && w.trim().length > 0;
      if (!(okP && okW)) bad.push({ task_id: t.id, posix_ok: okP, windows_ok: okW });
    }
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ bad }; }
    push(c);
  }

  // C14 — trace_links.target.reference ⊆ task.req_ids (Requirement type)
  {
    const c = makeCheck('C14', 'trace_links.target.reference ⊆ task.req_ids (Requirement)');
    const bad = [];
    for (const t of (sidecar.tasks || [])) {
      const reqSet = new Set(t.req_ids || []);
      for (const tl of (t.trace_links || [])) {
        if ((tl.target?.type || '') !== 'Requirement') continue;
        const ref = tl.target?.reference;
        if (!reqSet.has(ref)) bad.push({ task_id: t.id, link_ref: ref });
      }
    }
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ bad }; }
    push(c);
  }

  // C15 — mcp_call_log multiset eq with trace_links + verification_evidence with coverage.
  //         mcp_call_log[].args is required by skill §0.11/§10/§9.5; missing args is ERROR.
  {
    const c = makeCheck('C15', 'mcp_call_log multiset (uses args per §9.5 SSOT)');
    const issues = [];
    const missingArgs = [];

    const logTraceKeys = [];
    const logEvKeys = [];
    const argsHashSeen = new Map();
    for (const entry of (sidecar.mcp_call_log || [])) {
      if (entry.args === undefined || entry.args === null) {
        missingArgs.push({ seq: entry.seq, call: entry.call });
        continue;
      }
      if (entry.args_hash) {
        const prev = argsHashSeen.get(entry.args_hash);
        if (prev !== undefined) issues.push({ kind: 'duplicate_args_hash', args_hash: entry.args_hash, seqs: [prev, entry.seq] });
        argsHashSeen.set(entry.args_hash, entry.seq);
      }
      if (entry.call === 'add_trace_link') {
        const a = entry.args;
        const src = a.source?.id || '';
        const tgt = a.target?.reference || '';
        const typ = a.target?.type || '';
        logTraceKeys.push(`${src}|${typ}|${tgt}`);
      } else if (entry.call === 'add_verification_evidence') {
        logEvKeys.push(String(entry.args.id || ''));
      }
    }
    if (missingArgs.length) issues.push({ kind: 'missing_args', entries: missingArgs });

    const expectedTraceKeys = [];
    for (const t of (sidecar.tasks || [])) {
      for (const tl of (t.trace_links || [])) {
        expectedTraceKeys.push(`${t.id}|${tl.target?.type || ''}|${tl.target?.reference || ''}`);
      }
    }
    const tDiff = multisetDiff(logTraceKeys, expectedTraceKeys);
    if (tDiff.onlyA.length || tDiff.onlyB.length) {
      issues.push({ kind: 'add_trace_link_mismatch', only_in_log: tDiff.onlyA, only_in_trace_links: tDiff.onlyB });
    }

    // coverage req_ids form a Set (uniqueness asserted by C09 + skill §10 SSOT)
    const expectedEvKeys = [...new Set((sidecar.coverage || []).map(c => String(c.req_id || '')))];
    const logEvSet = [...new Set(logEvKeys)];
    const onlyLog = logEvSet.filter(k => !expectedEvKeys.includes(k));
    const onlyCov = expectedEvKeys.filter(k => !logEvSet.includes(k));
    if (onlyLog.length || onlyCov.length) {
      issues.push({ kind: 'add_verification_evidence_mismatch', only_in_log: onlyLog, only_in_coverage: onlyCov });
    }

    if (issues.length) { c.status='error'; c.severity='error'; c.detail={ issues }; }
    push(c);
  }

  // C16 — phase.depends_on DAG
  {
    const c = makeCheck('C16', 'phase.depends_on DAG (no cycles)');
    const phaseIds = new Set((sidecar.phases || []).map(p => p.id));
    const unknownDeps = [];
    for (const p of (sidecar.phases || [])) {
      for (const d of (p.depends_on || [])) {
        if (!phaseIds.has(d)) unknownDeps.push({ phase_id: p.id, unknown_dep: d });
      }
    }
    const cycles = checkDagCycle(sidecar.phases || []);
    if (unknownDeps.length || cycles.length) {
      c.status='error'; c.severity='error';
      c.detail={ unknown_deps: unknownDeps, cycles };
    }
    push(c);
  }

  // C17 — file existence (--check-files)
  if (opts['check-files']) {
    const c = makeCheck('C17', 'task.files[].path exists + line_range valid');
    const bad = [];
    for (const t of (sidecar.tasks || [])) {
      for (const f of (t.files || [])) {
        const p = typeof f === 'string' ? f.split(':')[0] : f.path;
        const lr = typeof f === 'string'
          ? (f.includes(':') ? f.slice(f.indexOf(':') + 1) : null)
          : f.line_range || null;
        try {
          const st = fs.statSync(p);
          if (!st.isFile()) { bad.push({ task_id: t.id, path: p, reason: 'not a file' }); continue; }
          if (lr) {
            const mm = String(lr).match(/^(\d+)-(\d+)$/);
            if (!mm) { bad.push({ task_id: t.id, path: p, line_range: lr, reason: 'invalid format' }); continue; }
            const a = parseInt(mm[1], 10), b = parseInt(mm[2], 10);
            if (a > b) { bad.push({ task_id: t.id, path: p, line_range: lr, reason: 'start > end' }); continue; }
            const raw = fs.readFileSync(p, 'utf8');
            const lineCount = raw.length === 0 ? 0
                              : raw.replace(/\r?\n$/, '').split(/\r?\n/).length;
            if (b > lineCount) bad.push({ task_id: t.id, path: p, line_range: lr, reason: `end > total ${lineCount}` });
          }
        } catch (e) {
          bad.push({ task_id: t.id, path: p, reason: e.message });
        }
      }
    }
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ bad }; }
    push(c);
  }

  // C18 — plan_contract enum
  {
    const c = makeCheck('C18', 'plan_contract enum');
    const a = planMd.fm?.plan_contract;
    const b = sidecar.plan_contract;
    const bad = [];
    if (!PLAN_CONTRACT_ENUM.includes(a)) bad.push({ source: 'frontmatter', value: a });
    if (!PLAN_CONTRACT_ENUM.includes(b)) bad.push({ source: 'sidecar', value: b });
    if (a !== b) bad.push({ source: 'mismatch', frontmatter: a, sidecar: b });
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ allowed: PLAN_CONTRACT_ENUM, bad }; }
    push(c);
  }

  // C19 — dry-run all mcp_call_log entries have dry_run: true
  if (opts['dry-run']) {
    const c = makeCheck('C19', 'dry-run: all mcp_call_log entries have dry_run: true');
    const bad = [];
    for (const e of (sidecar.mcp_call_log || [])) {
      if (e.dry_run !== true) bad.push({ seq: e.seq, call: e.call });
    }
    if (bad.length) { c.status='error'; c.severity='error'; c.detail={ bad }; }
    push(c);
  }

  // C20 — frontmatter.sidecar_path matches sidecar input path
  {
    const c = makeCheck('C20', 'plan.fm.sidecar_path == sidecar input path (canonical)');
    const fmPath = planMd.fm?.sidecar_path;
    const inputPath = opts._sidecarInput;
    if (fmPath && inputPath) {
      const planDir = path.dirname(opts._planInput || '');
      const resolvedFm = path.resolve(planDir, String(fmPath));
      const resolvedIn = path.resolve(inputPath);
      if (resolvedFm !== resolvedIn) {
        c.status='warn'; c.severity='warn';
        c.detail={ frontmatter: resolvedFm, input: resolvedIn };
      }
    }
    push(c);
  }

  // === TDD checks (skip if tdd-policy=disabled) ===
  // tdd-policy resolution: CLI flag > sidecar.tdd_policy > plan.fm.tdd_policy > 'relaxed'
  // Invalid value → fallback to 'relaxed' but emit WARN-level note in policy_warning
  let policyInvalidValue = null;
  const tddPolicy = (() => {
    const cliVal = opts['tdd-policy'];
    const raw = (cliVal !== undefined && cliVal !== true && cliVal !== '')
                ? cliVal
                : (sidecar.tdd_policy || planMd.fm?.tdd_policy || 'relaxed');
    if (!TDD_POLICY_ENUM.includes(raw)) {
      policyInvalidValue = raw;
      return 'relaxed';
    }
    return raw;
  })();
  const tddActive = tddPolicy !== 'disabled';
  const strictMode = tddPolicy === 'strict';

  // Auto-exempt task types — reason not enforced (skill.md §5.2 자동 면제)
  const AUTO_EXEMPT_TYPES = new Set(['doc', 'file_op', 'issue', 'pr', 'review']);
  // Types requiring explicit exempt_reason when applicable=false
  const EXEMPT_REASON_REQUIRED_TYPES = new Set(['code', 'perf_test', 'infra']);

  if (tddActive) {
    // policy invalid value warning
    if (policyInvalidValue !== null) {
      const c = makeCheck('C00b', `tdd-policy invalid value: '${policyInvalidValue}' (fallback to 'relaxed')`);
      c.status = 'warn'; c.severity = 'warn';
      c.detail = { received: policyInvalidValue, allowed: TDD_POLICY_ENUM };
      push(c);
    }

    // R04 — test_case.id regex + uniqueness + REQ-prefix matches task.req_ids
    {
      const c = makeCheck('R04', 'test_case.id regex + uniqueness + REQ-prefix matches task.req_ids');
      const bad = [];
      const seen = new Map();
      const dupIds = [];
      const reqMismatch = [];
      for (const t of (sidecar.tasks || [])) {
        const tcs = (t.tdd?.test_cases) || [];
        const taskReqSet = new Set(t.req_ids || []);
        for (const tc of tcs) {
          if (!tc || typeof tc.id !== 'string') {
            bad.push({ task_id: t.id, test_case_id: '(missing)' });
            continue;
          }
          const m = tc.id.match(RX_TEST_CASE_ID);
          if (!m) { bad.push({ task_id: t.id, test_case_id: tc.id }); continue; }
          const reqFromId = m[1]; // capture group: e.g. "REQ-KP-TEST-001"
          // tc.req_id (if present) must align with id's REQ-prefix
          if (tc.req_id && tc.req_id !== reqFromId) {
            reqMismatch.push({ task_id: t.id, test_case_id: tc.id, id_req: reqFromId, field_req: tc.req_id });
          }
          // REQ-prefix must be in task.req_ids
          if (taskReqSet.size && !taskReqSet.has(reqFromId)) {
            reqMismatch.push({ task_id: t.id, test_case_id: tc.id, id_req: reqFromId, task_req_ids: [...taskReqSet], reason: 'REQ not in task.req_ids' });
          }
          if (seen.has(tc.id)) dupIds.push({ id: tc.id, first_task: seen.get(tc.id), dup_task: t.id });
          else seen.set(tc.id, t.id);
        }
      }
      if (bad.length || dupIds.length || reqMismatch.length) {
        c.status='error'; c.severity='error';
        c.detail = { invalid_id: bad, duplicates: dupIds, req_mismatch: reqMismatch };
      }
      push(c);
    }

    // C21 — type=code Task: tdd field required; applicable=true → test_cases ≥ 1 + valid phase; applicable=false → phase='n/a'
    {
      const c = makeCheck('C21', 'code task tdd field required + phase/test_cases per applicable');
      const bad = [];
      const validRealPhases = new Set(['red', 'green', 'refactor']);
      for (const t of (sidecar.tasks || [])) {
        if (t.type !== 'code') continue;
        const tdd = t.tdd;
        if (!tdd || typeof tdd !== 'object') { bad.push({ task_id: t.id, reason: 'tdd field missing' }); continue; }
        if (tdd.applicable === true) {
          const tcLen = Array.isArray(tdd.test_cases) ? tdd.test_cases.length : 0;
          if (tcLen === 0) bad.push({ task_id: t.id, reason: 'applicable=true but test_cases empty' });
          if (tdd.phase === undefined || tdd.phase === null) {
            bad.push({ task_id: t.id, reason: 'phase missing' });
          } else if (!validRealPhases.has(tdd.phase)) {
            bad.push({ task_id: t.id, reason: `invalid phase for applicable=true: '${tdd.phase}'` });
          }
        } else if (tdd.applicable === false) {
          if (tdd.phase !== 'n/a') {
            bad.push({ task_id: t.id, reason: `applicable=false requires phase='n/a', got '${tdd.phase}'` });
          }
        } else {
          bad.push({ task_id: t.id, reason: 'tdd.applicable must be boolean' });
        }
      }
      if (bad.length) { c.status='error'; c.severity='error'; c.detail = { bad }; }
      push(c);
    }

    // C22 — applicable=false → exempt_reason ≥ 20 (only for code/perf_test/infra; auto-exempt types skip).
    //        strict mode: code task cannot be applicable=false at all.
    {
      const c = makeCheck('C22', 'applicable=false reason policy (type-aware) + strict no-exempt');
      const bad = [];
      for (const t of (sidecar.tasks || [])) {
        const tdd = t.tdd;
        if (!tdd) continue;
        if (tdd.applicable !== false) continue;
        if (AUTO_EXEMPT_TYPES.has(t.type)) continue; // auto-exempt: reason not enforced
        if (strictMode && t.type === 'code') {
          bad.push({ task_id: t.id, type: t.type, reason: 'strict mode: code task cannot be exempt' });
          continue;
        }
        if (EXEMPT_REASON_REQUIRED_TYPES.has(t.type)) {
          const r = String(tdd.exempt_reason || '').trim();
          if (r.length < 20) bad.push({ task_id: t.id, type: t.type, reason: 'exempt_reason too short', length: r.length });
        }
      }
      if (bad.length) { c.status='error'; c.severity='error'; c.detail = { bad }; }
      push(c);
    }

    // C23 — test_case.req_id ∈ task.req_ids AND test_case.ac_refs ⊆ inventory(test_case.req_id).ac_ids
    {
      const c = makeCheck('C23', 'test_case.req_id ∈ task.req_ids + ac_refs ⊆ inventory(req_id).ac_ids');
      if (!inventory) {
        // C05 already errors on missing inventory; emit non-duplicate precondition note here
        c.status = 'warn'; c.severity = 'warn';
        c.detail = { precondition_failed: 'inventory required (see C05)' };
      } else {
        const invMap = new Map();
        for (const r of inventory) {
          const id = r.id || r.req_id;
          invMap.set(id, new Set((r.ac_ids || []).map(String)));
        }
        const bad = [];
        for (const t of (sidecar.tasks || [])) {
          const tcs = (t.tdd?.test_cases) || [];
          const taskReqSet = new Set(t.req_ids || []);
          for (const tc of tcs) {
            // derive primary REQ: tc.req_id field, else from id capture group
            const m = tc && typeof tc.id === 'string' ? tc.id.match(RX_TEST_CASE_ID) : null;
            const primaryReq = tc.req_id || (m && m[1]) || null;
            if (!primaryReq) { bad.push({ task_id: t.id, test_case_id: tc.id, reason: 'cannot derive primary REQ' }); continue; }
            if (!taskReqSet.has(primaryReq)) {
              bad.push({ task_id: t.id, test_case_id: tc.id, reason: 'req_id not in task.req_ids', primary_req: primaryReq, task_req_ids: [...taskReqSet] });
              continue;
            }
            const acSet = invMap.get(primaryReq);
            if (!acSet) { bad.push({ task_id: t.id, test_case_id: tc.id, reason: 'inventory missing for REQ', primary_req: primaryReq }); continue; }
            for (const ac of (tc.ac_refs || [])) {
              if (!acSet.has(String(ac))) bad.push({ task_id: t.id, test_case_id: tc.id, primary_req: primaryReq, unknown_ac: ac });
            }
          }
        }
        if (bad.length) { c.status='error'; c.severity='error'; c.detail = { bad }; }
      }
      push(c);
    }

    // C24 — Task-level depends_on_task DAG + reference integrity (dedup cycles)
    {
      const c = makeCheck('C24', 'depends_on_task DAG + reference integrity (dedup cycles)');
      const taskIds = new Set((sidecar.tasks || []).map(t => t.id));
      const unknownRefs = [];
      const invalidType = [];
      const adj = new Map();
      for (const t of (sidecar.tasks || [])) {
        if (t.depends_on_task !== undefined && !Array.isArray(t.depends_on_task)) {
          invalidType.push({ task_id: t.id, value_type: typeof t.depends_on_task });
          adj.set(t.id, []);
          continue;
        }
        const deps = t.depends_on_task || [];
        adj.set(t.id, deps);
        for (const d of deps) {
          if (!taskIds.has(d)) unknownRefs.push({ task_id: t.id, unknown_dep: d });
        }
      }
      const visiting = new Set(), visited = new Set();
      const cycleSet = new Set(); // dedup via canonical key
      const cycles = [];
      function rotateCanonical(arr) {
        // arr is a cycle like [a,b,c,a]; drop tail, rotate so min is first
        const ring = arr.slice(0, -1);
        if (ring.length === 0) return arr.join('->');
        let minIdx = 0;
        for (let i = 1; i < ring.length; i++) if (ring[i] < ring[minIdx]) minIdx = i;
        const rotated = ring.slice(minIdx).concat(ring.slice(0, minIdx));
        return rotated.join('->');
      }
      function dfs(node, stack) {
        if (visiting.has(node)) {
          const idx = stack.indexOf(node);
          const cyc = stack.slice(idx).concat(node);
          const key = rotateCanonical(cyc);
          if (!cycleSet.has(key)) { cycleSet.add(key); cycles.push(cyc); }
          return;
        }
        if (visited.has(node)) return;
        visiting.add(node);
        stack.push(node);
        for (const next of (adj.get(node) || [])) dfs(next, stack);
        stack.pop();
        visiting.delete(node);
        visited.add(node);
      }
      for (const id of taskIds) dfs(id, []);
      if (unknownRefs.length || cycles.length || invalidType.length) {
        c.status='error'; c.severity='error';
        c.detail = { unknown_refs: unknownRefs, cycles, invalid_type: invalidType };
      }
      push(c);
    }

    // C25 — red→green logical order. red 가 실제로 실패 (exit_code != 0) 했는지도 확인.
    //        strict mode: ERROR. relaxed: WARN.
    {
      const c = makeCheck('C25', 'green_evidence present → red_evidence present + red.exit_code ≠ 0');
      const bad = [];
      for (const t of (sidecar.tasks || [])) {
        const tdd = t.tdd;
        if (!tdd) continue;
        const green = tdd.green_evidence;
        const red = tdd.red_evidence;
        const hasGreen = green !== undefined && green !== null;
        const hasRed = red !== undefined && red !== null;
        if (!hasGreen) continue;
        // green present
        if (!hasRed) { bad.push({ task_id: t.id, reason: 'green present but red absent' }); continue; }
        // red present — must be a non-empty object with exit_code ≠ 0
        if (typeof red !== 'object' || Object.keys(red).length === 0) {
          bad.push({ task_id: t.id, reason: 'red_evidence is empty/invalid' }); continue;
        }
        if (typeof red.exit_code !== 'number') {
          bad.push({ task_id: t.id, reason: 'red_evidence.exit_code missing or non-number' }); continue;
        }
        if (red.exit_code === 0) {
          bad.push({ task_id: t.id, reason: 'red_evidence.exit_code is 0 (red must fail)' });
        }
      }
      if (bad.length) {
        if (strictMode) { c.status='error'; c.severity='error'; }
        else            { c.status='warn';  c.severity='warn';  }
        c.detail = { bad };
      }
      push(c);
    }
  }

  return checks;
}

function summarize(checks) {
  let errors = 0, warnings = 0;
  for (const c of checks) {
    if (c.status === 'error') errors++;
    else if (c.status === 'warn') warnings++;
  }
  return { errors, warnings, checks_total: checks.length };
}

function writeReport(report, opts) {
  const out = opts.out;
  const text = JSON.stringify(report, null, 2);
  if (out && typeof out === 'string') {
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, text, 'utf8');
    } catch (e) {
      console.error(`[fatal] could not write report to ${out}: ${e.message}`);
      process.stdout.write(text + '\n');
      process.exit(2);
    }
  }
  process.stdout.write(text + '\n');
}

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (positional.length < 2) {
    console.error('Usage: validator.mjs <plan.md> <sidecar.json> --inventory-file <path> [--target T] [--out <path>] [--check-files] [--dry-run] [--tdd-policy strict|relaxed|disabled]');
    process.exit(2);
  }
  const [planPath, sidecarPath] = positional;
  opts._planInput = planPath;
  opts._sidecarInput = sidecarPath;

  let planMdRaw, planMd;
  try {
    planMdRaw = readFileBounded(planPath);
    planMd = parseFrontmatter(planMdRaw);
  } catch (e) {
    const report = {
      validator_version: VERSION,
      target: opts.target || null,
      summary: { errors: 1, warnings: 0, checks_total: 1 },
      results: [{ id: 'C00', title: 'plan.md read', status: 'error', severity: 'error', detail: { message: String(e.message) } }],
    };
    writeReport(report, opts);
    process.exit(2);
  }

  let sidecar;
  try {
    const raw = readFileBounded(sidecarPath);
    sidecar = JSON.parse(raw);
  } catch (e) {
    const report = {
      validator_version: VERSION,
      target: opts.target || null,
      summary: { errors: 1, warnings: 0, checks_total: 1 },
      results: [{ id: 'C01', title: 'sidecar JSON parse', status: 'error', severity: 'error', detail: { message: String(e.message) } }],
    };
    writeReport(report, opts);
    process.exit(2);
  }

  let inventory = null;
  if (opts['inventory-file']) {
    try {
      const raw = readFileBounded(opts['inventory-file']);
      const parsed = JSON.parse(raw);
      inventory = Array.isArray(parsed) ? parsed : (parsed.requirements || parsed.items || []);
    } catch (e) {
      console.error(`[warn] inventory-file unreadable: ${e.message}`);
    }
  }

  const checks = runChecks(planMd, sidecar, planMd.body, inventory, opts);

  const summary = summarize(checks);
  const report = {
    validator_version: VERSION,
    run_id: sidecar.run_id || null,
    target: opts.target || sidecar.target || null,
    plan_path: path.resolve(planPath),
    sidecar_path: path.resolve(sidecarPath),
    mode: opts['dry-run'] ? 'dry-run' : 'live',
    summary,
    results: checks,
  };

  writeReport(report, opts);

  if (summary.errors > 0) process.exit(2);
  if (summary.warnings > 0) process.exit(1);
  process.exit(0);
}

main();
