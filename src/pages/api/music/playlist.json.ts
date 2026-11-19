import type { APIRoute } from "astro";
import { musicPlayerConfig } from "@/config/musicConfig";
import { getEffectiveSettings } from "@/lib/blog-store";

export const prerender = false;

export interface NormalizedTrack {
	name: string;
	artist: string;
	url: string;
	pic: string;
	lrc: string;
}

const DEFAULT_METING_APIS = [
	"https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
	"https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r",
	"https://api.qijieya.cn/meting/?server=:server&type=:type&id=:id",
];

const AUDIUS_ENDPOINTS = [
	"https://discoveryprovider.audius.co",
	"https://api.audius.co",
];

function getLocalFallback(): NormalizedTrack[] {
	return (musicPlayerConfig.local?.playlist || []).map((song) => ({
		name: song.name,
		artist: song.artist,
		url: song.url,
		pic: song.cover || "",
		lrc: song.lrc || "",
	}));
}

async function fetchMetingPlaylist(
	server: string,
	type: string,
	id: string,
): Promise<{ tracks: NormalizedTrack[]; apiUsed: string }> {
	const configuredApis = [
		musicPlayerConfig.meting?.api,
		...(musicPlayerConfig.meting?.fallbackApis || []),
		...DEFAULT_METING_APIS,
	].filter((u, idx, arr): u is string => Boolean(u) && arr.indexOf(u) === idx);

	for (const template of configuredApis) {
		try {
			const targetUrl = template
				.replace(":server", encodeURIComponent(server))
				.replace(":type", encodeURIComponent(type))
				.replace(":id", encodeURIComponent(id))
				.replace(":r", String(Math.random()));
			const res = await fetch(targetUrl, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(6500),
			});
			if (!res.ok) continue;
			const data = (await res.json()) as unknown;
			if (!Array.isArray(data) || data.length === 0) continue;

			const tracks: NormalizedTrack[] = data
				.map((raw) => {
					const item = raw as Record<string, unknown>;
					const url = String(item.url || "").trim();
					if (!url) return null;
					return {
						name: String(item.title || item.name || "Unknown Track"),
						artist: String(item.author || item.artist || "Unknown Artist"),
						url,
						pic: String(item.pic || item.cover || ""),
						lrc: String(item.lrc || ""),
					};
				})
				.filter((t): t is NormalizedTrack => t !== null);

			if (tracks.length > 0) {
				return { tracks, apiUsed: template };
			}
		} catch {
			// Try next mirror
		}
	}

	throw new Error(
		"第三方 Meting 音乐源暂时无响应，请稍后重试或切换节点/歌单 ID",
	);
}

async function fetchAudiusPlaylist(
	query: string,
	limit = 15,
): Promise<{ tracks: NormalizedTrack[]; apiUsed: string }> {
	const trimmedQuery = query.trim();
	const path = trimmedQuery
		? `/v1/tracks/search?query=${encodeURIComponent(trimmedQuery)}&app_name=kukudcl&limit=${limit}`
		: `/v1/tracks/trending?app_name=kukudcl&limit=${limit}`;

	for (const host of AUDIUS_ENDPOINTS) {
		try {
			const res = await fetch(`${host}${path}`, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(7000),
			});
			if (!res.ok) continue;
			const json = (await res.json()) as {
				data?: Array<{
					id?: string;
					title?: string;
					is_streamable?: boolean;
					is_stream_gated?: boolean;
					user?: { name?: string };
					artwork?: { "480x480"?: string; "150x150"?: string };
					stream?: { url?: string };
				}>;
			};
			const rows = Array.isArray(json?.data) ? json.data : [];
			const tracks: NormalizedTrack[] = rows
				.filter((t) => t.id && t.is_streamable !== false && !t.is_stream_gated)
				.map((t) => ({
					name: String(t.title || "Untitled"),
					artist: String(t.user?.name || "Audius Artist"),
					url:
						t.stream?.url ||
						`${host}/v1/tracks/${encodeURIComponent(String(t.id))}/stream?app_name=kukudcl`,
					pic: t.artwork?.["480x480"] || t.artwork?.["150x150"] || "",
					lrc: "",
				}));

			if (tracks.length > 0) {
				return { tracks, apiUsed: host };
			}
		} catch {
			// Try next Audius endpoint
		}
	}

	throw new Error("Audius 公共音乐接口暂时无响应");
}

export const GET: APIRoute = async ({ url }) => {
	const isTest = url.searchParams.get("test") === "1";
	const settings = await getEffectiveSettings();

	const mode = (
		url.searchParams.get("source") ||
		settings.musicMode ||
		musicPlayerConfig.mode ||
		"meting"
	).toLowerCase();
	const server =
		url.searchParams.get("server") ||
		settings.musicServer ||
		musicPlayerConfig.meting?.server ||
		"netease";
	const type =
		url.searchParams.get("type") ||
		settings.musicType ||
		musicPlayerConfig.meting?.type ||
		"playlist";
	const id =
		url.searchParams.get("id") ??
		settings.musicId ??
		musicPlayerConfig.meting?.id ??
		"10046455237";
	const query =
		url.searchParams.get("query") ?? settings.musicAudiusQuery ?? "";

	try {
		if (mode === "local") {
			return new Response(
				JSON.stringify({
					ok: true,
					source: "local",
					tracks: getLocalFallback(),
				}),
				{
					headers: {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
					},
				},
			);
		}

		if (mode === "custom") {
			const custom = (settings.musicCustomPlaylist || []).map((song) => ({
				name: song.name,
				artist: song.artist,
				url: song.url,
				pic: song.cover || "",
				lrc: song.lrc || "",
			}));
			return new Response(
				JSON.stringify({
					ok: true,
					source: "custom",
					tracks: custom.length > 0 ? custom : getLocalFallback(),
				}),
				{
					headers: {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
					},
				},
			);
		}

		if (mode === "audius") {
			const { tracks, apiUsed } = await fetchAudiusPlaylist(query);
			return new Response(
				JSON.stringify({
					ok: true,
					source: "audius",
					apiUsed,
					tracks,
				}),
				{
					headers: {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": isTest ? "no-store" : "public, max-age=180",
					},
				},
			);
		}

		const { tracks, apiUsed } = await fetchMetingPlaylist(server, type, id);
		return new Response(
			JSON.stringify({
				ok: true,
				source: "meting",
				apiUsed,
				tracks,
			}),
			{
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": isTest ? "no-store" : "public, max-age=180",
				},
			},
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "获取歌单失败";
		if (isTest) {
			return new Response(
				JSON.stringify({
					ok: false,
					source: mode,
					error: message,
					tracks: [],
				}),
				{
					status: 502,
					headers: {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
					},
				},
			);
		}
		// 非测试模式：自动降级到本地兜底音乐，确保前台播放器不会报红报错
		return new Response(
			JSON.stringify({
				ok: true,
				fallback: true,
				source: "local",
				error: message,
				tracks: getLocalFallback(),
			}),
			{
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store",
				},
			},
		);
	}
};
