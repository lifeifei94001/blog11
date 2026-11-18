import { createHash } from "node:crypto";
import { getCleanEnv } from "./env";

interface B2AuthState {
	accountId: string;
	apiUrl: string;
	authorizationToken: string;
	downloadUrl: string;
	allowedBucketId?: string;
	allowedBucketName?: string;
	expiresAt: number;
}

interface B2BucketInfo {
	bucketId: string;
	bucketName: string;
	bucketType: string;
}

export interface B2FileItem {
	fileId: string;
	fileName: string;
	contentLength: number;
	contentType: string;
	uploadTimestamp: number;
	url: string;
}

let cachedAuth: B2AuthState | null = null;
let cachedBucket: B2BucketInfo | null = null;

function getB2Credentials() {
	const keyId = getCleanEnv("B2_KEY_ID");
	const applicationKey = getCleanEnv("B2_APPLICATION_KEY");
	const bucketName = getCleanEnv("B2_BUCKET_NAME");
	const bucketId = getCleanEnv("B2_BUCKET_ID");
	const publicUrl = getCleanEnv("B2_PUBLIC_URL");
	return { keyId, applicationKey, bucketName, bucketId, publicUrl };
}

export function isB2Configured(): boolean {
	const { keyId, applicationKey } = getB2Credentials();
	return Boolean(keyId && applicationKey);
}

