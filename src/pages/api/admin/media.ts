import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import {
	deleteB2Object,
	isB2Configured,
	listB2Objects,
	sanitizeB2ObjectKey,
	uploadB2Object,
} from "@/lib/b2-storage";

export const prerender = false;

const MAX_SERVER_UPLOAD_BYTES = 4.2 * 1024 * 1024;

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

	if (!isB2Configured()) {
		return json({
			ok: true,
			configured: false,
			files: [],
			nextFileName: null,
		});
	}

	try {
		const url = new URL(request.url);
		const prefix = url.searchParams.get("prefix") || "";
		const startAfter = url.searchParams.get("startAfter") || undefined;
		const res = await listB2Objects(prefix, 100, startAfter);
		return json({
			ok: true,
			configured: true,
			files: res.files,
			nextFileName: res.nextFileName,
		});
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "获取文件列表失败",
			},
			500,
		);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	if (!isB2Configured()) {
		return json(
			{
				ok: false,
				error: "Backblaze B2 对象存储未配置，请检查环境变量",
			},
			400,
		);
	}

	try {
		const formData = await request.formData();
		const file = formData.get("file");
		const folder = String(formData.get("folder") || "uploads").trim();

		if (!(file instanceof File)) {
			return json({ ok: false, error: "请选择要上传的文件" }, 400);
		}
		if (file.size === 0) {
			return json({ ok: false, error: "文件不能为空" }, 400);
		}
		if (file.size > MAX_SERVER_UPLOAD_BYTES) {
			return json(
				{
					ok: false,
					error: "单次上传文件请控制在 4.2 MB 以内（受 Vercel 函数请求体限制）",
				},
				413,
			);
		}

		const now = new Date();
		const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
		const stamp = Date.now().toString(36);
		const safeName = sanitizeB2ObjectKey(file.name);
		const safeFolder = sanitizeB2ObjectKey(folder || "uploads").replace(
			/\.[a-z0-9]+$/i,
			"",
		);
		const objectKey = `${safeFolder || "uploads"}/${ym}/${stamp}-${safeName}`;

		const bytes = new Uint8Array(await file.arrayBuffer());
		const uploaded = await uploadB2Object(
			objectKey,
			bytes,
			file.type || "application/octet-stream",
		);
		return json({ ok: true, file: uploaded });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "上传文件失败",
			},
			500,
		);
	}
};

export const DELETE: APIRoute = async ({ request }) => {
	const auth = requireAdmin(request);
	if ("response" in auth) return auth.response;

	try {
		const body = (await request.json().catch(() => ({}))) as {
			fileName?: string;
			fileId?: string;
		};
		if (!body.fileName || !body.fileId) {
			return json({ ok: false, error: "缺少 fileName 或 fileId" }, 400);
		}
		await deleteB2Object(body.fileName, body.fileId);
		return json({ ok: true });
	} catch (err) {
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "删除文件失败",
			},
			500,
		);
	}
};
