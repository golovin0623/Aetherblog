import TimelineTree from '../components/TimelineTree';
import { SERVER_API_URL } from '../lib/api';
import { logger } from '../lib/logger';

export const revalidate = 300; // 时间线 5 分钟 ISR,与首页一致

interface Post {
  id: number;
  title: string;
  slug: string;
  publishedAt: string;
  passwordRequired?: boolean;
}

interface Archive {
  year: number;
  totalPosts: number;
  months: Array<{
    month: number;
    posts: Array<{
      id: string;
      title: string;
      slug: string;
      publishedAt: string;
      passwordRequired?: boolean;
    }>;
  }>;
}

async function getTimelinePosts(): Promise<Post[]> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/v1/public/posts?pageSize=100`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data?.list || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      publishedAt: new Date(item.publishedAt).toISOString(),
      passwordRequired: item.passwordRequired,
    }));
  } catch (error) {
    logger.error('Failed to fetch timeline posts:', error);
    return [];
  }
}

// 服务端分组 —— 避免在 client 再计算一次
function groupPostsByDate(posts: Post[]): Archive[] {
  const groups: Record<number, Record<number, any[]>> = {};

  for (const post of posts) {
    const date = new Date(post.publishedAt);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    if (!groups[year]) groups[year] = {};
    if (!groups[year][month]) groups[year][month] = [];
    groups[year][month].push({
      id: String(post.id),
      title: post.title,
      slug: post.slug,
      publishedAt: post.publishedAt,
      passwordRequired: post.passwordRequired,
    });
  }

  return Object.keys(groups)
    .sort((a, b) => Number(b) - Number(a))
    .map((year) => {
      const months = Object.keys(groups[Number(year)])
        .sort((a, b) => Number(b) - Number(a))
        .map((month) => ({
          month: Number(month),
          posts: groups[Number(year)][Number(month)],
        }));
      const totalPosts = months.reduce((acc, m) => acc + m.posts.length, 0);
      return { year: Number(year), months, totalPosts };
    });
}

export default async function TimelinePage() {
  const posts = await getTimelinePosts();
  const archives = groupPostsByDate(posts);

  return (
    <div className="min-h-screen bg-background text-[var(--text-primary)] selection:bg-primary/30">
      <main className="max-w-4xl mx-auto px-4 pt-32 pb-24 md:pb-12">
        <div className="relative mb-8 pl-4">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">时间轴</h1>
          <p className="text-[var(--text-muted)] text-sm italic">
            共 {posts.length} 篇文章，好事多磨
          </p>
          <div className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-primary to-accent rounded-full" />
        </div>

        <TimelineTree archives={archives} />
      </main>
    </div>
  );
}
