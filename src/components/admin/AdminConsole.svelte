<script lang="ts">
import { Marked } from "marked";
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";

type AdminTab = "posts" | "dynamics" | "media" | "settings";
type EditorView = "split" | "edit" | "preview";

interface PostItem {
	slug: string;
	source: "static" | "turso";
	title: string;
	description: string;
	content: string;
	image: string;
	category: string;
	tags: string[];
	series: string;
	seriesOrder: number | null;
	published: string;
	updated: string;
	draft: boolean;
	pinned: boolean;
	author: string;
	password: string;
	passwordHint: string;
}

interface DynamicItem {
	id: string;
	source: "static" | "turso";
	content: string;
	location: string;
	pinned: boolean;
	published: string;
}

interface MediaItem {
	fileId: string;
	fileName: string;
	contentLength: number;
	contentType: string;
	uploadTimestamp: number;
	url: string;
}

interface SiteSettings {
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

const SESSION_CACHE_KEY = "dcl_admin_user_snapshot";
const TAB_STORAGE_KEY = "dcl_admin_active_tab";
const DRAFT_BACKUP_KEY = "dcl_admin_post_draft_backup";

const previewMarked = new Marked({ gfm: true, breaks: true });

let checkingAuth = $state(true);
let authenticated = $state(false);
let currentUser = $state("");

// Login state
let loginUsername = $state("admin");
let loginPassword = $state("");
let loginLoading = $state(false);
let loginError = $state("");

// Navigation & UI state
let activeTab = $state<AdminTab>("posts");
let editorView = $state<EditorView>("split");
let toast = $state<{ id: number; type: "ok" | "err"; text: string } | null>(
	null,
);
let commandOpen = $state(false);

// Posts state
let posts = $state<PostItem[]>([]);
let postsLoading = $state(false);
let postSearch = $state("");
let postFilter = $state<"all" | "published" | "draft">("all");
let selectedSlug = $state<string | null>(null);
let postSaving = $state(false);
let isNewPost = $state(false);

let formSlug = $state("");
let formTitle = $state("");
let formDescription = $state("");
let formContent = $state("");
let formImage = $state("");
let formCategory = $state("");
let formTagsText = $state("");
let formSeries = $state("");
let formSeriesOrder = $state("");
let formPublished = $state("");
let formDraft = $state(false);
let formPinned = $state(false);
let formAuthor = $state("酷酷dcl");
let formPassword = $state("");
let formPasswordHint = $state("");

// Dynamics state
let dynamics = $state<DynamicItem[]>([]);
let dynamicsLoading = $state(false);
let dynSaving = $state(false);
let dynEditId = $state<string | null>(null);
let dynContent = $state("");
let dynLocation = $state("");
let dynPinned = $state(false);

// Media (Backblaze B2) state
let mediaFiles = $state<MediaItem[]>([]);
let mediaLoading = $state(false);
let mediaConfigured = $state(true);
let mediaSearch = $state("");
let uploading = $state(false);
let dragOver = $state(false);
let uploadFolder = $state("uploads");
let showMediaPicker = $state<
	null | "post-cover" | "post-body" | "dynamic-body" | "avatar"
>(null);

// Settings state
let settingsLoading = $state(false);
let settingsSaving = $state(false);
let storageReady = $state(true);
let settingsForm = $state<SiteSettings>({
	siteTitle: "酷酷dcl",
	siteSubtitle: "",
	siteDescription: "",
	navbarTitle: "酷酷dcl",
	profileName: "酷酷dcl",
	profileBio: "",
	profileAvatar: "",
	announcementTitle: "",
	announcementContent: "",
	bannerTitle: "酷酷dcl",
	bannerSubtitles: [],
});
let bannerSubtitlesText = $state("");

let filteredPosts = $derived.by(() => {
	const q = postSearch.trim().toLowerCase();
	return posts.filter((p) => {
		if (postFilter === "published" && p.draft) return false;
		if (postFilter === "draft" && !p.draft) return false;
		if (!q) return true;
		return (
			p.title.toLowerCase().includes(q) ||
			p.slug.toLowerCase().includes(q) ||
			p.category.toLowerCase().includes(q) ||
			p.tags.some((t) => t.toLowerCase().includes(q))
		);
	});
});

let filteredMedia = $derived.by(() => {
	const q = mediaSearch.trim().toLowerCase();
	if (!q) return mediaFiles;
	return mediaFiles.filter((m) => m.fileName.toLowerCase().includes(q));
});

function sanitizePreviewHtml(raw: string): string {
	return raw
		.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
		.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
		.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/javascript:/gi, "");
}

let previewHtml = $derived.by(() => {
	try {
		const raw = previewMarked.parse(
			formContent || "*在左侧开始输入 Markdown 正文…*",
		) as string;
		return sanitizePreviewHtml(raw);
	} catch {
		return "";
	}
});

let publishedCount = $derived(posts.filter((p) => !p.draft).length);
let draftCount = $derived(posts.filter((p) => p.draft).length);
let totalMediaBytes = $derived(
	mediaFiles.reduce((sum, item) => sum + (item.contentLength || 0), 0),
);

function notify(type: "ok" | "err", text: string) {
	const id = Date.now();
	toast = { id, type, text };
	setTimeout(() => {
		if (toast?.id === id) toast = null;
	}, 3600);
}

function setTab(tab: AdminTab) {
	activeTab = tab;
	if (typeof window !== "undefined") {
		localStorage.setItem(TAB_STORAGE_KEY, tab);
		window.history.replaceState(null, "", `#tab=${tab}`);
	}
}

function readInitialTab(): AdminTab {
	if (typeof window === "undefined") return "posts";
	const hashMatch = window.location.hash.match(
		/tab=(posts|dynamics|media|settings)/,
	);
	if (hashMatch) return hashMatch[1] as AdminTab;
	const saved = localStorage.getItem(TAB_STORAGE_KEY);
	if (
		saved === "posts" ||
		saved === "dynamics" ||
		saved === "media" ||
		saved === "settings"
	) {
		return saved;
	}
	return "posts";
}

function formatBytes(bytes: number): string {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let idx = 0;
	let v = bytes;
	while (v >= 1024 && idx < units.length - 1) {
		v /= 1024;
		idx++;
	}
	return `${v >= 10 || idx === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[idx]}`;
}

function formatDateInput(iso: string): string {
	if (!iso) return new Date().toISOString().slice(0, 16);
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 16);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isImageContentType(type: string, name: string): boolean {
	if (type?.startsWith("image/")) return true;
	return /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(name);
}

