// Offline-first sync of flashcards.json with the GitHub backup repo.
// `base` is the last file this phone saw on GitHub; `local` is base plus the
// ratings made here. A push merges local into GitHub's latest version with the
// same merge the Mac's git driver uses (GitHub's side wins on conflicts).
import { merge, valid } from "../../plugins/flashcards/src/merge.cjs";
import type * as GitHub from "./github";
import type { Storage } from "./storage";

// flashcards.json is untyped JavaScript data owned by the plugin.
export type Flashcards = any;
export type Config = GitHub.Config;
type Base = { sha: string; text: string };
export type Status = { phase: "idle" | "syncing" | "error"; message?: string; lastSync?: number };
type Client = Pick<typeof GitHub, "headSha" | "fileAt" | "commit">;

export const PUSH_DELAY = 30_000;
const MESSAGE = "Flashcards: sync reviews from phone";

function parse(text: string): Flashcards {
	const state = JSON.parse(text);
	if (!valid(state)) throw new Error("flashcards.json on GitHub is not a supported version. Update this app.");
	return state;
}

export class Sync {
	config?: Config;
	local?: Flashcards;
	dirty = false;
	status: Status = { phase: "idle" };
	private base?: Base;
	private running?: Promise<void>;
	private timer?: ReturnType<typeof setTimeout>;
	private listeners = new Set<() => void>();

	constructor(private github: Client, private storage: Storage) {}

	async load() {
		const s = this.storage;
		[this.config, this.base, this.local, this.dirty] = await Promise.all([
			s.get<Config>("config"), s.get<Base>("base"), s.get<Flashcards>("local"), s.get<boolean>("dirty").then(Boolean),
		]);
		this.status = { phase: "idle", lastSync: await s.get<number>("lastSync") };
	}

	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}
	private emit() { for (const listener of this.listeners) listener(); }

	/** New repository settings. Switching repositories drops this phone's copy. */
	async configure(config: Config) {
		const same = this.config && this.config.owner === config.owner && this.config.repo === config.repo && this.config.branch === config.branch;
		if (!same) await this.forget();
		this.config = config;
		await this.storage.set("config", config);
		this.emit();
		await this.sync();
	}

	async forget() {
		clearTimeout(this.timer);
		await this.storage.clear();
		this.config = this.base = this.local = undefined;
		this.dirty = false;
		this.status = { phase: "idle" };
		this.emit();
	}

	/** Records a local change (a rating) and schedules a debounced push. */
	async update(next: Flashcards) {
		this.local = next;
		this.dirty = true;
		this.emit();
		await Promise.all([this.storage.set("local", next), this.storage.set("dirty", true)]);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.sync(), PUSH_DELAY);
	}

	/** Pulls GitHub's version, or pushes local ratings first when there are any. */
	sync(): Promise<void> {
		this.running ??= this.run().finally(() => { this.running = undefined; });
		return this.running;
	}

	private async run() {
		const config = this.config;
		if (!config) return;
		clearTimeout(this.timer);
		this.status = { ...this.status, phase: "syncing", message: undefined };
		this.emit();
		try {
			for (let attempt = 0; ; attempt++) {
				const head = await this.github.headSha(config);
				if (!this.dirty || !this.base) {
					if (head !== this.base?.sha) {
						const text = await this.github.fileAt(config, head);
						await this.adopt({ sha: head, text }, parse(text), false);
					}
					break;
				}
				const snapshot = this.local, base = this.base;
				const merged = head === base.sha ? snapshot : merge(parse(base.text), parse(await this.github.fileAt(config, head)), snapshot);
				const text = JSON.stringify(merged);
				const sha = await this.github.commit(config, head, text, MESSAGE);
				if (!sha) {
					if (attempt < 3) continue; // someone else pushed meanwhile
					throw new Error("GitHub kept changing during sync. Try again.");
				}
				// Ratings made while this push ran are merged on top of what was committed.
				const current = this.local;
				await this.adopt({ sha, text }, current === snapshot ? merged : merge(snapshot, merged, current), current !== snapshot);
				break;
			}
			const lastSync = Date.now();
			await this.storage.set("lastSync", lastSync);
			this.status = { phase: "idle", lastSync };
		} catch (error) {
			const offline = typeof navigator !== "undefined" && !navigator.onLine;
			this.status = { ...this.status, phase: "error", message: offline ? "Offline. Ratings are saved on this phone and sync later." : error instanceof Error ? error.message : String(error) };
		}
		this.emit();
		if (this.dirty) this.timer = setTimeout(() => void this.sync(), PUSH_DELAY);
	}

	private async adopt(base: Base, local: Flashcards, dirty: boolean) {
		this.base = base;
		this.local = local;
		this.dirty = dirty;
		await Promise.all([this.storage.set("base", base), this.storage.set("local", local), this.storage.set("dirty", dirty)]);
		this.emit();
	}
}
