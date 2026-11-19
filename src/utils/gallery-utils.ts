import fs from "node:fs";
import path from "node:path";
import galleryManifest from "@/constants/gallery-manifest.json";
import type { GalleryAlbum } from "@/types/config";
import { url } from "@/utils/url-utils";

function withBase(assetPath: string): string {
	if (!assetPath) return "";
	if (
		/^(https?:)?\/\//i.test(assetPath) ||
		/^(data|blob):/i.test(assetPath) ||
		assetPath.startsWith("/api/")
	) {
		return assetPath;
	}
	const normalizedPath = assetPath.startsWith("/")
		? assetPath
		: `/${assetPath}`;
	const base = import.meta.env.BASE_URL || "/";
	if (base !== "/" && normalizedPath.startsWith(base)) {
		return normalizedPath;
	}
	return url(normalizedPath);
}

/**
 * 扫描相册目录中的所有图片文件（优先读磁盘，Vercel Serverless 环境自动回退构建期清单，再追加后台扩展照片）
 */
export function scanAlbumPhotos(
	albumId: string,
	extraPhotos: string[] = [],
): string[] {
	const dir = path.join(process.cwd(), "public", "gallery", albumId);
	let basePhotos: string[] = [];

	if (fs.existsSync(dir)) {
		const files = fs
			.readdirSync(dir)
			.filter((f) => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
			.sort();
		const coverIdx = files.findIndex((f) => /^cover\./i.test(f));
		if (coverIdx > 0) {
			const [coverFile] = files.splice(coverIdx, 1);
			files.unshift(coverFile);
		}
		const localPhotos = files.map((f) => withBase(`/gallery/${albumId}/${f}`));

		const urlsFile = path.join(dir, "urls.txt");
		let remotePhotos: string[] = [];
		if (fs.existsSync(urlsFile)) {
			remotePhotos = fs
				.readFileSync(urlsFile, "utf-8")
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"));
		}
		basePhotos = [...localPhotos, ...remotePhotos];
	} else {
		const manifestMap = galleryManifest as Record<string, string[]>;
		const fromManifest = Array.isArray(manifestMap[albumId])
			? manifestMap[albumId]
			: [];
		basePhotos = fromManifest.map((item) => withBase(item));
	}

	const mergedExtra = extraPhotos
		.map((item) => withBase(item.trim()))
		.filter(Boolean);

	return Array.from(new Set([...basePhotos, ...mergedExtra]));
}

/**
 * 获取相册封面图
 * 优先级：手动指定 > cover.* 文件 > 第一张图片
 */
export function getAlbumCover(album: GalleryAlbum, photos: string[]): string {
	if (album.cover) return withBase(album.cover);
	const coverFile = photos.find((p) => /\/cover\./i.test(p));
	return coverFile || photos[0] || "";
}
