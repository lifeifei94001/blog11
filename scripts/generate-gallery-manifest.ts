import fs from "node:fs";
import path from "node:path";

const GALLERY_DIR = path.join(process.cwd(), "public", "gallery");
const OUT_FILE = path.join(
	process.cwd(),
	"src",
	"constants",
	"gallery-manifest.json",
);

function buildManifest(): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	if (!fs.existsSync(GALLERY_DIR)) {
		return result;
	}
	const dirs = fs.readdirSync(GALLERY_DIR, { withFileTypes: true });
	for (const entry of dirs) {
		if (!entry.isDirectory()) continue;
		const albumId = entry.name;
		const dir = path.join(GALLERY_DIR, albumId);
		const files = fs
			.readdirSync(dir)
			.filter((f) => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
			.sort();
		const coverIdx = files.findIndex((f) => /^cover\./i.test(f));
		if (coverIdx > 0) {
			const [coverFile] = files.splice(coverIdx, 1);
			files.unshift(coverFile);
		}
		const localPhotos = files.map((f) => `/gallery/${albumId}/${f}`);

		const urlsFile = path.join(dir, "urls.txt");
		let remotePhotos: string[] = [];
		if (fs.existsSync(urlsFile)) {
			remotePhotos = fs
				.readFileSync(urlsFile, "utf-8")
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"));
		}
		result[albumId] = [...localPhotos, ...remotePhotos];
	}
	return result;
}

const manifest = buildManifest();
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(
	OUT_FILE,
	`${JSON.stringify(manifest, null, "\t")}\n`,
	"utf-8",
);
console.log(
	`[GALLERY-MANIFEST] Indexed ${Object.keys(manifest).length} album(s) -> src/constants/gallery-manifest.json`,
);
