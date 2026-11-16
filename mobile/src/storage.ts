// Tiny IndexedDB key-value store: flashcards.json can exceed localStorage limits.
const db = () => new Promise<IDBDatabase>((resolve, reject) => {
	const request = indexedDB.open("learnharness-flashcards", 1);
	request.onupgradeneeded = () => request.result.createObjectStore("kv");
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(request.error);
});

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const store = (await db()).transaction("kv", mode).objectStore("kv");
	return new Promise((resolve, reject) => {
		const request = action(store);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export const storage = {
	get: <T>(key: string) => run<T | undefined>("readonly", s => s.get(key)),
	set: async (key: string, value: unknown): Promise<void> => { await run("readwrite", s => s.put(value, key)); },
	clear: async (): Promise<void> => { await run("readwrite", s => s.clear()); },
};
export type Storage = typeof storage;