function slugifyTitle(title: string): string {
	const ascii = title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, "")
		.replace(/\s+/g, "-");
	if (/^[a-z0-9-]+$/.test(ascii) && ascii.length > 0) {
		return ascii;
	}
	return `post-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
}

async function handleApiResponse<T>(resp: Response): Promise<T> {
	if (resp.status === 401) {
		authenticated = false;
		currentUser = "";
		localStorage.removeItem(SESSION_CACHE_KEY);
		throw new Error("登录已过期，请重新登录");
	}
	const data = (await resp.json().catch(() => ({}))) as T & {
		ok?: boolean;
		error?: string;
	};
	if (!resp.ok || data.ok === false) {
		throw new Error(data.error || `请求失败 (${resp.status})`);
	}
	return data;
}

async function loadAllData() {
	await Promise.all([loadPosts(), loadDynamics(), loadMedia(), loadSettings()]);
}

async function loadPosts() {
	postsLoading = true;
	try {
		const resp = await fetch("/api/admin/posts/");
		const data = await handleApiResponse<{ items: PostItem[] }>(resp);
		posts = data.items;
		if (!selectedSlug && !isNewPost && posts.length > 0) {
			selectPost(posts[0]);
		}
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "加载文章失败");
	} finally {
		postsLoading = false;
	}
}

async function loadDynamics() {
	dynamicsLoading = true;
	try {
		const resp = await fetch("/api/admin/dynamics/");
		const data = await handleApiResponse<{ items: DynamicItem[] }>(resp);
		dynamics = data.items;
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "加载动态失败");
	} finally {
		dynamicsLoading = false;
	}
}

async function loadMedia() {
	mediaLoading = true;
	try {
		const resp = await fetch("/api/admin/media/");
		const data = await handleApiResponse<{
			configured: boolean;
			files: MediaItem[];
		}>(resp);
		mediaConfigured = data.configured;
		mediaFiles = data.files;
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "加载对象存储列表失败");
	} finally {
		mediaLoading = false;
	}
}

async function loadSettings() {
	settingsLoading = true;
	try {
		const resp = await fetch("/api/admin/settings/");
		const data = await handleApiResponse<{
			settings: SiteSettings;
			storageReady: boolean;
		}>(resp);
		settingsForm = data.settings;
		storageReady = data.storageReady;
		bannerSubtitlesText = (data.settings.bannerSubtitles || []).join("\n");
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "加载站点设置失败");
	} finally {
		settingsLoading = false;
	}
}

function selectPost(p: PostItem) {
	isNewPost = false;
	selectedSlug = p.slug;
	formSlug = p.slug;
	formTitle = p.title;
	formDescription = p.description;
	formContent = p.content;
	formImage = p.image;
	formCategory = p.category;
	formTagsText = p.tags.join(", ");
	formSeries = p.series;
	formSeriesOrder =
		p.seriesOrder !== null && p.seriesOrder !== undefined
			? String(p.seriesOrder)
			: "";
	formPublished = formatDateInput(p.published);
	formDraft = p.draft;
	formPinned = p.pinned;
	formAuthor = p.author || settingsForm.profileName || "酷酷dcl";
	formPassword = p.password;
	formPasswordHint = p.passwordHint;
}

function startNewPost() {
	isNewPost = true;
	selectedSlug = null;
	formSlug = "";
	formTitle = "";
	formDescription = "";
	formContent = "## 写作大纲\n\n在这里开始记录你的想法……\n";
	formImage = "";
	formCategory = "";
	formTagsText = "";
	formSeries = "";
	formSeriesOrder = "";
	formPublished = formatDateInput(new Date().toISOString());
	formDraft = false;
	formPinned = false;
	formAuthor = settingsForm.profileName || "酷酷dcl";
	formPassword = "";
	formPasswordHint = "";
}

async function handleSavePost(e: Event) {
	e.preventDefault();
	if (!formTitle.trim()) {
		notify("err", "请填写文章标题");
		return;
	}
	const finalSlug = (formSlug.trim() || slugifyTitle(formTitle)).replace(
		/^\/+|\/+$/g,
		"",
	);
	formSlug = finalSlug;

	postSaving = true;
	try {
		const tags = formTagsText
			.split(/[,，]/)
			.map((s) => s.trim())
			.filter(Boolean);
		const publishedIso = formPublished
			? new Date(formPublished).toISOString()
			: new Date().toISOString();

		const resp = await fetch("/api/admin/posts/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slug: finalSlug,
				title: formTitle.trim(),
				description: formDescription.trim(),
				content: formContent,
				image: formImage.trim(),
				category: formCategory.trim(),
				tags,
				series: formSeries.trim(),
				seriesOrder: formSeriesOrder.trim() ? Number(formSeriesOrder) : null,
				published: publishedIso,
				updated: new Date().toISOString(),
				draft: formDraft,
				pinned: formPinned,
				author: formAuthor.trim(),
				password: formPassword,
				passwordHint: formPasswordHint.trim(),
			}),
		});
		await handleApiResponse(resp);
		localStorage.removeItem(DRAFT_BACKUP_KEY);
		isNewPost = false;
		selectedSlug = finalSlug;
		notify("ok", "文章已保存并实时生效");
		await loadPosts();
		const updated = posts.find((p) => p.slug === finalSlug);
		if (updated) selectPost(updated);
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "保存失败");
	} finally {
		postSaving = false;
	}
}

async function handleDeletePost(slug: string) {
	if (!confirm(`确定删除文章「${slug}」吗？删除后前台将不再展示。`)) return;
	try {
		const resp = await fetch("/api/admin/posts/", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug }),
		});
		await handleApiResponse(resp);
		notify("ok", "文章已删除");
		if (selectedSlug === slug) {
			selectedSlug = null;
			startNewPost();
		}
		await loadPosts();
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "删除失败");
	}
}

async function handleSaveDynamic(e: Event) {
	e.preventDefault();
	if (!dynContent.trim()) {
		notify("err", "请输入动态内容");
		return;
	}
	dynSaving = true;
	try {
		const resp = await fetch("/api/admin/dynamics/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				id: dynEditId || undefined,
				content: dynContent,
				location: dynLocation.trim(),
				pinned: dynPinned,
			}),
		});
		await handleApiResponse(resp);
		dynEditId = null;
		dynContent = "";
		dynLocation = "";
		dynPinned = false;
		notify("ok", "动态已发布");
		await loadDynamics();
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "发布动态失败");
	} finally {
		dynSaving = false;
	}
}

function editDynamic(item: DynamicItem) {
	dynEditId = item.id;
	dynContent = item.content;
	dynLocation = item.location;
	dynPinned = item.pinned;
}

async function handleDeleteDynamic(id: string) {
	if (!confirm("确定删除这条动态吗？")) return;
	try {
		const resp = await fetch("/api/admin/dynamics/", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id }),
		});
		await handleApiResponse(resp);
		notify("ok", "动态已删除");
		await loadDynamics();
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "删除动态失败");
	}
}

async function uploadFiles(fileList: FileList | File[]) {
	const files = Array.from(fileList);
	if (files.length === 0) return;

	uploading = true;
	let okCount = 0;
	try {
		for (const file of files) {
			const fd = new FormData();
			fd.append("file", file);
			fd.append("folder", uploadFolder.trim() || "uploads");
			const resp = await fetch("/api/admin/media/", {
				method: "POST",
				body: fd,
			});
			await handleApiResponse<{ file: MediaItem }>(resp);
			okCount++;
		}
		notify("ok", `成功上传 ${okCount} 个文件到 Backblaze B2`);
		await loadMedia();
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "上传失败");
	} finally {
		uploading = false;
	}
}

function handleDrop(e: DragEvent) {
	e.preventDefault();
	dragOver = false;
	if (e.dataTransfer?.files?.length) {
		uploadFiles(e.dataTransfer.files);
	}
}

async function handleDeleteMedia(item: MediaItem) {
	if (!confirm(`确定从 Backblaze B2 永久删除「${item.fileName}」吗？`)) return;
	try {
		const resp = await fetch("/api/admin/media/", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fileName: item.fileName, fileId: item.fileId }),
		});
		await handleApiResponse(resp);
		notify("ok", "文件已删除");
		await loadMedia();
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "删除文件失败");
	}
}

async function copyText(text: string, label: string) {
	try {
		await navigator.clipboard.writeText(text);
		notify("ok", `已复制${label}`);
	} catch {
		notify("err", "复制失败，请手动复制");
	}
}

function applyPickedMedia(item: MediaItem) {
	if (showMediaPicker === "post-cover") {
		formImage = item.url;
	} else if (showMediaPicker === "post-body") {
		const snippet = isImageContentType(item.contentType, item.fileName)
			? `\n![${item.fileName.split("/").pop() || "image"}](${item.url})\n`
			: `\n[${item.fileName.split("/").pop() || "file"}](${item.url})\n`;
		formContent += snippet;
	} else if (showMediaPicker === "dynamic-body") {
		dynContent += `\n![image](${item.url})`;
	} else if (showMediaPicker === "avatar") {
		settingsForm.profileAvatar = item.url;
	}
	showMediaPicker = null;
	notify("ok", "已填入所选资源链接");
}

async function handleSaveSettings(e: Event) {
	e.preventDefault();
	settingsSaving = true;
	try {
		const subtitles = bannerSubtitlesText
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		const resp = await fetch("/api/admin/settings/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...settingsForm,
				bannerSubtitles: subtitles,
			}),
		});
		const data = await handleApiResponse<{ settings: SiteSettings }>(resp);
		settingsForm = data.settings;
		notify("ok", "站点设置已保存");
	} catch (err) {
		notify("err", err instanceof Error ? err.message : "保存设置失败");
	} finally {
		settingsSaving = false;
	}
}

async function handleLogin(e: Event) {
	e.preventDefault();
	loginError = "";
	loginLoading = true;
	try {
		const resp = await fetch("/api/auth/login/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: loginUsername.trim(),
				password: loginPassword,
			}),
		});
		const data = (await resp.json()) as {
			ok?: boolean;
			error?: string;
			user?: { username: string };
		};
		if (!resp.ok || !data.ok) {
			loginError = data.error || "登录失败";
			return;
		}
		authenticated = true;
		currentUser = data.user?.username || loginUsername.trim();
		localStorage.setItem(SESSION_CACHE_KEY, currentUser);
		loginPassword = "";
		await loadAllData();
	} catch {
		loginError = "网络异常，请稍后重试";
	} finally {
		loginLoading = false;
	}
}

async function handleLogout() {
	await fetch("/api/auth/logout/", { method: "POST" }).catch(() => {});
	localStorage.removeItem(SESSION_CACHE_KEY);
	authenticated = false;
	currentUser = "";
	notify("ok", "已安全退出后台");
}

onMount(() => {
	activeTab = readInitialTab();

	// 零闪烁恢复登录快照，随后静默校验会话
	const cachedUser = localStorage.getItem(SESSION_CACHE_KEY);
	if (cachedUser) {
		authenticated = true;
		currentUser = cachedUser;
	}

	(async () => {
		try {
			const resp = await fetch("/api/auth/me/");
			if (resp.ok) {
				const data = (await resp.json()) as {
					authenticated: boolean;
					user?: { username: string };
				};
				if (data.authenticated) {
					authenticated = true;
					currentUser = data.user?.username || "admin";
					localStorage.setItem(SESSION_CACHE_KEY, currentUser);
					await loadAllData();
				}
			} else if (resp.status === 401) {
				authenticated = false;
				currentUser = "";
				localStorage.removeItem(SESSION_CACHE_KEY);
			}
		} catch {
			// 网络波动保留快照
		} finally {
			checkingAuth = false;
		}
	})();

	const onKeyDown = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			if (authenticated) commandOpen = !commandOpen;
		} else if (e.key === "Escape") {
			commandOpen = false;
			showMediaPicker = null;
		}
	};
	window.addEventListener("keydown", onKeyDown);
	return () => window.removeEventListener("keydown", onKeyDown);
});

// 编辑器未保存快照自动暂存，防止刷新丢失
$effect(() => {
	if (authenticated && isNewPost && (formTitle || formContent)) {
		localStorage.setItem(
			DRAFT_BACKUP_KEY,
			JSON.stringify({
				title: formTitle,
				slug: formSlug,
				content: formContent,
				description: formDescription,
			}),
		);
	}
});
</script>

<div class="admin-root space-y-4">
	{#if toast}
		<div
			role="status"
			class="fixed bottom-6 right-6 z-[1200] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-md transition-all text-sm font-medium
				{toast.type === 'ok'
					? 'bg-emerald-500/90 text-white border-emerald-400/40'
					: 'bg-rose-500/90 text-white border-rose-400/40'}"
		>
			<Icon
				icon={toast.type === "ok"
					? "material-symbols:check-circle-outline-rounded"
					: "material-symbols:error-outline"}
				class="text-lg shrink-0"
			/>
			<span>{toast.text}</span>
		</div>
	{/if}

	{#if checkingAuth && !authenticated}
		<div class="card-base p-12 flex flex-col items-center justify-center gap-3 text-75">
			<div class="w-8 h-8 rounded-full border-2 border-(--primary) border-t-transparent animate-spin"></div>
			<p class="text-sm">正在验证管理会话…</p>
		</div>
	{:else if !authenticated}
		<!-- 登录卡片 -->
		<div class="max-w-md mx-auto my-6 card-base p-7 md:p-9 relative overflow-hidden">
			<div class="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-(--primary)/15 blur-2xl pointer-events-none"></div>
			<div class="relative z-10">
				<div class="flex items-center gap-3 mb-6">
					<div class="w-11 h-11 rounded-xl bg-(--primary)/15 text-(--primary) flex items-center justify-center">
						<Icon icon="material-symbols:admin-panel-settings-outline" class="text-2xl" />
					</div>
					<div>
						<h1 class="text-xl font-bold text-90">酷酷dcl · 后台管理</h1>
						<p class="text-xs text-50 mt-0.5">请输入管理员账户与密码进入控制台</p>
					</div>
				</div>

				<form class="space-y-4" onsubmit={handleLogin}>
					<div>
						<label class="block text-xs font-medium text-75 mb-1.5" for="admin-username">账户</label>
						<input
							id="admin-username"
							type="text"
							autocomplete="username"
							required
							bind:value={loginUsername}
							placeholder="admin"
							class="admin-input w-full"
						/>
					</div>

					<div>
						<label class="block text-xs font-medium text-75 mb-1.5" for="admin-password">密码</label>
						<input
							id="admin-password"
							type="password"
							autocomplete="current-password"
							required
							bind:value={loginPassword}
							placeholder="请输入管理密码"
							class="admin-input w-full"
						/>
					</div>

					{#if loginError}
						<div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs leading-relaxed">
							{loginError}
						</div>
					{/if}

					<button
						type="submit"
						disabled={loginLoading}
						class="w-full py-2.5 px-4 rounded-xl bg-(--primary) text-white dark:text-black/80 font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition cursor-pointer disabled:opacity-50"
					>
						<Icon icon="material-symbols:login-rounded" class="text-lg" />
						<span>{loginLoading ? "登录验证中…" : "登录后台"}</span>
					</button>
				</form>
			</div>
		</div>
	{:else}
		<!-- 顶部 Bento 控制台状态栏（绝不展示任何数据库信息） -->
		<header class="card-base p-5 md:p-6">
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div class="flex items-center gap-3.5">
					<div class="w-11 h-11 rounded-xl bg-(--primary)/15 text-(--primary) flex items-center justify-center shrink-0">
						<Icon icon="material-symbols:admin-panel-settings" class="text-2xl" />
					</div>
					<div>
						<div class="flex items-center gap-2 flex-wrap">
							<h1 class="text-xl font-bold text-90">酷酷dcl 控制台</h1>
							<span class="px-2 py-0.5 text-[11px] font-medium rounded-full bg-(--primary)/15 text-(--primary)">
								{currentUser}
							</span>
						</div>
						<p class="text-xs text-50 mt-0.5">内容发布 · Backblaze B2 图床 · 站点设置（按 Ctrl/⌘ + K 快速切换）</p>
					</div>
				</div>

				<div class="flex items-center gap-2 flex-wrap">
					<a
						href="/"
						class="btn-regular rounded-xl px-3 py-2 text-xs font-medium gap-1.5"
					>
						<Icon icon="material-symbols:home-outline-rounded" class="text-base" />
						<span>返回博客</span>
					</a>
					<button
						type="button"
						onclick={() => (commandOpen = true)}
						class="btn-regular rounded-xl px-3 py-2 text-xs font-medium gap-1.5 cursor-pointer"
					>
						<Icon icon="material-symbols:search-rounded" class="text-base" />
						<span>⌘K</span>
					</button>
					<button
						type="button"
						onclick={handleLogout}
						class="btn-regular rounded-xl px-3 py-2 text-xs font-medium gap-1.5 text-rose-500 cursor-pointer"
					>
						<Icon icon="material-symbols:logout-rounded" class="text-base" />
						<span>退出</span>
					</button>
				</div>
			</div>

			<!-- Bento 指标卡 -->
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
				<button
					type="button"
					onclick={() => setTab("posts")}
					class="bento-stat text-left {activeTab === 'posts' ? 'bento-stat-active' : ''}"
				>
					<span class="text-xs text-50">文章总数</span>
					<strong class="text-xl font-bold text-90 tabular-nums mt-1 block">{posts.length}</strong>
					<span class="text-[11px] text-50 tabular-nums">已发布 {publishedCount} · 草稿 {draftCount}</span>
				</button>
				<button
					type="button"
					onclick={() => setTab("dynamics")}
					class="bento-stat text-left {activeTab === 'dynamics' ? 'bento-stat-active' : ''}"
				>
					<span class="text-xs text-50">动态碎碎念</span>
					<strong class="text-xl font-bold text-90 tabular-nums mt-1 block">{dynamics.length}</strong>
					<span class="text-[11px] text-50">即时时间线记录</span>
				</button>
				<button
					type="button"
					onclick={() => setTab("media")}
					class="bento-stat text-left {activeTab === 'media' ? 'bento-stat-active' : ''}"
				>
					<span class="text-xs text-50">B2 对象存储</span>
					<strong class="text-xl font-bold text-90 tabular-nums mt-1 block">{mediaFiles.length}</strong>
					<span class="text-[11px] text-50 tabular-nums">已用 {formatBytes(totalMediaBytes)}</span>
				</button>
				<button
					type="button"
					onclick={() => setTab("settings")}
					class="bento-stat text-left {activeTab === 'settings' ? 'bento-stat-active' : ''}"
				>
					<span class="text-xs text-50">站点外观与资料</span>
					<strong class="text-base font-bold text-90 truncate mt-1 block">{settingsForm.siteTitle}</strong>
					<span class="text-[11px] text-50">{storageReady ? "对象存储已就绪" : "待配置对象存储"}</span>
				</button>
			</div>

			<!-- Tab 切换栏 -->
			<nav class="flex gap-1.5 mt-4 pt-3 border-t border-black/5 dark:border-white/10 overflow-x-auto" aria-label="后台管理功能导航">
				<button type="button" onclick={() => setTab("posts")} class="admin-tab {activeTab === 'posts' ? 'admin-tab-active' : ''}">
					<Icon icon="material-symbols:edit-square-outline" class="text-base" />
					<span>文章管理</span>
				</button>
				<button type="button" onclick={() => setTab("dynamics")} class="admin-tab {activeTab === 'dynamics' ? 'admin-tab-active' : ''}">
					<Icon icon="material-symbols:forum-rounded" class="text-base" />
					<span>动态管理</span>
				</button>
				<button type="button" onclick={() => setTab("media")} class="admin-tab {activeTab === 'media' ? 'admin-tab-active' : ''}">
					<Icon icon="material-symbols:photo-library-outline" class="text-base" />
					<span>B2 图床文件</span>
				</button>
				<button type="button" onclick={() => setTab("settings")} class="admin-tab {activeTab === 'settings' ? 'admin-tab-active' : ''}">
					<Icon icon="material-symbols:settings-outline-rounded" class="text-base" />
					<span>站点设置</span>
				</button>
			</nav>
		</header>

		<!-- Tab 1: 文章管理 -->
		{#if activeTab === "posts"}
			<div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
				<aside class="lg:col-span-4 card-base p-4 space-y-3">
					<div class="flex items-center justify-between gap-2">
						<h2 class="font-bold text-90 text-sm">文章列表 ({filteredPosts.length})</h2>
						<button
							type="button"
							onclick={startNewPost}
							class="px-3 py-1.5 rounded-lg bg-(--primary) text-white dark:text-black/80 text-xs font-semibold flex items-center gap-1 hover:opacity-90 active:scale-95 transition cursor-pointer"
						>
							<Icon icon="material-symbols:add-rounded" class="text-base" />
							<span>新建文章</span>
						</button>
					</div>

					<input
						type="search"
						placeholder="搜索标题 / Slug / 标签…"
						bind:value={postSearch}
						class="admin-input w-full text-xs"
					/>

					<div class="flex gap-1.5 text-xs">
						{#each [["all", "全部"], ["published", "已发布"], ["draft", "草稿"]] as [k, label]}
							<button
								type="button"
								onclick={() => (postFilter = k as "all" | "published" | "draft")}
								class="flex-1 py-1.5 rounded-lg transition cursor-pointer {postFilter === k ? 'bg-(--primary)/15 text-(--primary) font-semibold' : 'text-50 hover:bg-black/5 dark:hover:bg-white/5'}"
							>
								{label}
							</button>
						{/each}
					</div>

					<div class="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
						{#if postsLoading}
							<p class="text-xs text-50 py-6 text-center">加载文章中…</p>
						{:else if filteredPosts.length === 0}
							<p class="text-xs text-50 py-6 text-center">暂无匹配文章</p>
						{:else}
							{#each filteredPosts as item (item.slug)}
								<div
									class="p-2.5 rounded-xl border transition cursor-pointer group {selectedSlug === item.slug && !isNewPost
										? 'border-(--primary)/60 bg-(--primary)/8'
										: 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'}"
									onclick={() => selectPost(item)}
									role="button"
									tabindex="0"
									onkeydown={(e) => e.key === "Enter" && selectPost(item)}
								>
									<div class="flex items-start justify-between gap-2">
										<p class="text-sm font-semibold text-90 line-clamp-1">{item.title}</p>
										<div class="flex items-center gap-1 shrink-0">
											{#if item.pinned}
												<span class="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-500">置顶</span>
											{/if}
											{#if item.draft}
												<span class="px-1.5 py-0.5 text-[10px] rounded bg-neutral-500/15 text-50">草稿</span>
											{/if}
										</div>
									</div>
									<div class="flex items-center justify-between text-[11px] text-50 mt-1 tabular-nums">
										<span class="truncate max-w-[65%]">/{item.slug}</span>
										<span>{item.published.slice(0, 10)}</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</aside>

				<section class="lg:col-span-8 card-base p-5 md:p-6">
					<form class="space-y-4" onsubmit={handleSavePost}>
						<div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-black/5 dark:border-white/10">
							<h2 class="font-bold text-base text-90">
								{isNewPost ? "✍️ 撰写新文章" : `📝 编辑：${formTitle || formSlug}`}
							</h2>
							<div class="flex items-center gap-2">
								{#if !isNewPost && selectedSlug}
									<a
										href={`/posts/${selectedSlug}/`}
										target="_blank"
										class="btn-regular rounded-lg px-2.5 py-1.5 text-xs gap-1"
									>
										<span>查看</span>
										<Icon icon="fa7-solid:arrow-up-right-from-square" class="text-[10px]" />
									</a>
									<button
										type="button"
										onclick={() => selectedSlug && handleDeletePost(selectedSlug)}
										class="px-2.5 py-1.5 rounded-lg text-xs text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
									>
										删除
									</button>
								{/if}
								<button
									type="submit"
									disabled={postSaving}
									class="px-4 py-1.5 rounded-lg bg-(--primary) text-white dark:text-black/80 text-xs font-semibold hover:opacity-90 active:scale-95 transition cursor-pointer disabled:opacity-50"
								>
									{postSaving ? "保存中…" : "保存发布"}
								</button>
							</div>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
							<div>
								<label class="admin-label" for="post-title">文章标题 *</label>
								<input id="post-title" type="text" required bind:value={formTitle} placeholder="输入标题" class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="post-slug">URL Slug *（英文/拼音短链）</label>
								<div class="flex gap-1.5">
									<input id="post-slug" type="text" bind:value={formSlug} placeholder="my-first-post" class="admin-input w-full" />
									<button
										type="button"
										onclick={() => (formSlug = slugifyTitle(formTitle))}
										class="btn-regular rounded-lg px-2.5 text-xs shrink-0 cursor-pointer"
									>
										生成
									</button>
								</div>
							</div>
							<div>
								<label class="admin-label" for="post-category">分类</label>
								<input id="post-category" type="text" bind:value={formCategory} placeholder="如：技术笔记" class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="post-tags">标签（逗号分隔）</label>
								<input id="post-tags" type="text" bind:value={formTagsText} placeholder="Astro, Vercel, 随笔" class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="post-cover">封面图片 URL</label>
								<div class="flex gap-1.5">
									<input id="post-cover" type="text" bind:value={formImage} placeholder="https:// 或 /api/media/..." class="admin-input w-full" />
									<button
										type="button"
										onclick={() => (showMediaPicker = "post-cover")}
										class="btn-regular rounded-lg px-2.5 text-xs shrink-0 cursor-pointer"
									>
										图库选图
									</button>
								</div>
							</div>
							<div>
								<label class="admin-label" for="post-published">发布时间</label>
								<input id="post-published" type="datetime-local" bind:value={formPublished} class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="post-series">所属系列</label>
								<input id="post-series" type="text" bind:value={formSeries} placeholder="可选系列名称" class="admin-input w-full" />
							</div>
							<div class="flex items-end gap-4 pb-1.5">
								<label class="inline-flex items-center gap-2 text-xs text-75 cursor-pointer">
									<input type="checkbox" bind:checked={formPinned} class="accent-(--primary)" />
									<span>置顶文章</span>
								</label>
								<label class="inline-flex items-center gap-2 text-xs text-75 cursor-pointer">
									<input type="checkbox" bind:checked={formDraft} class="accent-(--primary)" />
									<span>存为草稿</span>
								</label>
							</div>
						</div>

						<div>
							<label class="admin-label" for="post-desc">摘要描述</label>
							<input id="post-desc" type="text" bind:value={formDescription} placeholder="一句话简介（留空自动提取正文摘要）" class="admin-input w-full" />
						</div>

						<!-- Markdown 编辑器工具栏 -->
						<div>
							<div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
								<span class="admin-label mb-0!">Markdown 正文</span>
								<div class="flex items-center gap-1.5">
									<button
										type="button"
										onclick={() => (showMediaPicker = "post-body")}
										class="btn-regular rounded-lg px-2.5 py-1 text-xs gap-1 cursor-pointer"
									>
										<Icon icon="material-symbols:photo-library-outline" class="text-sm" />
										<span>插入 B2 图片</span>
									</button>
									<div class="flex rounded-lg border border-black/10 dark:border-white/10 overflow-hidden text-xs">
										{#each [["edit", "编辑"], ["split", "分栏"], ["preview", "预览"]] as [mode, label]}
											<button
												type="button"
												onclick={() => (editorView = mode as EditorView)}
												class="px-2.5 py-1 transition cursor-pointer {editorView === mode ? 'bg-(--primary) text-white dark:text-black/80 font-medium' : 'text-75 hover:bg-black/5 dark:hover:bg-white/5'}"
											>
												{label}
											</button>
										{/each}
									</div>
								</div>
							</div>

							<div class="grid gap-3 {editorView === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}">
								{#if editorView !== "preview"}
									<textarea
										bind:value={formContent}
										rows={18}
										placeholder="支持标准 Markdown 语法、代码块、表格与图片链接…"
										class="admin-input w-full font-mono text-xs leading-relaxed resize-y min-h-[360px]"
									></textarea>
								{/if}
								{#if editorView !== "edit"}
									<div class="admin-preview markdown-content p-4 rounded-xl border border-black/10 dark:border-white/10 min-h-[360px] max-h-[540px] overflow-y-auto text-sm">
										{@html previewHtml}
									</div>
								{/if}
							</div>
						</div>
					</form>
				</section>
			</div>

		<!-- Tab 2: 动态管理 -->
		{:else if activeTab === "dynamics"}
			<div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
				<section class="lg:col-span-5 card-base p-5">
					<h2 class="font-bold text-base text-90 mb-3">
						{dynEditId ? "编辑动态" : "发布新动态"}
					</h2>
					<form class="space-y-3" onsubmit={handleSaveDynamic}>
						<textarea
							bind:value={dynContent}
							rows={6}
							required
							placeholder="分享此刻的想法或图片（支持 Markdown）…"
							class="admin-input w-full text-sm resize-y"
						></textarea>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
							<input
								type="text"
								bind:value={dynLocation}
								placeholder="地点（可选，如：上海）"
								class="admin-input w-full text-xs"
							/>
							<label class="inline-flex items-center gap-2 text-xs text-75 px-2 cursor-pointer">
								<input type="checkbox" bind:checked={dynPinned} class="accent-(--primary)" />
								<span>置顶该条动态</span>
							</label>
						</div>
						<div class="flex items-center justify-between gap-2 pt-1">
							<button
								type="button"
								onclick={() => (showMediaPicker = "dynamic-body")}
								class="btn-regular rounded-lg px-3 py-1.5 text-xs gap-1 cursor-pointer"
							>
								<Icon icon="material-symbols:photo-library-outline" class="text-sm" />
								<span>插入 B2 图片</span>
							</button>
							<div class="flex items-center gap-2">
								{#if dynEditId}
									<button
										type="button"
										onclick={() => {
											dynEditId = null;
											dynContent = "";
											dynLocation = "";
											dynPinned = false;
										}}
										class="btn-regular rounded-lg px-3 py-1.5 text-xs cursor-pointer"
									>
										取消编辑
									</button>
								{/if}
								<button
									type="submit"
									disabled={dynSaving}
									class="px-4 py-1.5 rounded-lg bg-(--primary) text-white dark:text-black/80 text-xs font-semibold hover:opacity-90 active:scale-95 transition cursor-pointer disabled:opacity-50"
								>
									{dynSaving ? "发布中…" : dynEditId ? "保存修改" : "立即发布"}
								</button>
							</div>
						</div>
					</form>
				</section>

				<section class="lg:col-span-7 card-base p-5 space-y-3">
					<div class="flex items-center justify-between">
						<h2 class="font-bold text-base text-90">动态列表 ({dynamics.length})</h2>
						<a href="/dynamic/" target="_blank" class="text-xs text-(--primary) hover:underline">查看前台动态页 ↗</a>
					</div>
					{#if dynamicsLoading}
						<p class="text-xs text-50 py-8 text-center">加载中…</p>
					{:else if dynamics.length === 0}
						<p class="text-xs text-50 py-8 text-center">暂无动态</p>
					{:else}
						<div class="space-y-2.5 max-h-[65vh] overflow-y-auto pr-1 custom-scrollbar">
							{#each dynamics as item (item.id)}
								<div class="p-3.5 rounded-xl border border-black/8 dark:border-white/10 space-y-2">
									<div class="flex items-center justify-between gap-2 text-xs text-50 tabular-nums">
										<div class="flex items-center gap-2">
											<span>{item.published.slice(0, 16).replace("T", " ")}</span>
											{#if item.location}
												<span>· {item.location}</span>
											{/if}
											{#if item.pinned}
												<span class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 text-[10px]">置顶</span>
											{/if}
										</div>
										<div class="flex items-center gap-2">
											<button type="button" onclick={() => editDynamic(item)} class="text-(--primary) hover:underline cursor-pointer">编辑</button>
											<button type="button" onclick={() => handleDeleteDynamic(item.id)} class="text-rose-500 hover:underline cursor-pointer">删除</button>
										</div>
									</div>
									<p class="text-sm text-90 whitespace-pre-wrap break-words">{item.content}</p>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			</div>

		<!-- Tab 3: Backblaze B2 对象存储图床 -->
		{:else if activeTab === "media"}
			<section class="card-base p-5 md:p-6 space-y-4">
				<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div>
						<h2 class="font-bold text-base text-90 flex items-center gap-2">
							<span>Backblaze B2 对象存储</span>
							<span class="px-2 py-0.5 rounded-full text-[11px] font-medium {mediaConfigured ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}">
								{mediaConfigured ? "已连接" : "未配置"}
							</span>
						</h2>
						<p class="text-xs text-50 mt-0.5">支持拖拽上传图片或附件（单文件 ≤ 4.2 MB），上传后自动生成永久可访问路径</p>
					</div>
					<div class="flex items-center gap-2">
						<input
							type="text"
							bind:value={uploadFolder}
							placeholder="存储目录，默认 uploads"
							class="admin-input text-xs w-36"
						/>
						<button
							type="button"
							onclick={loadMedia}
							class="btn-regular rounded-lg px-3 py-2 text-xs cursor-pointer"
						>
							刷新列表
						</button>
					</div>
				</div>

				<!-- 拖拽上传区 -->
				<div
					role="region"
					aria-label="文件拖拽上传区"
					ondragover={(e) => {
						e.preventDefault();
						dragOver = true;
					}}
					ondragleave={() => (dragOver = false)}
					ondrop={handleDrop}
					class="rounded-2xl border-2 border-dashed p-8 text-center transition-all {dragOver
						? 'border-(--primary) bg-(--primary)/10 scale-[1.01]'
						: 'border-black/15 dark:border-white/15 hover:border-(--primary)/50'}"
				>
					<Icon icon="material-symbols:upload-file-outline" class="text-4xl text-(--primary) mx-auto mb-2" />
					<p class="text-sm font-medium text-90">
						{uploading ? "正在上传至 Backblaze B2…" : "将图片或文件拖拽到此处，或点击下方按钮选择"}
					</p>
					<p class="text-xs text-50 mt-1 mb-4">支持 PNG / JPG / WebP / AVIF / GIF / PDF / ZIP 等常见格式</p>
					<label class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-(--primary) text-white dark:text-black/80 text-xs font-semibold cursor-pointer hover:opacity-90 active:scale-95 transition">
						<Icon icon="material-symbols:add-rounded" class="text-base" />
						<span>{uploading ? "上传中…" : "选择文件上传"}</span>
						<input
							type="file"
							multiple
							class="hidden"
							disabled={uploading}
							onchange={(e) => {
								const input = e.currentTarget;
								if (input.files?.length) {
									uploadFiles(input.files);
									input.value = "";
								}
							}}
						/>
					</label>
				</div>

				<div class="flex items-center justify-between gap-2">
					<input
						type="search"
						placeholder="按文件名筛选…"
						bind:value={mediaSearch}
						class="admin-input text-xs w-full sm:w-72"
					/>
					<span class="text-xs text-50 tabular-nums shrink-0">共 {filteredMedia.length} 个文件</span>
				</div>

				{#if mediaLoading}
					<p class="text-xs text-50 py-8 text-center">加载对象存储文件中…</p>
				{:else if filteredMedia.length === 0}
					<p class="text-xs text-50 py-8 text-center">当前存储桶暂无文件</p>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
						{#each filteredMedia as item (item.fileId)}
							<div class="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden flex flex-col bg-black/2 dark:bg-white/2">
								<div class="h-36 bg-black/5 dark:bg-white/5 flex items-center justify-center overflow-hidden">
									{#if isImageContentType(item.contentType, item.fileName)}
										<img src={item.url} alt={item.fileName} loading="lazy" class="w-full h-full object-cover" />
									{:else}
										<Icon icon="material-symbols:insert-drive-file-outline" class="text-4xl text-50" />
									{/if}
								</div>
								<div class="p-3 flex-1 flex flex-col justify-between gap-2">
									<div>
										<p class="text-xs font-medium text-90 truncate" title={item.fileName}>{item.fileName}</p>
										<p class="text-[11px] text-50 tabular-nums mt-0.5">{formatBytes(item.contentLength)}</p>
									</div>
									<div class="flex flex-wrap gap-1.5 text-[11px]">
										<button
											type="button"
											onclick={() => copyText(item.url, "链接")}
											class="btn-regular rounded px-2 py-1 cursor-pointer"
										>
											复制URL
										</button>
										<button
											type="button"
											onclick={() => copyText(`![${item.fileName.split("/").pop() || "image"}](${item.url})`, "Markdown")}
											class="btn-regular rounded px-2 py-1 cursor-pointer"
										>
											复制MD
										</button>
										<button
											type="button"
											onclick={() => handleDeleteMedia(item)}
											class="px-2 py-1 rounded text-rose-500 hover:bg-rose-500/10 ml-auto cursor-pointer"
										>
											删除
										</button>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>

		<!-- Tab 4: 站点设置（严格不展示任何数据库相关设置） -->
		{:else if activeTab === "settings"}
			<section class="card-base p-5 md:p-6">
				<div class="flex items-center justify-between pb-3 mb-4 border-b border-black/5 dark:border-white/10">
					<div>
						<h2 class="font-bold text-base text-90">站点基础设置</h2>
						<p class="text-xs text-50 mt-0.5">自定义博客名称、个人资料、首页横幅与公告内容</p>
					</div>
				</div>

				{#if settingsLoading}
					<p class="text-xs text-50 py-8 text-center">加载设置中…</p>
				{:else}
					<form class="space-y-4 max-w-3xl" onsubmit={handleSaveSettings}>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
							<div>
								<label class="admin-label" for="s-title">博客名称</label>
								<input id="s-title" type="text" bind:value={settingsForm.siteTitle} class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="s-nav">导航栏标题</label>
								<input id="s-nav" type="text" bind:value={settingsForm.navbarTitle} class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="s-sub">站点副标题</label>
								<input id="s-sub" type="text" bind:value={settingsForm.siteSubtitle} class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="s-name">博主昵称</label>
								<input id="s-name" type="text" bind:value={settingsForm.profileName} class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="s-bio">个人签名</label>
								<input id="s-bio" type="text" bind:value={settingsForm.profileBio} class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="s-avatar">头像 URL</label>
								<div class="flex gap-1.5">
									<input id="s-avatar" type="text" bind:value={settingsForm.profileAvatar} class="admin-input w-full" />
									<button
										type="button"
										onclick={() => (showMediaPicker = "avatar")}
										class="btn-regular rounded-lg px-2.5 text-xs shrink-0 cursor-pointer"
									>
										选图
									</button>
								</div>
							</div>
						</div>

						<div>
							<label class="admin-label" for="s-desc">站点 SEO 描述</label>
							<textarea id="s-desc" rows={2} bind:value={settingsForm.siteDescription} class="admin-input w-full"></textarea>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
							<div>
								<label class="admin-label" for="s-ann-title">公告标题（留空用默认）</label>
								<input id="s-ann-title" type="text" bind:value={settingsForm.announcementTitle} class="admin-input w-full" />
							</div>
							<div>
								<label class="admin-label" for="s-banner-title">首页横幅主标题</label>
								<input id="s-banner-title" type="text" bind:value={settingsForm.bannerTitle} class="admin-input w-full" />
							</div>
						</div>

						<div>
							<label class="admin-label" for="s-ann-content">公告内容</label>
							<textarea id="s-ann-content" rows={2} bind:value={settingsForm.announcementContent} class="admin-input w-full"></textarea>
						</div>

						<div>
							<label class="admin-label" for="s-banner-subs">首页横幅副标题（每行一条）</label>
							<textarea id="s-banner-subs" rows={3} bind:value={bannerSubtitlesText} class="admin-input w-full"></textarea>
						</div>

						<div class="pt-2">
							<button
								type="submit"
								disabled={settingsSaving}
								class="px-5 py-2.5 rounded-xl bg-(--primary) text-white dark:text-black/80 text-sm font-semibold hover:opacity-90 active:scale-95 transition cursor-pointer disabled:opacity-50"
							>
								{settingsSaving ? "保存中…" : "保存站点设置"}
							</button>
						</div>
					</form>
				{/if}
			</section>
		{/if}
	{/if}

	<!-- 图床快速选择器弹窗 -->
	{#if showMediaPicker}
		<div class="fixed inset-0 z-[1150] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="从 Backblaze B2 选择资源">
			<div class="card-base w-full max-w-3xl max-h-[82vh] flex flex-col p-5">
				<div class="flex items-center justify-between pb-3 mb-3 border-b border-black/10 dark:border-white/10">
					<h3 class="font-bold text-base text-90">从 Backblaze B2 图库选择</h3>
					<button type="button" onclick={() => (showMediaPicker = null)} class="btn-regular rounded-lg w-8 h-8 cursor-pointer">✕</button>
				</div>
				<div class="overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pr-1 custom-scrollbar">
					{#each mediaFiles as item (item.fileId)}
						<button
							type="button"
							onclick={() => applyPickedMedia(item)}
							class="text-left rounded-xl border border-black/10 dark:border-white/10 overflow-hidden hover:border-(--primary) transition cursor-pointer"
						>
							<div class="h-24 bg-black/5 dark:bg-white/5 flex items-center justify-center">
								{#if isImageContentType(item.contentType, item.fileName)}
									<img src={item.url} alt={item.fileName} class="w-full h-full object-cover" />
								{:else}
									<Icon icon="material-symbols:insert-drive-file-outline" class="text-3xl text-50" />
								{/if}
							</div>
							<p class="p-2 text-[11px] text-75 truncate">{item.fileName.split("/").pop()}</p>
						</button>
					{/each}
					{#if mediaFiles.length === 0}
						<p class="col-span-full text-center text-xs text-50 py-10">图库暂无文件，请先到「B2 图床文件」标签页上传。</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Ctrl/⌘ + K 快捷切换面板 -->
	{#if commandOpen}
		<div class="fixed inset-0 z-[1160] bg-black/50 backdrop-blur-xs flex items-start justify-center pt-24 p-4" role="dialog" aria-modal="true" aria-label="快捷导航">
			<div class="card-base w-full max-w-md p-4 space-y-2">
				<div class="flex items-center justify-between text-xs text-50 pb-2 border-b border-black/10 dark:border-white/10">
					<span>快速跳转工作区</span>
					<button type="button" onclick={() => (commandOpen = false)} class="cursor-pointer">ESC</button>
				</div>
				{#each [["posts", "文章管理（新建/编辑 Markdown）"], ["dynamics", "动态管理（发布碎碎念）"], ["media", "Backblaze B2 图床与文件管理"], ["settings", "站点设置（酷酷dcl 基础配置）"]] as [tab, label]}
					<button
						type="button"
						onclick={() => {
							setTab(tab as AdminTab);
							commandOpen = false;
						}}
						class="w-full text-left px-3 py-2.5 rounded-xl text-sm text-90 hover:bg-(--primary)/12 hover:text-(--primary) transition cursor-pointer"
					>
						{label}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--btn-content);
		margin-bottom: 0.35rem;
		opacity: 0.85;
	}
	.admin-input {
		border-radius: 0.75rem;
		border: 1px solid rgba(128, 128, 128, 0.22);
		background: rgba(255, 255, 255, 0.55);
		padding: 0.55rem 0.75rem;
		font-size: 0.875rem;
		color: inherit;
		outline: none;
		transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
	}
	:global(.dark) .admin-input {
		background: rgba(18, 20, 28, 0.55);
		border-color: rgba(255, 255, 255, 0.14);
		color: rgba(255, 255, 255, 0.92);
	}
	.admin-input:focus {
		border-color: var(--primary);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent);
	}
	.bento-stat {
		border-radius: 0.9rem;
		padding: 0.85rem 1rem;
		border: 1px solid rgba(128, 128, 128, 0.14);
		background: rgba(128, 128, 128, 0.04);
		transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
		cursor: pointer;
	}
	.bento-stat:hover {
		transform: translateY(-1px);
		border-color: color-mix(in oklab, var(--primary) 45%, transparent);
	}
	.bento-stat-active {
		border-color: var(--primary);
		background: color-mix(in oklab, var(--primary) 10%, transparent);
	}
	.admin-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.85rem;
		border-radius: 0.75rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--btn-content);
		opacity: 0.75;
		white-space: nowrap;
		cursor: pointer;
		transition: all 0.2s ease;
	}
	.admin-tab:hover {
		opacity: 1;
		background: rgba(128, 128, 128, 0.08);
	}
	.admin-tab-active {
		opacity: 1;
		color: var(--primary);
		background: color-mix(in oklab, var(--primary) 14%, transparent);
		font-weight: 600;
	}
</style>
