import Link from 'next/link';
import TimelineTree from '../components/TimelineTree';

interface Post {
    id: number;
    title: string;
    slug: string;
    summary: string;
    coverImage?: string;
    publishedAt: string;
    viewCount?: number;
    category?: { name: string; slug: string };
    tags?: { name: string; slug: string }[];
}

// Reuse fetching logic (in a real app this should be shared)
async function getPosts(): Promise<Post[]> {
  try {
    const res = await fetch('http://localhost:8080/api/v1/public/posts?pageSize=100', { cache: 'no-store' });
    if (!res.ok) {
        return [];
    }
    const json = await res.json();
    return json.data.list.map((item: any) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      summary: item.summary,
      coverImage: item.coverImage,
      viewCount: item.viewCount,
      publishedAt: new Date(item.publishedAt).toLocaleDateString('zh-CN'),
      category: item.categoryName ? { name: item.categoryName, slug: item.categoryName } : undefined,
      tags: item.tagNames ? item.tagNames.map((name: string) => ({ name, slug: name })) : []
    }));
  } catch (error) {
    console.error('Error fetching posts:', error);
    return [];
  }
}

// Helper to group posts by year and month
function groupPostsByDate(posts: Post[]): any[] {
  const groups: { [year: number]: { [month: number]: any[] } } = {};

  posts.forEach(post => {
    const date = new Date(post.publishedAt);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    if (!groups[year]) groups[year] = {};
    if (!groups[year][month]) groups[year][month] = [];

    groups[year][month].push({
      id: post.id.toString(),
      title: post.title,
      slug: post.slug,
      publishedAt: post.publishedAt
    });
  });

  const archives = Object.keys(groups)
    .sort((a, b) => Number(b) - Number(a))
    .map(year => {
      const months = Object.keys(groups[Number(year)])
        .sort((a, b) => Number(b) - Number(a))
        .map(month => ({
          month: Number(month),
          posts: groups[Number(year)][Number(month)]
        }));
      
      const totalPosts = months.reduce((acc, curr) => acc + curr.posts.length, 0);

      return {
        year: Number(year),
        months,
        totalPosts
      };
    });

  return archives;
}

export default async function TimelinePage() {
    const posts = await getPosts();
    const archives = groupPostsByDate(posts);

    return (
        <div className="min-h-screen bg-background text-white selection:bg-primary/30">
            {/* Header (Same as PostsPage) */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-white/5 py-4">
                <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white font-bold text-lg group-hover:shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-shadow">
                        A
                    </div>
                    <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        AetherBlog
                    </span>
                </Link>
                <nav className="flex gap-6 items-center">
                    <div className="hidden md:flex items-center bg-white/5 rounded-full p-1 border border-white/5">
                        <Link href="/posts" className="px-4 py-1.5 rounded-full text-gray-400 hover:text-white text-sm font-medium transition-all hover:bg-white/5">首页</Link>
                        <Link href="/timeline" className="px-4 py-1.5 rounded-full bg-primary/20 text-primary text-sm font-medium transition-all">时间线</Link>
                    </div>
                    <div className="h-4 w-px bg-white/10 mx-2 hidden md:block"></div>
                    <Link href="/archives" className="text-gray-400 hover:text-white transition-colors text-sm font-medium">归档</Link>
                    <Link href="/friends" className="text-gray-400 hover:text-white transition-colors text-sm font-medium">友链</Link>
                    <Link href="/about" className="text-gray-400 hover:text-white transition-colors text-sm font-medium">关于</Link>
                </nav>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 pt-32 pb-12">
                <div className="relative mb-8 pl-4">
                    <h1 className="text-3xl font-bold text-white mb-2">时间轴</h1>
                    <p className="text-gray-500 text-sm">共 {posts.length} 篇文章，持续创作中...</p>
                    <div className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-primary to-purple-600 rounded-full" />
                </div>
                
                <TimelineTree archives={archives} />
            </main>
        </div>
    );
}
