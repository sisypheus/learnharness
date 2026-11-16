'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { merge } = require('../src/merge.cjs');
const queue = require('../src/review-queue.cjs');
const scheduler = require('../src/scheduler.cjs');
const { defaults } = require('../src/store.cjs');

const T0 = +new Date(2026, 0, 10, 12);
const proposition = (id, cues) => ({ id, origin: 'manual', name: id, statement: '', cues: cues.map(c => ({ id: c, question: `${c}?`, answer: c })), schedule: scheduler.createSchedule(T0 - 1000), firstReviewedAt: null, learningCueId: null, version: 1 });
function base() {
  return { version: 1, revision: 5, settings: { ...defaults(), autoSince: 0 }, batches: [], reviews: [],
    decks: [{ id: 'd', name: 'Deck', newLimit: 20, propositionIds: ['a', 'b'] }],
    propositions: { a: proposition('a', ['a1', 'a2']), b: proposition('b', ['b1']) } };
}
const rate = (s, id, rating, at) => { const p = s.propositions[id]; queue.applyRating(s, p, p.cues[0], rating, at, { requestId: `${id}-${at}`, ticketId: `${id}-${at}` }); return s; };
const derived = p => ({ schedule: p.schedule, firstReviewedAt: p.firstReviewedAt, learningCueId: p.learningCueId, cues: p.cues });

test('ratings on one side only are taken as they are', () => {
  const b = base(), theirs = rate(structuredClone(b), 'a', 3, T0);
  const m = merge(b, structuredClone(b), theirs);
  assert.deepEqual(derived(m.propositions.a), derived(theirs.propositions.a));
  assert.deepEqual(m.reviews, theirs.reviews);
  assert.equal(m.revision, 6);
});

test('different propositions rated on each side keep both schedules and logs', () => {
  const b = base(), ours = rate(structuredClone(b), 'a', 3, T0), theirs = rate(structuredClone(b), 'b', 1, T0 + 5000);
  const m = merge(b, ours, theirs);
  assert.deepEqual(derived(m.propositions.a), derived(ours.propositions.a));
  assert.deepEqual(derived(m.propositions.b), derived(theirs.propositions.b));
  assert.deepEqual(m.reviews.map(r => r.propositionId), ['a', 'b']);
});

test('one proposition rated on both sides replays all ratings in time order, introduced once', () => {
  const b = base();
  const ours = rate(rate(structuredClone(b), 'a', 3, T0 + 120000), 'a', 3, T0 + 20 * 60000);
  const theirs = rate(structuredClone(b), 'a', 1, T0);
  const m = merge(b, ours, theirs);
  // Same result as if one device had made the three ratings in order.
  const expected = rate(rate(rate(structuredClone(b), 'a', 1, T0), 'a', 3, T0 + 120000), 'a', 3, T0 + 20 * 60000);
  assert.deepEqual(m.propositions.a.schedule, expected.propositions.a.schedule);
  assert.equal(m.propositions.a.firstReviewedAt, T0);
  assert.equal(m.reviews.length, 3);
  assert.deepEqual(m.reviews.filter(r => r.introduced).map(r => r.at), [T0]);
  assert.deepEqual(m.reviews.find(r => r.at === T0 + 120000).deckIds, []);
  assert.equal(queue.counts(m, T0 + 21 * 60000).d, 1);
  assert.ok(m.propositions.a.version > Math.max(ours.propositions.a.version, theirs.propositions.a.version));
});

test('a proposition deleted on one side stays deleted; its ratings stay in the log', () => {
  const b = base(), ours = structuredClone(b);
  delete ours.propositions.b; ours.decks[0].propositionIds = ['a'];
  const theirs = rate(structuredClone(b), 'b', 3, T0);
  const m = merge(b, ours, theirs);
  assert.equal(m.propositions.b, undefined);
  assert.deepEqual(m.decks[0].propositionIds, ['a']);
  assert.equal(m.reviews.length, 1);
});

test('non-review edits take the changed side; ours wins when both changed', () => {
  const b = base(), ours = structuredClone(b), theirs = structuredClone(b);
  ours.propositions.a.cues[0].question = 'Edited on Mac';
  theirs.propositions.a.cues[1].answer = 'Edited elsewhere';
  ours.decks[0].name = 'Ours'; theirs.decks[0].name = 'Theirs';
  theirs.settings.retention = 0.85;
  const m = merge(b, ours, theirs);
  assert.equal(m.propositions.a.cues[0].question, 'Edited on Mac');
  assert.equal(m.propositions.a.cues[1].answer, 'Edited elsewhere');
  assert.equal(m.decks[0].name, 'Ours');
  assert.equal(m.settings.retention, 0.85);
});

test('without a common base, ours is kept and both review logs are combined', () => {
  const b = base(), ours = rate(structuredClone(b), 'a', 3, T0), theirs = rate(structuredClone(b), 'b', 3, T0);
  const m = merge(null, ours, theirs);
  assert.deepEqual(derived(m.propositions.a), derived(ours.propositions.a));
  assert.equal(m.reviews.length, 2);
});

test('git uses the merge driver to combine both sides of flashcards.json', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards merge '));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  const file = path.join(repo, 'core-plugin-data', 'flashcards', 'flashcards.json');
  const write = s => { fs.writeFileSync(file, JSON.stringify(s)); git('commit', '-qam', 'x'); };
  git('init', '-q', '-b', 'main');
  const driver = path.join(__dirname, '..', 'scripts', 'git-merge-flashcards.cjs');
  git('config', 'merge.flashcards.driver', `'${process.execPath}' '${driver}' %O %A %B`);
  fs.writeFileSync(path.join(repo, '.git', 'info', 'attributes'), 'core-plugin-data/flashcards/flashcards.json merge=flashcards\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const b = base();
  fs.writeFileSync(file, JSON.stringify(b)); git('add', '.'); git('commit', '-qm', 'base');
  git('switch', '-qc', 'phone'); write(rate(structuredClone(b), 'b', 3, T0));
  git('switch', '-q', 'main'); write(rate(structuredClone(b), 'a', 3, T0 + 1000));
  git('merge', '-q', '--no-edit', 'phone');
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(merged.reviews.map(r => r.propositionId).sort(), ['a', 'b']);
  assert.equal(merged.propositions.a.schedule.reps, 1);
  assert.equal(merged.propositions.b.schedule.reps, 1);
});
