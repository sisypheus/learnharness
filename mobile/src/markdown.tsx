// Card Markdown through the Mac app's streamdown setup (GFM, CJK, line
// breaks, KaTeX math, highlighted code, blocked remote images, legacy math
// delimiters), plus streamdown's own Mermaid renderer with the Mac's config.
import { createMermaidPlugin } from "@streamdown/mermaid";
import { useSyncExternalStore } from "react";
import { Streamdown } from "streamdown";
import { streamdownPlugins, streamdownRehypePlugins, streamdownRemend } from "@/components/ai-elements/streamdown-config";
import { mermaidConfig } from "@/components/mermaid-render";
import { repairMathForDisplay, transformMathDelimiters } from "@/src/core/math-delims";

const plugins = { ...streamdownPlugins, mermaid: createMermaidPlugin() };
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const useDark = () => useSyncExternalStore(listener => {
	dark.addEventListener("change", listener);
	return () => dark.removeEventListener("change", listener);
}, () => dark.matches);

export function Markdown({ text }: { text: string }) {
	const mode = useDark() ? "dark" : "light";
	return (
		<Streamdown
			key={`${mode}:${text}`}
			className="card-markdown"
			mode="static"
			isAnimating={false}
			controls={false}
			plugins={plugins}
			rehypePlugins={streamdownRehypePlugins}
			remend={streamdownRemend}
			mermaid={{ config: mermaidConfig(mode) }}
			linkSafety={{ enabled: false }}
		>
			{transformMathDelimiters(repairMathForDisplay(text))}
		</Streamdown>
	);
}
