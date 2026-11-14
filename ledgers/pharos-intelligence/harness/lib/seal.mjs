// seal.mjs: verifies a sealed question set before a run and opens the sealed truths only for scoring (QSET-SPEC section 8).
import fs from 'node:fs';
import path from 'node:path';
import { sha256, canonical } from './util.mjs';

export class SealError extends Error {}

// manifest lines: "<sha256>  <relative path>"; stamp file QSET.manifest.time holds an ISO UTC time.
export function verifyManifest(dir) {
  const mf = path.join(dir, 'QSET.manifest.sha256'), tf = path.join(dir, 'QSET.manifest.time');
  if (!fs.existsSync(mf) || !fs.existsSync(tf)) throw new SealError('manifest or stamp missing');
  const lines = fs.readFileSync(mf, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) throw new SealError('empty manifest');
  for (const l of lines) {
    const m = /^([0-9a-f]{64})  (.+)$/.exec(l);
    if (!m) throw new SealError('bad manifest line: ' + l.slice(0, 80));
    const p = path.join(dir, m[2]);
    if (!fs.existsSync(p)) throw new SealError('file in manifest is missing: ' + m[2]);
    if (sha256(fs.readFileSync(p)) !== m[1]) throw new SealError('hash mismatch: ' + m[2]);
  }
  return { files: lines.length, time: fs.readFileSync(tf, 'utf8').trim() };
}

export function commitOf(truth) {
  const { salt, ...core } = truth;
  return sha256(salt + canonical(core));
}

// the stamp must predate the first line of the run (control P5 and QSET-SPEC 8.4)
export function checkOrder(manifestTime, runStartTime) {
  if (!(manifestTime < runStartTime)) throw new SealError(`stamp order: manifest ${manifestTime} is not before run start ${runStartTime}`);
}

export function loadQuestions(dir, file = 'questions.jsonl') {
  return fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Opened only by the scorer, after a run has finished writing its trace.
export function loadSealedTruths(dir, questions) {
  const f = path.join(dir, 'sealed', 'answers.jsonl');
  const truths = new Map();
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const t = JSON.parse(l);
    truths.set(t.qid, t);
  }
  for (const q of questions) {
    const t = truths.get(q.qid);
    if (!t) throw new SealError('no truth for ' + q.qid);
    if (!t.evidence_ids || !t.evidence_ids.length) throw new SealError('truth without evidence ids: ' + q.qid);
    if (commitOf(t) !== q.answer_commit) throw new SealError('answer commitment mismatch: ' + q.qid);
  }
  return truths;
}

// Checks every commitment and evidence field BEFORE a run and keeps nothing: the answers are not retained by the caller.
export function verifyCommitments(dir, questions) {
  loadSealedTruths(dir, questions);
  return questions.length;
}
