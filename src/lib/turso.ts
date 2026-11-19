import { getCleanEnv, stripCleanEnvValue } from "./env";

const JWT_RE = /(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/;

export type TursoValue = string | number | boolean | null;

export interface TursoStatement {
	sql: string;
	args?: TursoValue[];
}

export interface TursoQueryResult {
	columns: string[];
	rows: Record<string, TursoValue>[];
	affectedRowCount: number;
	lastInsertRowid: string | null;
}

type HranaArg =
	| { type: "null" }
	| { type: "integer"; value: string }
	| { type: "float"; value: number }
	| { type: "text"; value: string };

type HranaCell = {
	type?: string;
	value?: string | number | null;
};

function normalizeTursoHost(rawUrl: string): string {
	let u = stripCleanEnvValue(rawUrl);
	for (const prefix of [
		"sqlite+libsql://",
		"libsql://",
		"turso://",
		"wss://",
		"ws://",
		"https://",
		"http://",
	]) {
		if (u.toLowerCase().startsWith(prefix)) {
			u = u.slice(prefix.length);
			break;
		}
	}
	if (u.includes("?")) {
		u = u.split("?", 1)[0];
	}
	for (const suffix of ["/v2/pipeline", "/v2", "/"]) {
		if (u.endsWith(suffix)) {
			u = u.slice(0, -suffix.length);
		}
	}
	return u.replace(/^\/+|\/+$/g, "");
}

function extractCleanJwt(rawToken: string): string {
	const t = stripCleanEnvValue(rawToken);
	const m = JWT_RE.exec(t);
	return m ? m[1] : t;
}

function encodeArg(val: TursoValue): HranaArg {
	if (val === null || val === undefined) {
		return { type: "null" };
	}
	if (typeof val === "boolean") {
		return { type: "integer", value: val ? "1" : "0" };
	}
	if (typeof val === "number") {
		if (!Number.isFinite(val)) return { type: "null" };
		if (Number.isInteger(val)) {
			return { type: "integer", value: String(val) };
		}
		return { type: "float", value: val };
	}
	return { type: "text", value: String(val) };
}

function decodeCell(cell: HranaCell | undefined): TursoValue {
	if (!cell?.type || cell.type === "null") return null;
	if (cell.type === "integer") {
		const n = Number(cell.value);
		return Number.isSafeInteger(n) ? n : String(cell.value ?? "");
	}
	if (cell.type === "float") {
		return Number(cell.value);
	}
	return String(cell.value ?? "");
}

function getTursoConfig(): { pipelineUrl: string; authToken: string } | null {
	const rawUrl = getCleanEnv("TURSO_DATABASE_URL");
	if (!rawUrl) return null;
	const host = normalizeTursoHost(rawUrl);
	if (!host) return null;
	const scheme =
		host.startsWith("127.0.0.1") || host.startsWith("localhost")
			? "http"
			: "https";
	const authToken = extractCleanJwt(getCleanEnv("TURSO_AUTH_TOKEN"));
	return {
		pipelineUrl: `${scheme}://${host}/v2/pipeline`,
		authToken,
	};
}

export function isTursoConfigured(): boolean {
	return getTursoConfig() !== null;
}

export async function tursoBatch(
	statements: TursoStatement[],
): Promise<TursoQueryResult[]> {
	const cfg = getTursoConfig();
	if (!cfg) {
		throw new Error("Turso 数据库环境变量未配置");
	}
	if (statements.length === 0) return [];

	const requests = [
		...statements.map((st) => ({
			type: "execute",
			stmt: {
				sql: st.sql,
				...(st.args && st.args.length > 0
					? { args: st.args.map(encodeArg) }
					: {}),
			},
		})),
		{ type: "close" },
	];

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (cfg.authToken) {
		headers.Authorization = `Bearer ${cfg.authToken}`;
	}

	const resp = await fetch(cfg.pipelineUrl, {
		method: "POST",
		headers,
		body: JSON.stringify({ requests }),
	});

	if (!resp.ok) {
		const errText = (await resp.text()).slice(0, 240);
		if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
			const tokenHint = cfg.authToken
				? cfg.authToken.startsWith("eyJ")
					? `已填写且以 eyJ 开头（长度 ${cfg.authToken.length}）`
					: `已填写但非 eyJ 开头（长度 ${cfg.authToken.length}）`
				: "为空";
			throw new Error(
				`Turso 认证校验失败 (HTTP ${resp.status})，Token 状态：${tokenHint}。请核对 Vercel 环境变量后 Redeploy。`,
			);
		}
		throw new Error(`Turso 请求失败 (HTTP ${resp.status}): ${errText}`);
	}

	const data = (await resp.json()) as {
		results?: Array<{
			type?: string;
			error?: { message?: string };
			response?: {
				type?: string;
				result?: {
					cols?: Array<{ name?: string }>;
					rows?: HranaCell[][];
					affected_row_count?: number;
					last_insert_rowid?: string | null;
				};
			};
		}>;
	};

	const out: TursoQueryResult[] = [];
	for (const item of data.results ?? []) {
		if (item.type === "error") {
			throw new Error(
				`Turso SQL 执行失败: ${item.error?.message || "未知错误"}`,
			);
		}
		const res = item.response?.result;
		if (item.response?.type === "execute" && res) {
			const columns = (res.cols ?? []).map((c) => c.name || "");
			const rows = (res.rows ?? []).map((rowCells) => {
				const rowObj: Record<string, TursoValue> = {};
				columns.forEach((colName, idx) => {
					rowObj[colName] = decodeCell(rowCells[idx]);
				});
				return rowObj;
			});
			out.push({
				columns,
				rows,
				affectedRowCount: Number(res.affected_row_count ?? 0),
				lastInsertRowid:
					res.last_insert_rowid !== undefined && res.last_insert_rowid !== null
						? String(res.last_insert_rowid)
						: null,
			});
		}
	}
	return out;
}

