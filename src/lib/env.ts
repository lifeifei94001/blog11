/**
 * 唯一环境变量防呆清洗函数。
 * 兼容 Vercel / Node `process.env` 与 Astro `import.meta.env`，
 * 自动剥离误粘贴的反引号、单双引号和首尾空格。
 */
export function stripCleanEnvValue(raw: string | undefined | null): string {
	return (raw ?? "")
		.trim()
		.replace(/^[`'"]+|[`'"]+$/g, "")
		.trim();
}

export function getCleanEnv(keyName: string): string {
	const procEnv =
		typeof process !== "undefined" && process.env ? process.env : undefined;
	if (procEnv) {
		if (Object.hasOwn(procEnv, keyName)) {
			const val = stripCleanEnvValue(procEnv[keyName]);
			if (val) return val;
		}
		for (const [k, v] of Object.entries(procEnv)) {
			if (stripCleanEnvValue(k) === keyName) {
				const cleaned = stripCleanEnvValue(v);
				if (cleaned) return cleaned;
			}
		}
	}

	const metaEnv = import.meta.env as Record<string, string | undefined>;
	if (metaEnv && Object.hasOwn(metaEnv, keyName)) {
		return stripCleanEnvValue(metaEnv[keyName]);
	}
	return "";
}
