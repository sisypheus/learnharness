'use strict';
// Pure review-queue rules shared by the backend and the mobile app, so both
// pick cards, count daily introductions and record ratings identically.
const scheduler = require('./scheduler.cjs');

const fail = (message) => { throw new Error(message); };
const memberships = (s, id) => s.decks.filter(d => d.propositionIds.includes(id)).map(d => d.id);
const learning = p => p.schedule.state === 1 || p.schedule.state === 3;

function counts(s, now) {
  const { start, end } = scheduler.dayBounds(now, s.settings.dayStart);
  const result = Object.fromEntries(s.decks.map(d => [d.id, 0]));
  for (const review of s.reviews) if (review.introduced && review.at >= start && review.at < end) for (const id of review.deckIds) if (id in result) result[id]++;
  return result;
}
function scopeIds(s, scope) {
  if (scope.deckIds !== undefined && (!Array.isArray(scope.deckIds) || scope.deckIds.some(id => !s.decks.some(d => d.id === id)))) fail('Selected deck no longer exists.');
  if (scope.propositionIds !== undefined && !Array.isArray(scope.propositionIds)) fail('Invalid review selection.');
  if (scope.cueIds !== undefined && (!Array.isArray(scope.cueIds) || scope.cueIds.some(id => typeof id !== 'string'))) fail('Invalid cue selection: use an array of cue IDs.');
  const ds = scope.deckIds ? s.decks.filter(d => scope.deckIds.includes(d.id)) : s.decks;
  let ids = [...new Set(ds.flatMap(d => d.propositionIds))];
  if (scope.propositionIds) ids = ids.filter(id => scope.propositionIds.includes(id));
  return { decks: ds, ids };
}
function reviewCues(p, scope) {
  const active = p.cues.filter(c => !c.deleted);
  if (scope.cueIds === undefined) return active;
  const pinned = learning(p) && active.find(c => c.id === p.learningCueId);
  // Do not switch away from an active learning cue just because it is unselected.
  if (pinned && !scope.cueIds.includes(pinned.id)) return [];
  return active.filter(c => scope.cueIds.includes(c.id));
}
// `live` is a Set of reviewable proposition IDs; omit it to treat all as live.
function nextReview(s, scope, now, live, random = Math.random) {
  const selection = scopeIds(s, scope), used = counts(s, now);
  const candidates = selection.ids.map(id => s.propositions[id]).filter(p => p && (!live || live.has(p.id)) && reviewCues(p, scope).length);
  const ready = candidates.filter(p => p.schedule.state !== 0 && scheduler.isDue(p.schedule, now, s.settings.dayStart));
  ready.sort((a, b) => (learning(a) ? 0 : 1) - (learning(b) ? 0 : 1) || a.schedule.due - b.schedule.due);
  let p = ready[0], admittingDeckId = null;
  if (!p) {
    for (const d of selection.decks) {
      if (used[d.id] >= d.newLimit) continue;
      p = candidates.find(p => p.schedule.state === 0 && d.propositionIds.includes(p.id));
      if (p) { admittingDeckId = d.id; break; }
    }
  }
  if (!p) {
    const future = candidates.filter(p => learning(p) && p.schedule.due > now).map(p => p.schedule.due);
    return { proposition: null, ...(future.length ? { nextDue: Math.min(...future) } : {}), remaining: 0 };
  }
  // Count introductions in the same deterministic admission order without
  // consuming allowances, changing schedules, or making additional cue choices.
  let remaining = ready.length;
  const simulated = { ...used }, introduced = new Set();
  for (const d of selection.decks) for (const candidate of candidates) {
    if (simulated[d.id] >= d.newLimit) break;
    if (candidate.schedule.state !== 0 || introduced.has(candidate.id) || !d.propositionIds.includes(candidate.id)) continue;
    introduced.add(candidate.id); remaining++;
    for (const id of memberships(s, candidate.id)) simulated[id]++;
  }
  const active = reviewCues(p, scope);
  const cue = (learning(p) && active.find(c => c.id === p.learningCueId)) || scheduler.chooseCue(active, random);
  return { proposition: p, cue, admittingDeckId, remaining };
}
// Mutates `s`: the caller owns persistence. `ids` carries requestId/ticketId.
function applyRating(s, p, c, rating, now, ids) {
  const before = p.schedule, introduced = p.firstReviewedAt == null;
  p.schedule = scheduler.rate(before, rating, now, s.settings);
  p.learningCueId = learning(p) ? c.id : null;
  p.firstReviewedAt ??= now; c.latestRating = rating; c.lastReviewedAt = now; p.version++;
  s.reviews.push({ id: globalThis.crypto.randomUUID(), requestId: ids.requestId, ticketId: ids.ticketId, propositionId: p.id, cueId: c.id, rating, at: now, before, after: p.schedule, introduced, deckIds: introduced ? memberships(s, p.id) : [], settings: structuredClone(s.settings) });
}

module.exports = { memberships, counts, scopeIds, reviewCues, nextReview, applyRating };
