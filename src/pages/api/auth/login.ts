import type { APIRoute } from "astro";
import {
	buildSessionCookieHeader,
	createAdminSessionToken,
	verifyAdminLogin,
} from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json().catch(() => ({}))) as {
			username?: string;
			password?: string;
		};
		const username = String(body.username || "").trim();
		const password = String(body.password || "");

		if (!username || !password) {
			return new Response(
				JSON.stringify({ ok: false, error: "请输入账户和密码" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json; charset=utf-8" },
				},
			);
		}

		const result = verifyAdminLogin(username, password);
		if (!result.ok) {
			// 轻量防爆破延迟
			await new Promise((r) => setTimeout(r, 300));
			return new Response(JSON.stringify({ ok: false, error: result.error }), {
				status: 401,
				headers: { "Content-Type": "application/json; charset=utf-8" },
			});
		}

		const token = createAdminSessionToken(result.username);
		return new Response(
			JSON.stringify({
				ok: true,
				user: { username: result.username },
			}),
			{
				status: 200,
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Set-Cookie": buildSessionCookieHeader(token, request),
				},
			},
		);
	} catch (err) {
		return new Response(
			JSON.stringify({
				ok: false,
				error: err instanceof Error ? err.message : "登录失败",
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json; charset=utf-8" },
			},
		);
	}
};
