import type { MarkdownHeading } from "astro";
import { Marked } from "marked";

export interface RenderedMarkdownResult {
	html: string;
	headings: MarkdownHeading[];
	words: number;
	minutes: number;
	excerpt: string;
}

const ALLOWED_TAGS = new Set([
	"p",
	"br",
	"hr",
	"div",
	"span",
	"blockquote",
	"pre",
	"code",
	"em",
	"strong",
	"i",
	"b",
	"u",
	"s",
	"del",
	"ins",
	"mark",
	"small",
	"sub",
	"sup",
	"kbd",
	"abbr",
	"cite",
	"q",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"dl",
	"dt",
	"dd",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"a",
	"img",
	"figure",
	"figcaption",
	"details",
	"summary",
	"input",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

const GLOBAL_ALLOWED_ATTRS = new Set([
	"id",
	"class",
	"title",
	"aria-hidden",
	"aria-label",
	"data-pagefind-ignore",
]);

const TAG_ALLOWED_ATTRS: Record<string, Set<string>> = {
	a: new Set(["href", "name", "target", "rel", "class"]),
	img: new Set([
		"src",
		"alt",
		"title",
		"width",
		"height",
		"loading",
		"referrerpolicy",
	]),
	input: new Set(["type", "checked", "disabled"]),
	code: new Set(["class"]),
	pre: new Set(["class"]),
	th: new Set(["align"]),
	td: new Set(["align"]),
	details: new Set(["open"]),
};

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function stripControlAndWhitespace(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		if (raw.charCodeAt(i) > 32) {
			out += raw[i];
		}
	}
	return out;
}

function isSafeHref(raw: string): boolean {
	const v = stripControlAndWhitespace(raw);
	if (!v) return false;
	if (v.startsWith("//")) return false;
	if (
		v.startsWith("/") ||
		v.startsWith("./") ||
		v.startsWith("../") ||
		v.startsWith("#")
	) {
		return true;
	}
	return /^(?:https?:|mailto:)/i.test(v);
}

function isSafeImgSrc(raw: string): boolean {
	const v = stripControlAndWhitespace(raw);
	if (!v) return false;
	if (v.startsWith("//")) return false;
	if (v.startsWith("/") || v.startsWith("./") || v.startsWith("../")) {
		return true;
	}
	if (/^https?:/i.test(v)) return true;
	return /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,/i.test(v);
}

function sanitizeAttributes(
	tag: string,
	rawAttrs: string,
): { attrsText: string; rejectTag?: boolean } {
	const allowedForTag = TAG_ALLOWED_ATTRS[tag];
	const attrRegex =
		/([a-zA-Z_:][-a-zA-Z0-9_.:]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
	const kept: string[] = [];
	let inputType = "";

	for (const match of rawAttrs.matchAll(attrRegex)) {
		const name = match[1].toLowerCase();
		const value = match[2] ?? match[3] ?? match[4] ?? "";

		if (name.startsWith("on") || name === "style" || name === "srcdoc") {
			continue;
		}
		if (!GLOBAL_ALLOWED_ATTRS.has(name) && !allowedForTag?.has(name)) {
			continue;
		}
		if (tag === "a" && name === "href" && !isSafeHref(value)) {
			continue;
		}
		if (tag === "img" && name === "src" && !isSafeImgSrc(value)) {
			continue;
		}
		if (tag === "input" && name === "type") {
			inputType = value.toLowerCase();
			if (inputType !== "checkbox") {
				return { attrsText: "", rejectTag: true };
			}
		}

		if (
			match[2] === undefined &&
			match[3] === undefined &&
			match[4] === undefined
		) {
			kept.push(name);
		} else {
			kept.push(`${name}="${escapeAttr(value)}"`);
		}
	}

	if (tag === "input" && inputType !== "checkbox") {
		return { attrsText: "", rejectTag: true };
	}

	return {
		attrsText: kept.length > 0 ? ` ${kept.join(" ")}` : "",
	};
}

function sanitizeHtmlOutput(rawHtml: string): string {
	let cleaned = rawHtml
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(
			/<(script|style|iframe|object|embed|applet|noscript|template|textarea|title|xmp|svg|math)\b[^>]*>[\s\S]*?<\/\1>/gi,
			"",
		)
		.replace(
			/<(script|style|iframe|object|embed|applet|noscript|template|textarea|title|xmp|svg|math)\b[^>]*\/?>/gi,
			"",
		);

	cleaned = cleaned.replace(
		/<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)(\s+[^<>]*)?(\s*\/?)>/g,
		(_full, slash: string, rawTag: string, rawAttrs: string | undefined) => {
			const tag = rawTag.toLowerCase();
			if (!ALLOWED_TAGS.has(tag)) {
				return "";
			}
			if (slash) {
				return VOID_TAGS.has(tag) ? "" : `</${tag}>`;
			}
			const { attrsText, rejectTag } = sanitizeAttributes(tag, rawAttrs || "");
			if (rejectTag) {
				return "";
			}
			return `<${tag}${attrsText}>`;
		},
	);

	return cleaned;
}

function createHeadingSlugger(): (text: string) => string {
	const counts = new Map<string, number>();
	return (text: string): string => {
		const base = text
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s_-]/gu, "")
			.replace(/\s+/g, "-");
		const key = base || "section";
		const count = counts.get(key) ?? 0;
		counts.set(key, count + 1);
		return count === 0 ? key : `${key}-${count}`;
	};
}

export function countReadingStats(markdown: string): {
	words: number;
	minutes: number;
	excerpt: string;
} {
	const stripped = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/[#>*_~|-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	const chineseChars = stripped.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
	const englishWords =
		stripped
			.replace(/[\u4e00-\u9fa5]/g, " ")
			.trim()
			.split(/\s+/)
			.filter(Boolean).length ?? 0;

	const words = chineseChars + englishWords;
	const minutes = Math.max(1, Math.ceil(words / 300));
	const excerpt =
		stripped.length > 140 ? `${stripped.slice(0, 140)}...` : stripped;

	return { words, minutes, excerpt };
}

export function renderMarkdownContent(
	markdown: string,
): RenderedMarkdownResult {
	const nextSlug = createHeadingSlugger();
	const headings: MarkdownHeading[] = [];

	const marked = new Marked({
		gfm: true,
		breaks: false,
	});

	marked.use({
		renderer: {
			heading({ tokens, depth }) {
				const rawText = this.parser.parseInline(tokens);
				const plainText = rawText.replace(/<[^>]+>/g, "").trim();
				const slug = nextSlug(plainText || `section-${headings.length + 1}`);
				headings.push({
					depth,
					slug,
					text: plainText,
				});
				return `<h${depth} id="${slug}">${rawText}<a class="anchor" href="#${slug}" aria-label="${escapeAttr(plainText)}"><span class="anchor-icon" data-pagefind-ignore="true">#</span></a></h${depth}>\n`;
			},
			link({ href, title, tokens }) {
				const text = this.parser.parseInline(tokens);
				const safeHref = href && isSafeHref(href) ? escapeAttr(href) : "#";
				const isExternal =
					safeHref.startsWith("http://") || safeHref.startsWith("https://");
				const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
				const relAttr = isExternal
					? ' target="_blank" rel="noopener noreferrer"'
					: "";
				return `<a href="${safeHref}"${titleAttr}${relAttr}>${text}</a>`;
			},
		},
	});

	const rawHtml = marked.parse(markdown || "") as string;
	const html = sanitizeHtmlOutput(rawHtml);
	const { words, minutes, excerpt } = countReadingStats(markdown || "");

	return {
		html,
		headings,
		words,
		minutes,
		excerpt,
	};
}
