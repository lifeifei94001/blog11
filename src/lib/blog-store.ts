import { type CollectionEntry, getCollection } from "astro:content";
import {
	announcementConfig,
	backgroundWallpaper,
	profileConfig,
	siteConfig,
} from "@/config";
import {
	ensureTursoSchema,
	isTursoConfigured,
	tursoExecute,
	utcNowStr,
} from "./turso";

export interface SiteRuntimeSettings {
	siteTitle: string;
	siteSubtitle: string;
	siteDescription: string;
	navbarTitle: string;
	profileName: string;
	profileBio: string;
	profileAvatar: string;
	announcementTitle: string;
	announcementContent: string;
	bannerTitle: string;
	bannerSubtitles: string[];
}

export interface UnifiedPostData {
	title: string;
	published: Date;
	updated?: Date;
	draft: boolean;
	description: string;
	image: string;
	tags: string[];
	category: string | null;
	lang: string;
	pinned: boolean;
	author: string;
	sourceLink: string;
	licenseName: string;
	licenseUrl: string;
	comment: boolean;
	password: string;
	passwordHint: string;
	series: string;
	seriesOrder?: number;
	prevTitle: string;
	prevSlug: string;
	nextTitle: string;
	nextSlug: string;
}

export interface UnifiedPost {
	id: string;
	slug: string;
	source: "static" | "turso";
	staticEntry?: CollectionEntry<"posts">;
	body: string;
	filePath?: string;
	data: UnifiedPostData;
}

export interface UnifiedDynamic {
	id: string;
	source: "static" | "turso";
	staticEntry?: CollectionEntry<"dynamic">;
	body: string;
	data: {
		published: Date;
		pinned: boolean;
		location: string;
	};
}

export interface TursoPostInput {
	slug: string;
	title: string;
	description?: string;
	content: string;
	image?: string;
	category?: string;
	tags?: string[];
	series?: string;
	seriesOrder?: number | null;
	published?: string;
	updated?: string;
	draft?: boolean;
	pinned?: boolean;
	author?: string;
	password?: string;
	passwordHint?: string;
}

export interface TursoDynamicInput {
	id?: string;
	content: string;
	location?: string;
	pinned?: boolean;
	published?: string;
}

const SETTINGS_KEY = "runtime_settings";
let cachedSettings: { data: SiteRuntimeSettings; expiresAt: number } | null =
	null;

export function getDefaultRuntimeSettings(): SiteRuntimeSettings {
	const rawSubtitle = backgroundWallpaper.common?.homeText?.subtitle;
	const bannerSubtitles = Array.isArray(rawSubtitle)
		? rawSubtitle
		: rawSubtitle
			? [rawSubtitle]
			: [];
	return {
		siteTitle: siteConfig.title,
		siteSubtitle: siteConfig.subtitle,
		siteDescription: siteConfig.description || "",
		navbarTitle: siteConfig.navbar.title || siteConfig.title,
		profileName: profileConfig.name,
		profileBio: profileConfig.bio || "",
		profileAvatar: profileConfig.avatar || "",
		announcementTitle: announcementConfig.title || "",
		announcementContent: announcementConfig.content || "",
		bannerTitle:
			backgroundWallpaper.common?.homeText?.title || siteConfig.title,
		bannerSubtitles,
	};
}

export function invalidateSettingsCache(): void {
	cachedSettings = null;
}

export async function getEffectiveSettings(): Promise<SiteRuntimeSettings> {
	const defaults = getDefaultRuntimeSettings();
	if (!isTursoConfigured()) return defaults;

	const now = Date.now();
	if (cachedSettings && cachedSettings.expiresAt > now) {
		return cachedSettings.data;
	}

	try {
		await ensureTursoSchema();
		const res = await tursoExecute(
			"SELECT value_json FROM site_settings WHERE key = ? LIMIT 1",
			[SETTINGS_KEY],
		);
		if (res.rows.length > 0 && res.rows[0].value_json) {
			const parsed = JSON.parse(
				String(res.rows[0].value_json),
			) as Partial<SiteRuntimeSettings>;
			const merged: SiteRuntimeSettings = {
				...defaults,
				...Object.fromEntries(
					Object.entries(parsed).filter(([, v]) => v !== undefined),
				),
			};
			cachedSettings = { data: merged, expiresAt: now + 10_000 };
			return merged;
		}
	} catch (err) {
		console.warn(
			"[blog-store] 读取站点设置失败，降级使用默认配置:",
			err instanceof Error ? err.message : String(err),
		);
	}
	cachedSettings = { data: defaults, expiresAt: now + 10_000 };
	return defaults;
}

