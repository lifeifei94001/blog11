import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import {
	deleteTursoPost,
	getUnifiedPosts,
	type TursoPostInput,
	upsertTursoPost,
} from "@/lib/blog-store";

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}

export const GET: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const posts = await getUnifiedPosts(true);
		const items = posts.map((p) => ({
			slug: p.slug,
			source: p.source,
			title: p.data.title,
			description: p.data.description,
			content: p.body,
			image: p.data.image,
			category: p.data.category || "",
			tags: p.data.tags,
			series: p.data.series,
			seriesOrder: p.data.seriesOrder ?? null,
			published: p.data.published.toISOString(),
			updated: p.data.updated ? p.data.updated.toISOString() : "",
			draft: p.data.draft,
			pinned: p.data.pinned,
			author: p.data.author,
			password: p.data.password,
			passwordHint: p.data.passwordHint,
		}));
		return json({ ok: true, items });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "读取文章列表失败",
			},
			500,
		);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const body = (await request.json()) as Partial<TursoPostInput>;
		if (!body.title?.trim() || !body.slug?.trim()) {
			return json({ ok: false, error: "文章标题和 Slug 不能为空" }, 400);
		}
		const saved = await upsertTursoPost({
			slug: body.slug,
			title: body.title,
			description: body.description,
			content: body.content ?? "",
			image: body.image,
			category: body.category,
			tags: Array.isArray(body.tags) ? body.tags : [],
			series: body.series,
			seriesOrder: body.seriesOrder ?? null,
			published: body.published,
			updated: body.updated,
			draft: Boolean(body.draft),
			pinned: Boolean(body.pinned),
			author: body.author,
			password: body.password,
			passwordHint: body.passwordHint,
		});
		return json({ ok: true, slug: saved.slug });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "保存文章失败",
			},
			500,
		);
	}
};

export const PUT: APIRoute = POST;

export const DELETE: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const body = (await request.json().catch(() => ({}))) as { slug?: string };
		const urlSlug = new URL(request.url).searchParams.get("slug");
		const slug = String(body.slug || urlSlug || "").trim();
		if (!slug) {
			return json({ ok: false, error: "缺少文章 Slug" }, 400);
		}
		await deleteTursoPost(slug);
		return json({ ok: true });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "删除文章失败",
			},
			500,
		);
	}
};