export async function tursoExecute(
	sql: string,
	args: TursoValue[] = [],
): Promise<TursoQueryResult> {
	const results = await tursoBatch([{ sql, args }]);
	return (
		results[0] ?? {
			columns: [],
			rows: [],
			affectedRowCount: 0,
			lastInsertRowid: null,
		}
	);
}

let schemaReadyPromise: Promise<void> | null = null;

/**
 * 幂等冷启动建表：所有时间字段均使用 TEXT 字符串存储，严禁存入二进制 BLOB。
 */
export async function ensureTursoSchema(): Promise<boolean> {
	if (!isTursoConfigured()) return false;
	if (!schemaReadyPromise) {
		schemaReadyPromise = (async () => {
			await tursoBatch([
				{
					sql: `CREATE TABLE IF NOT EXISTS blog_posts (
						slug TEXT PRIMARY KEY,
						title TEXT NOT NULL,
						description TEXT NOT NULL DEFAULT '',
						content TEXT NOT NULL DEFAULT '',
						image TEXT NOT NULL DEFAULT '',
						category TEXT NOT NULL DEFAULT '',
						tags_json TEXT NOT NULL DEFAULT '[]',
						series TEXT NOT NULL DEFAULT '',
						series_order INTEGER,
						published TEXT NOT NULL,
						updated TEXT NOT NULL DEFAULT '',
						draft INTEGER NOT NULL DEFAULT 0,
						pinned INTEGER NOT NULL DEFAULT 0,
						author TEXT NOT NULL DEFAULT '',
						password TEXT NOT NULL DEFAULT '',
						password_hint TEXT NOT NULL DEFAULT '',
						deleted INTEGER NOT NULL DEFAULT 0,
						created_at TEXT NOT NULL,
						updated_at TEXT NOT NULL
					)`,
				},
				{
					sql: `CREATE TABLE IF NOT EXISTS blog_dynamics (
						id TEXT PRIMARY KEY,
						content TEXT NOT NULL DEFAULT '',
						location TEXT NOT NULL DEFAULT '',
						pinned INTEGER NOT NULL DEFAULT 0,
						published TEXT NOT NULL,
						deleted INTEGER NOT NULL DEFAULT 0,
						created_at TEXT NOT NULL,
						updated_at TEXT NOT NULL
					)`,
				},
				{
					sql: `CREATE TABLE IF NOT EXISTS site_settings (
						key TEXT PRIMARY KEY,
						value_json TEXT NOT NULL,
						updated_at TEXT NOT NULL
					)`,
				},
				{
					sql: `CREATE TABLE IF NOT EXISTS blog_comments (
						id TEXT PRIMARY KEY,
						page_path TEXT NOT NULL,
						author_name TEXT NOT NULL,
						author_email TEXT NOT NULL DEFAULT '',
						author_website TEXT NOT NULL DEFAULT '',
						content TEXT NOT NULL,
						is_admin INTEGER NOT NULL DEFAULT 0,
						approved INTEGER NOT NULL DEFAULT 1,
						created_at TEXT NOT NULL
					)`,
				},
				{
					sql: `CREATE INDEX IF NOT EXISTS idx_blog_comments_path
						ON blog_comments(page_path, created_at DESC)`,
				},
			]);
		})().catch((err) => {
			schemaReadyPromise = null;
			throw err;
		});
	}
	await schemaReadyPromise;
	return true;
}

export function utcNowStr(): string {
	return new Date().toISOString().replace("T", " ").slice(0, 19);
}
