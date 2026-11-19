import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { createComment, deleteComment, listComments } from "@/lib/blog-store";

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

export const GET: APIRoute = async ({ request, url }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const pagePath = url.searchParams.get("path") || undefined;
		const comments = await listComments(pagePath, 200);
		return json({ ok: true, comments });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "获取留言列表失败",
			},
			500,
		);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const body = (await request.json()) as {
			pagePath?: string;
			authorName?: string;
			content?: string;
		};
		const comment = await createComment({
			pagePath: String(body.pagePath || "/guestbook/"),
			authorName: String(body.authorName || auth.session.username || "博主"),
			content: String(body.content || ""),
			isAdmin: true,
		});
		return json({ ok: true, comment }, 201);
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "回复失败",
			},
			400,
		);
	}
};

export const DELETE: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const body = (await request.json()) as { id?: string };
		await deleteComment(String(body.id || ""));
		return json({ ok: true });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "删除留言失败",
			},
			400,
		);
	}
};
