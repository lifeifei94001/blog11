import type { MarkdownHeading } from "astro";
import GithubSlugger from "github-slugger";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

export interface RenderedMarkdownResult {
	html: string;
	headings: MarkdownHeading[];
	words: number;
	minutes: number;
	excerpt: string;
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: [
		...sanitizeHtml.defaults.allowedTags,
		"img",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"pre",
		"code",
		"span",
		"del",
		"ins",
		"input",
		"details",
		"summary",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
		"hr",
		"figure",
		"figcaption",
	],
	allowedAttributes: {
		...sanitizeHtml.defaults.allowedAttributes,
		"*": ["id", "class", "title", "aria-hidden", "aria-label"],
		a: ["href", "name", "target", "rel", "class"],
		img: [
			"src",
			"alt",
			"title",
			"width",
			"height",
			"loading",
			"referrerpolicy",
		],
		input: ["type", "checked", "disabled"],
		code: ["class"],
		pre: ["class"],
		th: ["align"],
		td: ["align"],
	},
	allowedSchemes: ["http", "https", "mailto", "data"],
	allowProtocolRelative: false,
};

function countReadingStats(markdown: string): {
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
	const slugger = new GithubSlugger();
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
				const slug = slugger.slug(
					plainText || `section-${headings.length + 1}`,
				);
				headings.push({
					depth,
					slug,
					text: plainText,
				});
				return `<h${depth} id="${slug}">${rawText}<a class="anchor" href="#${slug}" aria-label="${plainText}"><span class="anchor-icon" data-pagefind-ignore="true">#</span></a></h${depth}>\n`;
			},
			link({ href, title, tokens }) {
				const text = this.parser.parseInline(tokens);
				const safeHref = href || "#";
				const isExternal =
					safeHref.startsWith("http://") || safeHref.startsWith("https://");
				const titleAttr = title
					? ` title="${title.replace(/"/g, "&quot;")}"`
					: "";
				const relAttr = isExternal
					? ' target="_blank" rel="noopener noreferrer"'
					: "";
				return `<a href="${safeHref}"${titleAttr}${relAttr}>${text}</a>`;
			},
		},
	});

	const rawHtml = marked.parse(markdown || "") as string;
	const html = sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
	const { words, minutes, excerpt } = countReadingStats(markdown || "");

	return {
		html,
		headings,
		words,
		minutes,
		excerpt,
	};
}
