import type { APIRoute } from "astro";
import { getAdminSession } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const session = getAdminSession(request);
	if (!session) {
		return new Response(JSON.stringify({ authenticated: false }), {
			status: 401,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
			},
		});
	}
	return new Response(
		JSON.stringify({
			authenticated: true,
			user: { username: session.username },
		}),
		{
			status: 200,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
			},
		},
	);
};
