import type { APIRoute } from "astro";
import { buildSessionCookieHeader } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Set-Cookie": buildSessionCookieHeader("", request, 0),
		},
	});
};
