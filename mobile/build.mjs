// Builds the mobile flashcards PWA into mobile/dist (static files for GitHub Pages).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.dirname(here), out = path.join(here, "dist");
await fs.rm(out, { recursive: true, force: true });

await esbuild.build({
	entryPoints: [path.join(here, "src/main.tsx")],
	outdir: out,
	bundle: true, splitting: true, format: "esm", minify: true, target: "safari16",
	jsx: "automatic",
	alias: { "@": root },
	define: { "process.env.NODE_ENV": '"production"' },
	loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
	assetNames: "assets/[name]-[hash]", chunkNames: "chunks/[name]-[hash]",
	logLevel: "warning",
});

const cssFrom = path.join(here, "src/styles.css");
const css = await postcss([tailwind({ base: root, optimize: { minify: true } })]).process(await fs.readFile(cssFrom, "utf8"), { from: cssFrom });
await fs.writeFile(path.join(out, "styles.css"), css.css);
await fs.copyFile(path.join(here, "index.html"), path.join(out, "index.html"));
await fs.cp(path.join(here, "public"), out, { recursive: true });

// Precache list for the service worker: every built file, versioned by content.
const files = (await fs.readdir(out, { recursive: true, withFileTypes: true })).filter(f => f.isFile())
	.map(f => path.relative(out, path.join(f.parentPath, f.name)).split(path.sep).join("/")).sort();
const hash = createHash("sha256");
for (const file of files) hash.update(file).update(await fs.readFile(path.join(out, file)));
const sw = (await fs.readFile(path.join(here, "src/sw.js"), "utf8"))
	.replace("__VERSION__", JSON.stringify(hash.digest("hex").slice(0, 16)))
	.replace("__FILES__", JSON.stringify(["./", ...files]));
await fs.writeFile(path.join(out, "sw.js"), sw);
const size = (await Promise.all(files.map(f => fs.stat(path.join(out, f))))).reduce((n, s) => n + s.size, 0);
console.log(`Built ${path.relative(root, out)}: ${files.length} files, ${(size / 1e6).toFixed(1)} MB`);
