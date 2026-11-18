import { existsSync } from "node:fs";

/**
 * 构建产物根目录。
 *
 * Vercel 适配器（@astrojs/vercel）输出静态资源到 .vercel/output/static；
 * Cloudflare Pages 上启用 @astrojs/cloudflare 时输出到 dist/client；
 * 本地纯静态构建时输出到 dist。
 */
export function resolveSiteRoot(): string {
	if (existsSync(".vercel/output/static")) return ".vercel/output/static";
	if (existsSync("dist/client")) return "dist/client";
	return "dist";
}
