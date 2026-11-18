import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { isB2Configured } from "@/lib/b2-storage";
import {
	getEffectiveSettings,
	type SiteRuntimeSettings,
	saveEffectiveSettings,
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
		const settings = await getEffectiveSettings();
		// 仅返回站点设置与对象存储可用状态，严格不在界面返回任何数据库配置信息
		return json({
			ok: true,
			settings,
			storageReady: isB2Configured(),
		});
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "读取站点设置失败",
			},
			500,
		);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const body = (await request.json()) as Partial<SiteRuntimeSettings>;
		const saved = await saveEffectiveSettings({
			siteTitle: body.siteTitle,
			siteSubtitle: body.siteSubtitle,
			siteDescription: body.siteDescription,
			navbarTitle: body.navbarTitle,
			profileName: body.profileName,
			profileBio: body.profileBio,
			profileAvatar: body.profileAvatar,
			announcementTitle: body.announcementTitle,
			announcementContent: body.announcementContent,
			bannerTitle: body.bannerTitle,
			bannerSubtitles: body.bannerSubtitles,
		});
		return json({ ok: true, settings: saved });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "保存站点设置失败",
			},
			500,
		);
	}
};

export const PUT: APIRoute = POST;
