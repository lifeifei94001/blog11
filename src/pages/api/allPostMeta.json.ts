import { getUnifiedPosts } from "@/lib/blog-store";
import { formatDateToYYYYMMDD } from "@/utils/date-utils";

export const prerender = false;

export async function GET(): Promise<Response> {
	const posts = await getUnifiedPosts(false);

	const allPostsData = posts
		.map((post) => ({
			id: post.slug,
			title: post.data.title,
			description: post.data.description,
			published: post.data.published.getTime(),
			publishedDate: formatDateToYYYYMMDD(post.data.published),
			category: post.data.category || "",
			password: !!post.data.password,
		}))
		// 日历按纯日期排序，忽略置顶
		.sort((a, b) => b.published - a.published);

	return new Response(JSON.stringify(allPostsData), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}
