import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import {
	deleteTursoDynamic,
	getUnifiedDynamics,
	type TursoDynamicInput,
	upsertTursoDynamic,
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
		const dynamics = await getUnifiedDynamics();
		const items = dynamics.map((d) => ({
			id: d.id,
			source: d.source,
			content: d.body,
			location: d.data.location,
			pinned: d.data.pinned,
			published: d.data.published.toISOString(),
		}));
		return json({ ok: true, items });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "读取动态列表失败",
			},
			500,
		);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const body = (await request.json()) as Partial<TursoDynamicInput>;
		if (!body.content?.trim()) {
			return json({ ok: false, error: "动态内容不能为空" }, 400);
		}
		const saved = await upsertTursoDynamic({
			id: body.id,
			content: body.content,
			location: body.location,
			pinned: Boolean(body.pinned),
			published: body.published,
		});
		return json({ ok: true, id: saved.id });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "保存动态失败",
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
		const body = (await request.json().catch(() => ({}))) as { id?: string };
		const urlId = new URL(request.url).searchParams.get("id");
		const id = String(body.id || urlId || "").trim();
		if (!id) {
			return json({ ok: false, error: "缺少动态 ID" }, 400);
		}
		await deleteTursoDynamic(id);
		return json({ ok: true });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "删除动态失败",
			},
			500,
		);
	}
};
