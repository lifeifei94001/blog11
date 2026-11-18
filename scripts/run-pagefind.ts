import { spawnSync } from "node:child_process";
import { glob } from "glob";
import { resolveSiteRoot } from "./site-root";

const siteRoot = resolveSiteRoot();
const htmlFiles = await glob(`${siteRoot}/**/*.html`);

if (htmlFiles.length === 0) {
	console.log("ℹ No static HTML files to index with Pagefind, skipping.");
	process.exit(0);
}

const result = spawnSync("pagefind", ["--site", siteRoot], {
	stdio: "inherit",
	shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