export async function saveEffectiveSettings(
	patch: Partial<SiteRuntimeSettings>,
): Promise<SiteRuntimeSettings> {
	if (!isTursoConfigured()) {
		throw new Error("云端数据库尚未在环境变量中配置，无法保存在线设置");
	}
	await ensureTursoSchema();
	const current = await getEffectiveSettings();
	const next: SiteRuntimeSettings = {
		...current,
		...patch,
		bannerSubtitles: Array.isArray(patch.bannerSubtitles)
			? patch.bannerSubtitles.map((s) => s.trim()).filter(Boolean)
			: current.bannerSubtitles,
	};
	await tursoExecute(
		`INSERT INTO site_settings (key, value_json, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
		[SETTINGS_KEY, JSON.stringify(next), utcNowStr()],
	);
	cachedSettings = { data: next, expiresAt: Date.now() + 10_000 };
	return next;
}

function normalizeSlug(raw: string): string {
	return raw
		.trim()
		.replace(/\.(md|mdx|markdown)$/i, "")
		.replace(/^\/+|\/+$/g, "");
}

function safeParseDate(raw: unknown, fallback = new Date()): Date {
	if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
	if (typeof raw === "string" && raw.trim()) {
		const d = new Date(raw.trim());
		if (!Number.isNaN(d.getTime())) return d;
	}
	return fallback;
}

function safeParseTags(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return raw.map((t) => String(t).trim()).filter(Boolean);
	}
	if (typeof raw === "string" && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return parsed.map((t) => String(t).trim()).filter(Boolean);
			}
		} catch {
			return raw
				.split(/[,，]/)
				.map((t) => t.trim())
				.filter(Boolean);
		}
	}
	return [];
}

function mapStaticPost(entry: CollectionEntry<"posts">): UnifiedPost {
	const slug = normalizeSlug(entry.id);
	return {
		id: slug,
		slug,
		source: "static",
		staticEntry: entry,
		body: entry.body || "",
		filePath: entry.filePath,
		data: {
			title: entry.data.title,
			published: entry.data.published,
			updated: entry.data.updated,
			draft: entry.data.draft ?? false,
			description: entry.data.description ?? "",
			image: entry.data.image ?? "",
			tags: entry.data.tags ?? [],
			category: entry.data.category ?? null,
			lang: entry.data.lang ?? "",
			pinned: entry.data.pinned ?? false,
			author: entry.data.author ?? "",
			sourceLink: entry.data.sourceLink ?? "",
			licenseName: entry.data.licenseName ?? "",
			licenseUrl: entry.data.licenseUrl ?? "",
			comment: entry.data.comment ?? true,
			password: entry.data.password ?? "",
			passwordHint: entry.data.passwordHint ?? "",
			series: entry.data.series ?? "",
			seriesOrder: entry.data.seriesOrder,
			prevTitle: "",
			prevSlug: "",
			nextTitle: "",
			nextSlug: "",
		},
	};
}

export async function getUnifiedPosts(
	includeDrafts = false,
): Promise<UnifiedPost[]> {
	const staticEntries = await getCollection("posts");
	const bySlug = new Map<string, UnifiedPost>();

	for (const entry of staticEntries) {
		const mapped = mapStaticPost(entry);
		bySlug.set(mapped.slug, mapped);
	}

	if (isTursoConfigured()) {
		try {
			await ensureTursoSchema();
			const res = await tursoExecute(
				`SELECT slug, title, description, content, image, category, tags_json, series, series_order,
				        published, updated, draft, pinned, author, password, password_hint, deleted
				 FROM blog_posts`,
			);
			for (const row of res.rows) {
				const slug = normalizeSlug(String(row.slug || ""));
				if (!slug) continue;
				if (Number(row.deleted ?? 0) === 1) {
					bySlug.delete(slug);
					continue;
				}
				const existingStatic = bySlug.get(slug)?.staticEntry;
				bySlug.set(slug, {
					id: slug,
					slug,
					source: "turso",
					// 若与静态文章同 slug 且正文完全一致则不额外覆写；管理员在线编辑后以 Turso 正文为准
					staticEntry:
						existingStatic && existingStatic.body === String(row.content || "")
							? existingStatic
							: undefined,
					body: String(row.content || ""),
					data: {
						title: String(row.title || slug),
						published: safeParseDate(row.published),
						updated: row.updated ? safeParseDate(row.updated) : undefined,
						draft: Number(row.draft ?? 0) === 1,
						description: String(row.description || ""),
						image: String(row.image || ""),
						tags: safeParseTags(row.tags_json),
						category: String(row.category || "").trim() || null,
						lang: "",
						pinned: Number(row.pinned ?? 0) === 1,
						author: String(row.author || ""),
						sourceLink: "",
						licenseName: "",
						licenseUrl: "",
						comment: true,
						password: String(row.password || ""),
						passwordHint: String(row.password_hint || ""),
						series: String(row.series || ""),
						seriesOrder:
							row.series_order !== null && row.series_order !== undefined
								? Number(row.series_order)
								: undefined,
						prevTitle: "",
						prevSlug: "",
						nextTitle: "",
						nextSlug: "",
					},
				});
			}
		} catch (err) {
			console.warn(
				"[blog-store] 读取云端文章失败，降级仅展示静态文章:",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	const filtered = Array.from(bySlug.values()).filter((p) =>
		includeDrafts ? true : !p.data.draft,
	);

	filtered.sort((a, b) => {
		if (a.data.pinned && !b.data.pinned) return -1;
		if (!a.data.pinned && b.data.pinned) return 1;
		return b.data.published.getTime() - a.data.published.getTime();
	});

	for (let i = 1; i < filtered.length; i++) {
		filtered[i].data.nextSlug = filtered[i - 1].slug;
		filtered[i].data.nextTitle = filtered[i - 1].data.title;
	}
	for (let i = 0; i < filtered.length - 1; i++) {
		filtered[i].data.prevSlug = filtered[i + 1].slug;
		filtered[i].data.prevTitle = filtered[i + 1].data.title;
	}

	return filtered;
}

export async function getUnifiedPostBySlug(
	rawSlug: string,
	includeDrafts = false,
): Promise<UnifiedPost | null> {
	const slug = normalizeSlug(rawSlug);
	const all = await getUnifiedPosts(includeDrafts);
	return all.find((p) => p.slug === slug) ?? null;
}

export async function upsertTursoPost(
	input: TursoPostInput,
): Promise<{ slug: string }> {
	if (!isTursoConfigured()) {
		throw new Error("云端数据库尚未在环境变量中配置，无法保存文章");
	}
	await ensureTursoSchema();
	const slug = normalizeSlug(input.slug || "");
	if (!slug) {
		throw new Error("文章 Slug 不能为空");
	}
	const now = utcNowStr();
	const published = (input.published || "").trim() || new Date().toISOString();
	const updated = (input.updated || "").trim() || new Date().toISOString();
	const tagsJson = JSON.stringify(
		(input.tags ?? []).map((t) => t.trim()).filter(Boolean),
	);

	await tursoExecute(
		`INSERT INTO blog_posts (
			slug, title, description, content, image, category, tags_json, series, series_order,
			published, updated, draft, pinned, author, password, password_hint, deleted, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
		ON CONFLICT(slug) DO UPDATE SET
			title = excluded.title,
			description = excluded.description,
			content = excluded.content,
			image = excluded.image,
			category = excluded.category,
			tags_json = excluded.tags_json,
			series = excluded.series,
			series_order = excluded.series_order,
			published = excluded.published,
			updated = excluded.updated,
			draft = excluded.draft,
			pinned = excluded.pinned,
			author = excluded.author,
			password = excluded.password,
			password_hint = excluded.password_hint,
			deleted = 0,
			updated_at = excluded.updated_at`,
		[
			slug,
			input.title.trim(),
			(input.description ?? "").trim(),
			input.content ?? "",
			(input.image ?? "").trim(),
			(input.category ?? "").trim(),
			tagsJson,
			(input.series ?? "").trim(),
			input.seriesOrder !== undefined && input.seriesOrder !== null
				? Number(input.seriesOrder)
				: null,
			published,
			updated,
			input.draft ? 1 : 0,
			input.pinned ? 1 : 0,
			(input.author ?? "").trim(),
			input.password ?? "",
			(input.passwordHint ?? "").trim(),
			now,
			now,
		],
	);
	return { slug };
}

export async function deleteTursoPost(rawSlug: string): Promise<void> {
	if (!isTursoConfigured()) {
		throw new Error("云端数据库尚未在环境变量中配置，无法删除文章");
	}
	await ensureTursoSchema();
	const slug = normalizeSlug(rawSlug);
	if (!slug) throw new Error("文章 Slug 不能为空");
	const now = utcNowStr();
	// 使用软删除标记以兼容隐藏内置静态文章
	await tursoExecute(
		`INSERT INTO blog_posts (slug, title, content, published, deleted, created_at, updated_at)
		 VALUES (?, ?, '', ?, 1, ?, ?)
		 ON CONFLICT(slug) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at`,
		[slug, slug, new Date().toISOString(), now, now],
	);
}

export async function getUnifiedDynamics(): Promise<UnifiedDynamic[]> {
	const staticDynamics = await getCollection("dynamic");
	const byId = new Map<string, UnifiedDynamic>();

	for (const entry of staticDynamics) {
		const id = normalizeSlug(entry.id);
		byId.set(id, {
			id,
			source: "static",
			staticEntry: entry,
			body: entry.body || "",
			data: {
				published: entry.data.published,
				pinned: entry.data.pinned ?? false,
				location: entry.data.location ?? "",
			},
		});
	}

	if (isTursoConfigured()) {
		try {
			await ensureTursoSchema();
			const res = await tursoExecute(
				"SELECT id, content, location, pinned, published, deleted FROM blog_dynamics",
			);
			for (const row of res.rows) {
				const id = normalizeSlug(String(row.id || ""));
				if (!id) continue;
				if (Number(row.deleted ?? 0) === 1) {
					byId.delete(id);
					continue;
				}
				byId.set(id, {
					id,
					source: "turso",
					body: String(row.content || ""),
					data: {
						published: safeParseDate(row.published),
						pinned: Number(row.pinned ?? 0) === 1,
						location: String(row.location || ""),
					},
				});
			}
		} catch (err) {
			console.warn(
				"[blog-store] 读取云端动态失败:",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	return Array.from(byId.values()).sort((a, b) => {
		if (a.data.pinned && !b.data.pinned) return -1;
		if (!a.data.pinned && b.data.pinned) return 1;
		return b.data.published.getTime() - a.data.published.getTime();
	});
}

export async function upsertTursoDynamic(
	input: TursoDynamicInput,
): Promise<{ id: string }> {
	if (!isTursoConfigured()) {
		throw new Error("云端数据库尚未在环境变量中配置，无法保存动态");
	}
	await ensureTursoSchema();
	const id =
		normalizeSlug(input.id || "") ||
		`d-${new Date()
			.toISOString()
			.replace(/[^0-9]/g, "")
			.slice(0, 14)}`;
	const now = utcNowStr();
	const published = (input.published || "").trim() || new Date().toISOString();

	await tursoExecute(
		`INSERT INTO blog_dynamics (id, content, location, pinned, published, deleted, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 0, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
			content = excluded.content,
			location = excluded.location,
			pinned = excluded.pinned,
			published = excluded.published,
			deleted = 0,
			updated_at = excluded.updated_at`,
		[
			id,
			input.content ?? "",
			(input.location ?? "").trim(),
			input.pinned ? 1 : 0,
			published,
			now,
			now,
		],
	);
	return { id };
}

export async function deleteTursoDynamic(rawId: string): Promise<void> {
	if (!isTursoConfigured()) {
		throw new Error("云端数据库尚未在环境变量中配置，无法删除动态");
	}
	await ensureTursoSchema();
	const id = normalizeSlug(rawId);
	if (!id) throw new Error("动态 ID 不能为空");
	const now = utcNowStr();
	await tursoExecute(
		`INSERT INTO blog_dynamics (id, content, published, deleted, created_at, updated_at)
		 VALUES (?, '', ?, 1, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at`,
		[id, new Date().toISOString(), now, now],
	);
}

export type UnifiedTag = { name: string; count: number };
export type UnifiedCategory = { name: string; count: number; url: string };
export type UnifiedSeries = {
	name: string;
	count: number;
	posts: UnifiedPost[];
};

function sortBySeriesOrder(a: UnifiedPost, b: UnifiedPost): number {
	const ao = a.data.seriesOrder;
	const bo = b.data.seriesOrder;
	if (ao !== undefined && bo !== undefined) {
		if (ao !== bo) return ao - bo;
	} else if (ao === undefined && bo !== undefined) {
		return 1;
	} else if (ao !== undefined && bo === undefined) {
		return -1;
	}
	return (
		b.data.published.getTime() - a.data.published.getTime() ||
		a.data.title.localeCompare(b.data.title)
	);
}

export async function getUnifiedTagList(): Promise<UnifiedTag[]> {
	const posts = await getUnifiedPosts(false);
	const countMap: Record<string, number> = {};
	for (const post of posts) {
		for (const tag of post.data.tags) {
			const clean = tag.trim();
			if (!clean) continue;
			countMap[clean] = (countMap[clean] || 0) + 1;
		}
	}
	return Object.keys(countMap)
		.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
		.map((name) => ({ name, count: countMap[name] }));
}

export async function getUnifiedCategoryList(
	uncategorizedLabel: string,
	categoryUrlBuilder: (cat: string | null) => string,
): Promise<UnifiedCategory[]> {
	const posts = await getUnifiedPosts(false);
	const count: Record<string, number> = {};
	for (const post of posts) {
		const raw = post.data.category?.trim();
		const key = raw || uncategorizedLabel;
		count[key] = (count[key] || 0) + 1;
	}
	return Object.keys(count)
		.sort(
			(a, b) =>
				count[b] - count[a] || a.toLowerCase().localeCompare(b.toLowerCase()),
		)
		.map((name) => ({
			name,
			count: count[name],
			url: categoryUrlBuilder(name === uncategorizedLabel ? null : name),
		}));
}

export async function getUnifiedSeriesList(): Promise<UnifiedSeries[]> {
	const allPosts = await getUnifiedPosts(false);
	const groupMap = new Map<string, UnifiedPost[]>();
	for (const post of allPosts) {
		const name = post.data.series.trim();
		if (!name) continue;
		if (!groupMap.has(name)) groupMap.set(name, []);
		groupMap.get(name)?.push(post);
	}
	const seriesList: UnifiedSeries[] = [];
	for (const [name, posts] of groupMap) {
		posts.sort(sortBySeriesOrder);
		seriesList.push({ name, count: posts.length, posts });
	}
	seriesList.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	return seriesList;
}

export async function getUnifiedSeriesPosts(currentPost: UnifiedPost): Promise<{
	seriesName: string;
	posts: UnifiedPost[];
	currentIndex: number;
} | null> {
	const seriesName = currentPost.data.series.trim();
	if (!seriesName) return null;
	const allPosts = await getUnifiedPosts(false);
	const posts = allPosts
		.filter((p) => p.data.series.trim() === seriesName)
		.sort(sortBySeriesOrder);
	const currentIndex = posts.findIndex((p) => p.slug === currentPost.slug);
	return { seriesName, posts, currentIndex };
}

export async function getUnifiedRelatedPosts(
	currentPost: UnifiedPost,
	maxCount = 5,
): Promise<UnifiedPost[]> {
	const allPosts = await getUnifiedPosts(false);
	const candidates = allPosts.filter(
		(p) => p.slug !== currentPost.slug && !p.data.password,
	);
	const currentTags = new Set(currentPost.data.tags || []);
	const currentCat = currentPost.data.category || "";
	const now = Date.now();

	const scored = candidates.map((post) => {
		const postTags = new Set(post.data.tags || []);
		let inter = 0;
		for (const t of currentTags) {
			if (postTags.has(t)) inter++;
		}
		const union = currentTags.size + postTags.size - inter;
		const tagScore = union > 0 ? (inter / union) * 100 : 0;
		const days = (now - post.data.published.getTime()) / (1000 * 60 * 60 * 24);
		const timeScore = 30 * Math.exp((-Math.LN2 * Math.max(0, days)) / 180);
		const catBonus = currentCat && post.data.category === currentCat ? 10 : 0;
		return {
			post,
			total: tagScore + timeScore + catBonus,
		};
	});

	scored.sort((a, b) => b.total - a.total);
	return scored.slice(0, maxCount).map((s) => s.post);
}
