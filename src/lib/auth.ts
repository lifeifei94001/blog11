import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getCleanEnv } from "./env";

export const ADMIN_COOKIE_NAME = "dcl_admin_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AdminSession {
	username: string;
	exp: number;
}

function getAdminCredentials(): {
	username: string;
	password: string;
	passwordSha256: string;
	secret: string;
	isProd: boolean;
} {
	const isProd = Boolean(
		getCleanEnv("VERCEL") ||
			getCleanEnv("VERCEL_ENV") ||
			process.env.NODE_ENV === "production",
	);
	const username = getCleanEnv("ADMIN_USERNAME") || "admin";
	const password = getCleanEnv("ADMIN_PASSWORD");
	const passwordSha256 = getCleanEnv("ADMIN_PASSWORD_SHA256").toLowerCase();
	const explicitSecret = getCleanEnv("AUTH_SECRET");

	const secret =
		explicitSecret ||
		createHash("sha256")
			.update(
				`${username}:${password || passwordSha256 || "local-dev"}::kukudcl-session`,
			)
			.digest("hex");

	return { username, password, passwordSha256, secret, isProd };
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqualString(a: string, b: string): boolean {
	const bufA = createHash("sha256").update(a, "utf8").digest();
	const bufB = createHash("sha256").update(b, "utf8").digest();
	return timingSafeEqual(bufA, bufB);
}

export function verifyAdminLogin(
	inputUser: string,
	inputPass: string,
): { ok: true; username: string } | { ok: false; error: string } {
	const cfg = getAdminCredentials();
	const effectivePass =
		cfg.password || (!cfg.isProd && !cfg.passwordSha256 ? "kukudcl-admin" : "");

	if (!effectivePass && !cfg.passwordSha256) {
		return {
			ok: false,
			error:
				"服务端尚未配置 ADMIN_PASSWORD 环境变量，请在 Vercel 项目环境变量中添加 ADMIN_USERNAME 与 ADMIN_PASSWORD 并重新部署。",
		};
	}

	const userMatch = safeEqualString(inputUser.trim(), cfg.username);
	let passMatch = false;
	if (cfg.passwordSha256) {
		passMatch = safeEqualString(sha256Hex(inputPass), cfg.passwordSha256);
	} else {
		passMatch = safeEqualString(inputPass, effectivePass);
	}

	if (!userMatch || !passMatch) {
		return { ok: false, error: "账户或密码错误" };
	}

	return { ok: true, username: cfg.username };
}

export function createAdminSessionToken(username: string): string {
	const { secret } = getAdminCredentials();
	const payload: AdminSession = {
		username,
		exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
	};
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
		"base64url",
	);
	const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
	return `${encoded}.${sig}`;
}

export function verifyAdminSessionToken(
	token: string | undefined | null,
): AdminSession | null {
	if (!token?.includes(".")) return null;
	const [encoded, sig] = token.split(".", 2);
	if (!encoded || !sig) return null;

	const { secret } = getAdminCredentials();
	const expectedSig = createHmac("sha256", secret)
		.update(encoded)
		.digest("base64url");

	const sigBuf = Buffer.from(sig, "utf8");
	const expBuf = Buffer.from(expectedSig, "utf8");
	if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
		return null;
	}

	try {
		const payload = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		) as AdminSession;
		if (!payload?.username || !payload?.exp) return null;
		if (payload.exp < Math.floor(Date.now() / 1000)) return null;
		return payload;
	} catch {
		return null;
	}
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
	const out: Record<string, string> = {};
	if (!cookieHeader) return out;
	for (const part of cookieHeader.split(";")) {
		const idx = part.indexOf("=");
		if (idx <= 0) continue;
		const k = part.slice(0, idx).trim();
		const v = part.slice(idx + 1).trim();
		try {
			out[k] = decodeURIComponent(v);
		} catch {
			out[k] = v;
		}
	}
	return out;
}

export function getAdminSession(request: Request): AdminSession | null {
	const cookies = parseCookies(request.headers.get("cookie"));
	return verifyAdminSessionToken(cookies[ADMIN_COOKIE_NAME]);
}

export function buildSessionCookieHeader(
	token: string,
	request: Request,
	maxAgeSeconds: number = SESSION_TTL_SECONDS,
): string {
	const url = new URL(request.url);
	const isHttps =
		url.protocol === "https:" ||
		request.headers.get("x-forwarded-proto") === "https";
	const parts = [
		`${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
		"Path=/",
		`Max-Age=${maxAgeSeconds}`,
		"HttpOnly",
		"SameSite=Lax",
	];
	if (isHttps) parts.push("Secure");
	return parts.join("; ");
}

export function requireAdmin(
	request: Request,
): { session: AdminSession } | { response: Response } {
	const session = getAdminSession(request);
	if (!session) {
		return {
			response: new Response(
				JSON.stringify({ ok: false, error: "未登录或会话已过期，请重新登录" }),
				{
					status: 401,
					headers: { "Content-Type": "application/json; charset=utf-8" },
				},
			),
		};
	}
	return { session };
}
