import type { APIRoute } from "astro";
import { getAdminSession } from "@/lib/auth";
import {
	createComment,
	getEffectiveSettings,
	listComments,
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

function isCommentAllowedForPath(
	path: string,
	settings: Awaited<ReturnType<typeof getEffectiveSettings>>,
): boolean {
	if (settings.commentType === "none") return false;
	const clean = path.trim();
	if (clean.startsWith("/guestbook")) {
		return settings.commentEnableGuestbook !== false;
	}
	return settings.commentEnablePosts !== false;
}

export const GET: APIRoute = async ({ url }) => {
	const path = url.searchParams.get("path") || "/guestbook/";
	try {
		const settings = await getEffectiveSettings();
		const enabled =
			settings.commentType === "native" &&
			isCommentAllowedForPath(path, settings);
		const comments = await listComments(path, 100);
		return json({ ok: true, enabled, comments });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "读取留言失败",
			},
			500,
		);
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const settings = await getEffectiveSettings();
		const body = (await request.json()) as {
			pagePath?: string;
			authorName?: string;
			authorEmail?: string;
			authorWebsite?: string;
			content?: string;
		};

		const pagePath = String(body.pagePath || "/guestbook/");
		if (
			settings.commentType !== "native" ||
			!isCommentAllowedForPath(pagePath, settings)
		) {
			return json({ ok: false, error: "当前页面暂未开启内置留言功能" }, 403);
		}

		const adminSession = getAdminSession(request);
		const comment = await createComment({
			pagePath,
			authorName: String(body.authorName || ""),
			authorEmail: String(body.authorEmail || ""),
			authorWebsite: String(body.authorWebsite || ""),
			content: String(body.content || ""),
			isAdmin: Boolean(adminSession),
		});

		return json({ ok: true, comment }, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "提交留言失败";
		const status = msg.includes("昵称") || msg.includes("不能为空") ? 400 : 500;
		return json({ ok: false, error: msg }, status);
	}
};
