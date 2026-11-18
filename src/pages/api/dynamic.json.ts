import { getUnifiedDynamics } from "@/lib/blog-store";
import { renderMarkdownContent } from "@/lib/markdown-renderer";

export const prerender = false;

const markdownImagePattern = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g;

export async function GET(): Promise<Response> {
	const dynamics = await getUnifiedDynamics();
	const data = dynamics.map((entry) => {
		const images: Array<{ alt: string; src: string; title?: string }> = [];
		const markdown = (entry.body || "").replace(
			markdownImagePattern,
			(_match, alt: string, src: string, title?: string) => {
				images.push({ alt, src, ...(title ? { title } : {}) });
				return "";
			},
		);
		const rendered = renderMarkdownContent(markdown);
		const searchText = [
			(entry.body || "").replace(/[#>*_`~[\]()!-]/g, " "),
			entry.data.location,
		]
			.filter(Boolean)
			.join(" ")
			.toLocaleLowerCase();

		return {
			id: entry.id,
			published: entry.data.published.getTime(),
			html: rendered.html,
			images,
			searchText,
			pinned: entry.data.pinned || false,
			location: entry.data.location.trim(),
		};
	});

	return new Response(JSON.stringify(data), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}
