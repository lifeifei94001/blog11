import type { APIRoute } from "astro";
import { getUnifiedPosts } from "@/lib/blog-store";
import { getPostUrlBySlug } from "@/utils/url-utils";

export const prerender = false;

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function buildHighlightedExcerpt(source: string, query: string): string {
	const plain = source
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/[#>*_`[\]()!-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const lower = plain.toLowerCase();
	const idx = lower.indexOf(query.toLowerCase());
	const start = idx > 30 ? idx - 30 : 0;
	const slice = plain.slice(start, start + 120);
	const escaped = escapeHtml(slice);
	if (!query) return escaped;
	const safeRe = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
	return escaped.replace(safeRe, (m) => `<mark>${m}</mark>`);
}

export const GET: APIRoute = async ({ url }) => {
	const query = (url.searchParams.get("q") || "").trim();
	if (!query) {
		return new Response(JSON.stringify({ results: [] }), {
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}

	const qLower = query.toLowerCase();
	const posts = await getUnifiedPosts(false);
	const matched = posts
		.filter((p) => {
			const hay = [
				p.data.title,
				p.data.description,
				p.data.category || "",
				...(p.data.tags || []),
				p.data.password ? "" : p.body,
			]
				.join("\n")
				.toLowerCase();
			return hay.includes(qLower);
		})
		.slice(0, 20)
		.map((p) => ({
			url: getPostUrlBySlug(p.slug),
			meta: { title: p.data.title },
			excerpt: buildHighlightedExcerpt(
				p.data.description || (p.data.password ? "加密文章" : p.body),
				query,
			),
		}));

	return new Response(JSON.stringify({ results: matched }), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
};
