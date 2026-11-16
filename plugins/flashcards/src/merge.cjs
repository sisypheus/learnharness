'use strict';
// Three-way merge of flashcards.json snapshots edited on two devices (git merge
// driver on the Mac, sync on the phone). Reviews are an append-only log, so
// both sides' ratings are kept and a proposition rated on both sides gets its
// schedule rebuilt by replaying the new ratings from the common base.
// Every other value takes whichever side changed it; when both did, `ours` wins.
const scheduler = require('./scheduler.cjs');

// Shape check shared by the store, the merge driver and the mobile app.
const valid = state => state?.version === 1 && Number.isSafeInteger(state.revision) && Array.isArray(state.decks) && Array.isArray(state.reviews) && Array.isArray(state.batches) && !!state.propositions && !!state.settings;

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}
// One value: keep `ours` unless only `theirs` changed it. Absent keys are undefined.
const pick = (base, ours, theirs) => (equal(ours, base) && !equal(theirs, base) ? theirs : ours);

function mergeFields(base, ours, theirs, skip) {
  const out = {};
  for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    if (skip?.has(k)) continue;
    const v = pick(base?.[k], ours[k], theirs[k]);
    if (v !== undefined) out[k] = structuredClone(v);
  }
  return out;
}
// Union of two keyed collections. Deletion wins: an entry in base that either
// side removed stays removed, even if the other side changed it.
function mergeKeyed(base, ours, theirs, mergeOne) {
  const out = new Map();
  for (const [id, o] of ours) {
    if (!theirs.has(id)) { if (!base.has(id)) out.set(id, structuredClone(o)); continue; }
    out.set(id, mergeOne(base.get(id), o, theirs.get(id)));
  }
  for (const [id, t] of theirs) if (!ours.has(id) && !base.has(id)) out.set(id, structuredClone(t));
  return out;
}
const byId = list => new Map((list ?? []).map(x => [x.id, x]));

function mergeCues(base, ours, theirs) {
  const merged = mergeKeyed(byId(base), byId(ours), byId(theirs), (b, o, t) => mergeFields(b, o, t));
  return [...merged.values()];
}

function mergeProposition(base, ours, theirs, newReviews) {
  // Rated on one side only: the field-wise pick already takes that side's schedule.
  const out = mergeFields(base, ours, theirs, new Set(['cues', 'version']));
  out.cues = mergeCues(base?.cues, ours.cues, theirs.cues);
  if (base && newReviews.some(r => r.side === 'ours') && newReviews.some(r => r.side === 'theirs')) {
    // Both sides rated it: replay every new rating in time order from the base.
    let schedule = base.schedule, firstReviewedAt = base.firstReviewedAt, learningCueId = base.learningCueId;
    const cueState = new Map();
    for (const { review } of [...newReviews].sort((a, b) => a.review.at - b.review.at || (a.review.id < b.review.id ? -1 : 1))) {
      const before = schedule, introduced = firstReviewedAt == null;
      schedule = scheduler.rate(before, review.rating, review.at, review.settings);
      learningCueId = schedule.state === 1 || schedule.state === 3 ? review.cueId : null;
      firstReviewedAt ??= review.at;
      cueState.set(review.cueId, { latestRating: review.rating, lastReviewedAt: review.at });
      // Keep the log consistent with the replay: only the earliest first rating
      // stays an introduction (both sides started from the same base, so a
      // review can lose this flag here but never gain it).
      Object.assign(review, { before, after: schedule, introduced, deckIds: introduced ? review.deckIds : [] });
    }
    Object.assign(out, { schedule, firstReviewedAt, learningCueId });
    for (const cue of out.cues) Object.assign(cue, cueState.get(cue.id));
  }
  out.version = Math.max(ours.version, theirs.version) + 1;
  return out;
}

function merge(base, ours, theirs) {
  base ??= null;
  const out = mergeFields(base, ours, theirs, new Set(['propositions', 'reviews', 'revision']));
  // Reviews: ours in order, then theirs-only, each copied so replay can rewrite them.
  const known = new Set((base?.reviews ?? []).map(r => r.id)), ourIds = new Set(ours.reviews.map(r => r.id));
  out.reviews = [...ours.reviews.map(r => structuredClone(r)), ...theirs.reviews.filter(r => !ourIds.has(r.id)).map(r => structuredClone(r))];
  const theirIds = new Set(theirs.reviews.map(r => r.id));
  // Ratings added since base on exactly one side (both = already shared).
  const newByProposition = new Map();
  for (const review of out.reviews) if (!known.has(review.id) && !(ourIds.has(review.id) && theirIds.has(review.id))) {
    const side = ourIds.has(review.id) ? 'ours' : 'theirs';
    if (!newByProposition.has(review.propositionId)) newByProposition.set(review.propositionId, []);
    newByProposition.get(review.propositionId).push({ side, review });
  }
  const props = mergeKeyed(
    new Map(Object.entries(base?.propositions ?? {})), new Map(Object.entries(ours.propositions)), new Map(Object.entries(theirs.propositions)),
    (b, o, t) => mergeProposition(b, o, t, newByProposition.get(o.id) ?? []),
  );
  out.propositions = Object.fromEntries(props);
  out.revision = Math.max(ours.revision, theirs.revision) + 1;
  return out;
}

module.exports = { merge, valid };