export function encodeB2PathSegments(fileName: string): string {
	return fileName
		.replace(/^\/+/, "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg))
		.join("/");
}

export function buildPublicMediaUrl(fileName: string): string {
	const { publicUrl } = getB2Credentials();
	if (publicUrl) {
		const encoded = encodeB2PathSegments(fileName);
		return `${publicUrl.replace(/\/+$/, "")}/${encoded}`;
	}
	return `/api/media/?key=${encodeURIComponent(fileName.replace(/^\/+/, ""))}`;
}

async function authorizeB2(forceRefresh = false): Promise<B2AuthState> {
	const now = Date.now();
	if (!forceRefresh && cachedAuth && cachedAuth.expiresAt > now) {
		return cachedAuth;
	}

	const { keyId, applicationKey } = getB2Credentials();
	if (!keyId || !applicationKey) {
		throw new Error(
			"Backblaze B2 对象存储环境变量 (B2_KEY_ID / B2_APPLICATION_KEY) 未配置",
		);
	}

	const basic = Buffer.from(`${keyId}:${applicationKey}`, "utf-8").toString(
		"base64",
	);
	const resp = await fetch(
		"https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
		{
			method: "GET",
			headers: {
				Authorization: `Basic ${basic}`,
			},
		},
	);

	if (!resp.ok) {
		const errText = (await resp.text()).slice(0, 200);
		throw new Error(`Backblaze B2 认证失败 (HTTP ${resp.status}): ${errText}`);
	}

	const data = (await resp.json()) as {
		accountId: string;
		apiUrl: string;
		authorizationToken: string;
		downloadUrl: string;
		allowed?: {
			bucketId?: string;
			bucketName?: string;
		};
	};

	cachedAuth = {
		accountId: data.accountId,
		apiUrl: data.apiUrl,
		authorizationToken: data.authorizationToken,
		downloadUrl: data.downloadUrl,
		allowedBucketId: data.allowed?.bucketId || undefined,
		allowedBucketName: data.allowed?.bucketName || undefined,
		// B2 令牌有效期为 24 小时，提前 4 小时刷新
		expiresAt: now + 20 * 60 * 60 * 1000,
	};
	return cachedAuth;
}

async function callB2Json<T>(
	path: string,
	body: Record<string, unknown>,
	retryOn401 = true,
): Promise<T> {
	const auth = await authorizeB2();
	const resp = await fetch(`${auth.apiUrl}${path}`, {
		method: "POST",
		headers: {
			Authorization: auth.authorizationToken,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (resp.status === 401 && retryOn401) {
		await authorizeB2(true);
		return callB2Json<T>(path, body, false);
	}

	if (!resp.ok) {
		const errText = (await resp.text()).slice(0, 240);
		throw new Error(
			`Backblaze B2 接口 ${path} 失败 (HTTP ${resp.status}): ${errText}`,
		);
	}

	return (await resp.json()) as T;
}

export async function resolveB2Bucket(): Promise<B2BucketInfo> {
	if (cachedBucket) return cachedBucket;

	const auth = await authorizeB2();
	const { bucketId, bucketName } = getB2Credentials();

	if (auth.allowedBucketId && auth.allowedBucketName) {
		cachedBucket = {
			bucketId: auth.allowedBucketId,
			bucketName: auth.allowedBucketName,
			bucketType: "unknown",
		};
		return cachedBucket;
	}

	const listRes = await callB2Json<{ buckets?: B2BucketInfo[] }>(
		"/b2api/v2/b2_list_buckets",
		{
			accountId: auth.accountId,
			...(bucketId ? { bucketId } : {}),
			...(bucketName ? { bucketName } : {}),
		},
	);

	const buckets = listRes.buckets ?? [];
	const target =
		buckets.find(
			(b) =>
				(bucketId && b.bucketId === bucketId) ||
				(bucketName && b.bucketName === bucketName),
		) ?? (buckets.length === 1 ? buckets[0] : undefined);

	if (!target) {
		throw new Error(
			"未找到目标 Backblaze B2 存储桶（请确认环境变量 B2_BUCKET_NAME）",
		);
	}

	cachedBucket = target;
	return target;
}

export function sanitizeB2ObjectKey(rawName: string): string {
	const cleaned = rawName
		.trim()
		.replace(/\\/g, "/")
		.replace(/\.\.+/g, "")
		.replace(/^\/+/, "");
	const extMatch = cleaned.match(/(\.[a-zA-Z0-9]{1,10})$/);
	const ext = extMatch ? extMatch[1].toLowerCase() : "";
	const base = ext ? cleaned.slice(0, -ext.length) : cleaned;
	const safeBase =
		base
			.replace(/[^a-zA-Z0-9/_-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^[-/]+|[-/]+$/g, "") || "file";
	return `${safeBase}${ext}`;
}

export async function getB2UploadTarget(): Promise<{
	uploadUrl: string;
	authorizationToken: string;
	bucketId: string;
	bucketName: string;
}> {
	const bucket = await resolveB2Bucket();
	const res = await callB2Json<{
		uploadUrl: string;
		authorizationToken: string;
	}>("/b2api/v2/b2_get_upload_url", {
		bucketId: bucket.bucketId,
	});
	return {
		uploadUrl: res.uploadUrl,
		authorizationToken: res.authorizationToken,
		bucketId: bucket.bucketId,
		bucketName: bucket.bucketName,
	};
}

export async function uploadB2Object(
	objectKey: string,
	bytes: Uint8Array,
	contentType = "application/octet-stream",
): Promise<B2FileItem> {
	const target = await getB2UploadTarget();
	const sha1 = createHash("sha1").update(bytes).digest("hex");
	const encodedName = encodeB2PathSegments(objectKey);

	const resp = await fetch(target.uploadUrl, {
		method: "POST",
		headers: {
			Authorization: target.authorizationToken,
			"X-Bz-File-Name": encodedName,
			"Content-Type": contentType || "b2/x-auto",
			"Content-Length": String(bytes.byteLength),
			"X-Bz-Content-Sha1": sha1,
		},
		body: Buffer.from(bytes),
	});

	if (!resp.ok) {
		const errText = (await resp.text()).slice(0, 240);
		throw new Error(`Backblaze B2 上传失败 (HTTP ${resp.status}): ${errText}`);
	}

	const data = (await resp.json()) as {
		fileId: string;
		fileName: string;
		contentLength: number;
		contentType: string;
		uploadTimestamp: number;
	};

	return {
		fileId: data.fileId,
		fileName: data.fileName,
		contentLength: data.contentLength,
		contentType: data.contentType,
		uploadTimestamp: data.uploadTimestamp,
		url: buildPublicMediaUrl(data.fileName),
	};
}

export async function listB2Objects(
	prefix = "",
	maxFileCount = 100,
	startFileName?: string,
): Promise<{ files: B2FileItem[]; nextFileName: string | null }> {
	const bucket = await resolveB2Bucket();
	const res = await callB2Json<{
		files?: Array<{
			fileId: string;
			fileName: string;
			contentLength: number;
			contentType: string;
			uploadTimestamp: number;
			action?: string;
		}>;
		nextFileName?: string | null;
	}>("/b2api/v2/b2_list_file_names", {
		bucketId: bucket.bucketId,
		maxFileCount: Math.min(1000, Math.max(1, maxFileCount)),
		...(prefix ? { prefix } : {}),
		...(startFileName ? { startFileName } : {}),
	});

	const files: B2FileItem[] = (res.files ?? [])
		.filter((f) => f.action !== "hide")
		.map((f) => ({
			fileId: f.fileId,
			fileName: f.fileName,
			contentLength: f.contentLength,
			contentType: f.contentType,
			uploadTimestamp: f.uploadTimestamp,
			url: buildPublicMediaUrl(f.fileName),
		}));

	return {
		files,
		nextFileName: res.nextFileName ?? null,
	};
}

export async function deleteB2Object(
	fileName: string,
	fileId: string,
): Promise<void> {
	await callB2Json("/b2api/v2/b2_delete_file_version", {
		fileName,
		fileId,
	});
}

export async function fetchB2ObjectResponse(
	objectKey: string,
): Promise<Response> {
	const auth = await authorizeB2();
	const bucket = await resolveB2Bucket();
	const cleanKey = objectKey.replace(/^\/+/, "");
	const encoded = encodeB2PathSegments(cleanKey);
	const fileUrl = `${auth.downloadUrl}/file/${encodeURIComponent(bucket.bucketName)}/${encoded}`;

	const headResp = await fetch(fileUrl, {
		method: "HEAD",
		headers: {
			Authorization: auth.authorizationToken,
		},
	});

	if (headResp.status === 401) {
		const refreshed = await authorizeB2(true);
		return fetchB2ObjectResponseWithAuth(cleanKey, encoded, refreshed, bucket);
	}

	const contentLength = Number(headResp.headers.get("content-length") || "0");
	// Vercel Function 响应体上限 4.5MB：大于 4MB 的文件自动换取短期签名 URL 并 302 重定向
	if (headResp.ok && contentLength > 4 * 1024 * 1024) {
		const dlAuth = await callB2Json<{ authorizationToken: string }>(
			"/b2api/v2/b2_get_download_authorization",
			{
				bucketId: bucket.bucketId,
				fileNamePrefix: cleanKey,
				validDurationInSeconds: 3600,
			},
		);
		const signedUrl = `${fileUrl}?Authorization=${encodeURIComponent(dlAuth.authorizationToken)}`;
		return Response.redirect(signedUrl, 302);
	}

	return fetchB2ObjectResponseWithAuth(cleanKey, encoded, auth, bucket);
}

async function fetchB2ObjectResponseWithAuth(
	_cleanKey: string,
	encoded: string,
	auth: B2AuthState,
	bucket: B2BucketInfo,
): Promise<Response> {
	const fileUrl = `${auth.downloadUrl}/file/${encodeURIComponent(bucket.bucketName)}/${encoded}`;
	const resp = await fetch(fileUrl, {
		method: "GET",
		headers: {
			Authorization: auth.authorizationToken,
		},
	});

	if (!resp.ok) {
		return new Response("Not Found", {
			status: resp.status === 404 ? 404 : 502,
		});
	}

	const headers = new Headers();
	headers.set(
		"Content-Type",
		resp.headers.get("content-type") || "application/octet-stream",
	);
	const contentLen = resp.headers.get("content-length");
	if (contentLen) headers.set("Content-Length", contentLen);
	headers.set("Cache-Control", "public, max-age=31536000, immutable");
	headers.set("X-Content-Type-Options", "nosniff");

	return new Response(resp.body, {
		status: 200,
		headers,
	});
}
