/**
 * Mobile flashcards sync (mobile/src/sync.ts) against an in-memory GitHub:
 * pull, push on top of an unchanged branch, merge when the Mac pushed
 * meanwhile, retry when the branch moves during a push, and ratings made
 * while a push is in flight.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { Sync, type Flashcards } from "../mobile/src/sync.ts";
import queue from "../plugins/flashcards/src/review-queue.cjs";
import scheduler from "../plugins/flashcards/src/scheduler.cjs";
import { defaults } from "../plugins/flashcards/src/store.cjs";

const T0 = +new Date(2026, 0, 10, 12);
const config = { owner: "me", repo: "data", branch: "main", token: "t" };

function initial(): Flashcards {
	const p = (id: string) => ({ id, origin: "manual", name: id, statement: "", cues: [{ id: `${id}1`, question: "q", answer: "a" }], schedule: scheduler.createSchedule(T0 - 1000), firstReviewedAt: null, learningCueId: null, version: 1 });
	return { version: 1, revision: 1, settings: { ...defaults(), autoSince: 0 }, batches: [], reviews: [], decks: [{ id: "d", name: "D", newLimit: 20, propositionIds: ["a", "b"] }], propositions: { a: p("a"), b: p("b") } };
}
function rated(state: Flashcards, id: string, at: number) {
	const s = structuredClone(state), p = s.propositions[id];
	queue.applyRating(s, p, p.cues[0], 3, at, { requestId: `${id}${at}`, ticketId: `${id}${at}` });
	s.revision++;
	return s;
}

function fakeGitHub(start: Flashcards) {
	const commits = new Map([["c0", JSON.stringify(start)]]);
	let head = "c0", n = 0;
	const gh = {
		pushes: 0,
		beforePush: undefined as undefined | (() => void),
		get head() { return head; },
		file: () => JSON.parse(commits.get(head)!),
		/** Simulates the Mac pushing a new version. */
		push(state: Flashcards) { const sha = `c${++n}`; commits.set(sha, JSON.stringify(state)); head = sha; },
		headSha: async () => head,
		fileAt: async (_: unknown, sha: string) => commits.get(sha)!,
		commit: async (_: unknown, parent: string, text: string) => {
			gh.beforePush?.(); gh.beforePush = undefined;
			if (parent !== head) return null;
			gh.pushes++; gh.push(JSON.parse(text)); return head;
		},
	};
	return gh;
}
function memory() {
	const map = new Map<string, unknown>();
	return { get: async <T>(k: string) => structuredClone(map.get(k)) as T | undefined, set: async (k: string, v: unknown) => { map.set(k, structuredClone(v)); }, clear: async () => map.clear() };
}

test("first sync downloads the file; nothing is pushed without local ratings", async () => {
	const gh = fakeGitHub(initial()), sync = new Sync(gh, memory());
	await sync.configure(config);
	assert.deepEqual(sync.local, initial());
	await sync.sync();
	assert.equal(gh.pushes, 0);
	assert.equal(sync.status.phase, "idle");
});

test("a rating is pushed on top of the unchanged branch and survives a reload", async () => {
	const gh = fakeGitHub(initial()), store = memory(), sync = new Sync(gh, store);
	await sync.configure(config);
	await sync.update(rated(sync.local, "a", T0));
	assert.equal(sync.dirty, true);
	await sync.sync();
	assert.equal(gh.pushes, 1);
	assert.equal(gh.file().reviews.length, 1);
	assert.equal(sync.dirty, false);
	const reopened = new Sync(gh, store);
	await reopened.load();
	assert.deepEqual(reopened.local, sync.local);
	assert.equal(reopened.dirty, false);
});

test("when the Mac pushed meanwhile, both sides' ratings are merged", async () => {
	const gh = fakeGitHub(initial()), sync = new Sync(gh, memory());
	await sync.configure(config);
	gh.push(rated(gh.file(), "b", T0)); // Mac
	await sync.update(rated(sync.local, "a", T0 + 1000)); // phone
	await sync.sync();
	assert.deepEqual(gh.file().reviews.map((r: Flashcards) => r.propositionId).sort(), ["a", "b"]);
	assert.equal(sync.local.propositions.b.schedule.reps, 1);
});

test("a push that loses the race to the Mac is retried with a fresh merge", async () => {
	const gh = fakeGitHub(initial()), sync = new Sync(gh, memory());
	await sync.configure(config);
	await sync.update(rated(sync.local, "a", T0));
	gh.beforePush = () => gh.push(rated(gh.file(), "b", T0 + 5));
	await sync.sync();
	assert.equal(gh.pushes, 1);
	assert.deepEqual(gh.file().reviews.map((r: Flashcards) => r.propositionId).sort(), ["a", "b"]);
});

test("ratings made while a push is in flight stay local and pending", async () => {
	const gh = fakeGitHub(initial()), sync = new Sync(gh, memory());
	await sync.configure(config);
	await sync.update(rated(sync.local, "a", T0));
	let during: Promise<void> | undefined;
	gh.beforePush = () => { during = sync.update(rated(sync.local, "b", T0 + 10)); };
	await sync.sync();
	await during;
	assert.equal(gh.file().reviews.length, 1);
	assert.deepEqual(sync.local.reviews.map((r: Flashcards) => r.propositionId), ["a", "b"]);
	assert.equal(sync.dirty, true);
	await sync.sync();
	assert.equal(gh.file().reviews.length, 2);
	assert.equal(sync.dirty, false);
	await sync.forget(); // clears the pending push timer
});
