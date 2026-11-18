import type { APIRoute } from "astro";
import { fetchB2ObjectResponse, isB2Configured } from "@/lib/b2-storage";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const rawKey = url.searchParams.get("key") || "";
	const cleanKey = rawKey.replace(/^\/+/, "");
	if (!cleanKey || cleanKey.includes("..")) {
		return new Response("Bad Request", { status: 400 });
	}
	if (!isB2Configured()) {
		return new Response("Object storage not configured", { status: 503 });
	}
	try {
		return await fetchB2ObjectResponse(cleanKey);
	} catch (err) {
		console.error("[media proxy] error:", err);
		return new Response("Failed to fetch media", { status: 502 });
	}
};
