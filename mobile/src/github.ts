// Minimal GitHub REST client for one file in the learning-data backup repo.
// Uses the git data API so files over 1 MB work and every push is a
// fast-forward from a known parent (a concurrent push makes it return null).
export type Config = { owner: string; repo: string; branch: string; token: string };

export const PATH = "core-plugin-data/flashcards/flashcards.json";

export class GitHubError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}

function describe(status: number, body: string): string {
	let detail = body;
	try { detail = JSON.parse(body).message ?? body; } catch { /* plain text body */ }
	if (status === 401) return "GitHub rejected the token. It may be expired or revoked.";
	if (status === 404) return `Not found on GitHub. Check the repository, branch and token access, and that the Mac has pushed ${PATH}.`;
	return `GitHub error ${status}: ${detail}`;
}

async function call(cfg: Config, path: string, init: RequestInit = {}, accept = "application/vnd.github+json"): Promise<Response> {
	const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`, {
		...init,
		cache: "no-store",
		headers: {
			Accept: accept,
			Authorization: `Bearer ${cfg.token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(init.body ? { "Content-Type": "application/json" } : {}),
		},
	});
	if (!res.ok) throw new GitHubError(res.status, describe(res.status, await res.text()));
	return res;
}
const json = async (res: Promise<Response>) => (await res).json();
const branch = (cfg: Config) => cfg.branch.split("/").map(encodeURIComponent).join("/");

export async function headSha(cfg: Config): Promise<string> {
	return (await json(call(cfg, `/git/ref/heads/${branch(cfg)}`))).object.sha;
}

export async function fileAt(cfg: Config, commit: string): Promise<string> {
	return (await call(cfg, `/contents/${PATH}?ref=${commit}`, {}, "application/vnd.github.raw+json")).text();
}

/** Commits `text` as the flashcards file on top of `parent`. Returns the new
 * commit SHA, or null when the branch moved since `parent` (caller retries). */
export async function commit(cfg: Config, parent: string, text: string, message: string): Promise<string | null> {
	const post = (path: string, body: unknown) => json(call(cfg, path, { method: "POST", body: JSON.stringify(body) }));
	const { tree } = await json(call(cfg, `/git/commits/${parent}`));
	const blob = await post("/git/blobs", { content: text, encoding: "utf-8" });
	const next = await post("/git/trees", { base_tree: tree.sha, tree: [{ path: PATH, mode: "100644", type: "blob", sha: blob.sha }] });
	const created = await post("/git/commits", { message, tree: next.sha, parents: [parent] });
	try {
		await call(cfg, `/git/refs/heads/${branch(cfg)}`, { method: "PATCH", body: JSON.stringify({ sha: created.sha, force: false }) });
	} catch (error) {
		if (error instanceof GitHubError && error.status === 422) return null; // not a fast-forward
		throw error;
	}
	return created.sha;
}
