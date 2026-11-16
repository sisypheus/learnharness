import "katex/dist/katex.min.css";
import { StrictMode, useEffect, useReducer, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import queue from "../../plugins/flashcards/src/review-queue.cjs";
import scheduler from "../../plugins/flashcards/src/scheduler.cjs";
import { buildPracticeCards } from "../../plugins/flashcards/src/practice-queue.js";
import { interval } from "../../plugins/flashcards/src/review.js";
import * as github from "./github";
import { Markdown } from "./markdown";
import { storage } from "./storage";
import { Sync, type Config, type Flashcards } from "./sync";

const sync = new Sync(github, storage);
type Scope = { deckIds?: string[] };
type Session = { kind: "review" | "practice"; scope: Scope; title: string };
type Next = { proposition: Flashcards | null; cue?: Flashcards; remaining: number; nextDue?: number };

const RATINGS = [
	{ value: 1, label: "Again", color: "var(--fc-red)" },
	{ value: 2, label: "Hard", color: "var(--fc-amber)" },
	{ value: 3, label: "Good", color: "var(--fc-green)" },
	{ value: 4, label: "Easy", color: "var(--fc-blue)" },
];

function Button({ children, onClick, disabled, color, wide }: { children: ReactNode; onClick: () => void; disabled?: boolean; color?: string; wide?: boolean }) {
	const style = color ? { color, borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined;
	return (
		<button type="button" onClick={onClick} disabled={disabled} style={style}
			className={`min-h-11 rounded-lg border border-border px-4 text-[15px] font-medium active:opacity-70 disabled:opacity-40 ${wide ? "flex-1" : ""}`}>
			{children}
		</button>
	);
}

function statusText(): string {
	const { phase, message, lastSync } = sync.status;
	if (phase === "syncing") return "Syncing…";
	if (phase === "error") return message ?? "Sync failed.";
	const pending = sync.dirty ? " · ratings waiting to sync" : "";
	return (lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not synced yet") + pending;
}

function Setup({ onDone }: { onDone?: () => void }) {
	const current = sync.config;
	const [repo, setRepo] = useState(current ? `${current.owner}/${current.repo}` : "");
	const [branch, setBranch] = useState(current?.branch ?? "main");
	const [token, setToken] = useState(current?.token ?? "");
	const [busy, setBusy] = useState(false);
	const [confirmForget, setConfirmForget] = useState(false);
	const [owner, name] = repo.trim().split("/");
	const valid = !!owner && !!name && !!branch.trim() && !!token.trim();
	const save = async () => {
		setBusy(true);
		const config: Config = { owner: owner!.trim(), repo: name!.trim(), branch: branch.trim(), token: token.trim() };
		await sync.configure(config);
		setBusy(false);
		if (sync.local) onDone?.();
	};
	const field = "mt-1 block w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[16px]";
	return (
		<main className="mx-auto max-w-md space-y-5 p-5">
			<h1 className="text-xl font-semibold">Connect to your backup</h1>
			<p className="text-sm text-muted-foreground">The private GitHub repository that learnharness-git pushes your learning data to. The token stays on this phone and is only sent to api.github.com.</p>
			<label className="block text-sm font-medium">Repository (owner/name)
				<input className={field} value={repo} onChange={e => setRepo(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="you/learnharness-data" />
			</label>
			<label className="block text-sm font-medium">Branch
				<input className={field} value={branch} onChange={e => setBranch(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
			</label>
			<label className="block text-sm font-medium">Fine-grained token (Contents: read and write, this repository only)
				<input className={field} type="password" value={token} onChange={e => setToken(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
			</label>
			{sync.status.phase === "error" && <p role="alert" className="text-sm text-destructive">{sync.status.message}</p>}
			<div className="flex gap-3">
				<Button wide onClick={() => void save()} disabled={!valid || busy}>{busy ? "Connecting…" : "Connect"}</Button>
				{onDone && sync.local && <Button onClick={onDone}>Cancel</Button>}
			</div>
			{current && (
				<div className="border-t border-border pt-5">
					{!confirmForget ? <Button onClick={() => setConfirmForget(true)}>Disconnect this phone…</Button> : (
						<div className="space-y-3">
							<p className="text-sm">{sync.dirty ? "Some ratings have not synced yet and will be lost. " : ""}This removes the token and the cards stored on this phone.</p>
							<div className="flex gap-3">
								<Button color="var(--fc-red)" onClick={() => void sync.forget()}>Disconnect</Button>
								<Button onClick={() => setConfirmForget(false)}>Keep</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</main>
	);
}

function deckSummary(s: Flashcards, deck: Flashcards, now: number) {
	const used = queue.counts(s, now)[deck.id] ?? 0;
	let due = 0, fresh = 0;
	for (const id of deck.propositionIds) {
		const p = s.propositions[id];
		if (!p || !p.cues.some((c: Flashcards) => !c.deleted)) continue;
		if (p.schedule.state === 0) fresh++;
		else if (scheduler.isDue(p.schedule, now, s.settings.dayStart)) due++;
	}
	return `${due} due · ${Math.min(fresh, Math.max(0, deck.newLimit - used))} new`;
}

function Home({ open, settings }: { open: (session: Session) => void; settings: () => void }) {
	const s = sync.local, now = Date.now();
	return (
		<main className="mx-auto max-w-xl p-4">
			<header className="mb-4 flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<h1 className="text-xl font-semibold">Flashcards</h1>
					<p className={`truncate text-xs ${sync.status.phase === "error" ? "text-destructive" : "text-muted-foreground"}`}>{statusText()}</p>
				</div>
				<Button onClick={() => void sync.sync()} disabled={sync.status.phase === "syncing"}>Sync</Button>
				<Button onClick={settings}>Settings</Button>
			</header>
			<div className="mb-4 flex gap-3">
				<Button wide onClick={() => open({ kind: "review", scope: {}, title: "All decks" })}>Review all</Button>
				<Button wide onClick={() => open({ kind: "practice", scope: {}, title: "All decks" })}>Practice all</Button>
			</div>
			{!s.decks.length && <p className="text-sm text-muted-foreground">No decks yet. Create cards on the Mac, then sync.</p>}
			<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
				{s.decks.map((deck: Flashcards) => (
					<li key={deck.id} className="flex items-center gap-2 bg-card p-3">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium">{deck.name}</p>
							<p className="text-xs text-muted-foreground">{deckSummary(s, deck, now)}</p>
						</div>
						<Button onClick={() => open({ kind: "review", scope: { deckIds: [deck.id] }, title: deck.name })}>Review</Button>
						<Button onClick={() => open({ kind: "practice", scope: { deckIds: [deck.id] }, title: deck.name })}>Practice</Button>
					</li>
				))}
			</ul>
		</main>
	);
}

function Stage({ title, onClose, children, note }: { title: string; onClose: () => void; children: ReactNode; note?: string }) {
	return (
		<main className="mx-auto flex min-h-dvh max-w-2xl flex-col p-4">
			<header className="mb-4 flex items-center gap-3">
				<p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{title}</p>
				<Button onClick={onClose}>Done</Button>
			</header>
			<div className="my-auto text-center">{children}</div>
			{note && <p className="mt-6 text-center text-xs text-muted-foreground">{note}</p>}
		</main>
	);
}

function Card({ question, answer, name }: { question: string; answer?: string; name?: string }) {
	return (
		<>
			{name && <h2 className="mb-4 text-base font-semibold">{name}</h2>}
			<div className="flex min-h-[56.25vw] flex-col justify-center rounded-xl border border-border bg-card p-5 sm:min-h-[20rem]">
				<Markdown text={question} />
				{answer !== undefined && <div className="mt-6 border-t border-border pt-6"><Markdown text={answer} /></div>}
			</div>
		</>
	);
}

function Review({ session, onClose }: { session: Session; onClose: () => void }) {
	const pick = (): Next => queue.nextReview(sync.local, session.scope, Date.now());
	const [card, setCard] = useState(pick);
	const [revealed, setRevealed] = useState(false);
	const [error, setError] = useState("");
	const next = () => { setCard(pick()); setRevealed(false); setError(""); };
	// Wake up when the next learning step becomes due, like the Mac.
	useEffect(() => {
		if (card.proposition || card.nextDue === undefined) return;
		const timer = setTimeout(next, Math.min(2147483647, Math.max(100, card.nextDue - Date.now())));
		return () => clearTimeout(timer);
	}, [card]);

	if (!card.proposition) {
		return (
			<Stage title={session.title} onClose={onClose}>
				<p className="text-sm text-muted-foreground">{card.nextDue ? `No cards ready. Next due ${new Date(card.nextDue).toLocaleString()}.` : "No cards due in this selection."}</p>
			</Stage>
		);
	}
	const { proposition, cue, remaining } = card;
	const rate = async (rating: number) => {
		try {
			const state = structuredClone(sync.local), p = state.propositions[proposition.id], c = p?.cues.find((c: Flashcards) => c.id === cue.id && !c.deleted);
			if (!c) return next(); // changed by a sync while shown
			queue.applyRating(state, p, c, rating, Date.now(), { requestId: crypto.randomUUID(), ticketId: crypto.randomUUID() });
			state.revision++;
			await sync.update(state);
			next();
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
	};
	const now = Date.now(), previews = revealed ? scheduler.preview(proposition.schedule, now, sync.local.settings) : null;
	return (
		<Stage title={session.title} onClose={onClose}>
			<Card question={cue.question} answer={revealed ? cue.answer : undefined} name={revealed ? proposition.name : undefined} />
			<p className="mt-2 text-right text-xs text-muted-foreground">{remaining} ready</p>
			<div className="mt-5 flex gap-2">
				{!revealed ? <Button wide onClick={() => setRevealed(true)}>Reveal answer</Button> : RATINGS.map(r => {
					const after = previews![r.value];
					return (
						<Button key={r.value} wide color={r.color} onClick={() => void rate(r.value)}>
							<span className="block">{r.label}</span>
							<span className="block text-xs opacity-80">{interval(after.state === 2 ? after.scheduled_days * 86400000 : after.due - now)}</span>
						</Button>
					);
				})}
			</div>
			{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
		</Stage>
	);
}

function Practice({ session, onClose }: { session: Session; onClose: () => void }) {
	const [cards] = useState(() => buildPracticeCards({ decks: sync.local.decks, propositions: Object.values(sync.local.propositions) }, session.scope));
	const [index, setIndex] = useState(0);
	const [revealed, setRevealed] = useState(false);
	const card = cards[index], remaining = cards.length - index - 1;
	return (
		<Stage title={session.title} onClose={onClose} note="Practice mode does not change your review schedule.">
			{!card ? <p className="text-sm text-muted-foreground">Practice complete.</p> : (
				<>
					<Card question={card.question} answer={revealed ? card.answer : undefined} name={revealed ? card.propositionName : undefined} />
					<p className="mt-2 text-right text-xs text-muted-foreground">{remaining} {remaining === 1 ? "card" : "cards"} remaining</p>
					<div className="mt-5 flex">
						{!revealed ? <Button wide onClick={() => setRevealed(true)}>Reveal answer</Button>
							: <Button wide onClick={() => { setIndex(index + 1); setRevealed(false); }}>Next</Button>}
					</div>
				</>
			)}
		</Stage>
	);
}

function App() {
	const [loaded, setLoaded] = useState(false);
	const [, render] = useReducer((n: number) => n + 1, 0);
	const [session, setSession] = useState<Session | null>(null);
	const [settings, setSettings] = useState(false);
	useEffect(() => {
		const off = sync.subscribe(render);
		void sync.load().then(() => { setLoaded(true); void sync.sync(); });
		// Pull when reopened; push right away when leaving (iOS may suspend us).
		const wake = () => { if (document.visibilityState === "visible" || sync.dirty) void sync.sync(); };
		document.addEventListener("visibilitychange", wake);
		window.addEventListener("online", wake);
		void navigator.storage?.persist?.();
		return () => { off(); document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); };
	}, []);
	if (!loaded) return null;
	if (!sync.config || settings) return <Setup onDone={sync.config ? () => setSettings(false) : undefined} />;
	if (!sync.local) {
		return (
			<main className="mx-auto max-w-md space-y-4 p-5">
				<p className="text-sm">{sync.status.phase === "error" ? sync.status.message : "Downloading your cards…"}</p>
				{sync.status.phase === "error" && <div className="flex gap-3"><Button onClick={() => void sync.sync()}>Retry</Button><Button onClick={() => setSettings(true)}>Settings</Button></div>}
			</main>
		);
	}
	const close = () => { setSession(null); };
	if (session?.kind === "review") return <Review session={session} onClose={close} />;
	if (session?.kind === "practice") return <Practice session={session} onClose={close} />;
	return <Home open={setSession} settings={() => setSettings(true)} />;
}

if ("serviceWorker" in navigator && location.protocol === "https:") void navigator.serviceWorker.register("sw.js");
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
