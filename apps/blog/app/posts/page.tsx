import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface Post {
  id: number;
  title: string;
  slug: string;
  summary: string;
  coverImage?: string;
  publishedAt: string;
}

// 实际从API获取数据
async function getPosts(): Promise<Post[]> {
  try {
    // 这里直接请求后端 API，注意在 Docker 环境下可能需要用服务名，但在本地开发 localhost:8080 可行
    // 添加 no-store 禁用缓存，方便调试
    const res = await fetch('http://localhost:8080/api/v1/public/posts', { cache: 'no-store' });
    if (!res.ok) {
        // 如果后端没启动或报错，返回空
        console.error('Failed to fetch posts:', res.status, res.statusText);
        return [];
    }
    const json = await res.json();
    return json.data.list.map((item: any) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      summary: item.summary,
      coverImage: item.coverImage,
      publishedAt: item.publishedAt // 格式化由后端或前端处理，这里简化
    }));
  } catch (error) {
    console.error('Error fetching posts:', error);
    return [];
  }
}

export default async function PostsPage() {
  const posts = await getPosts();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-white/10 py-4">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-white">
            AetherBlog
          </Link>
          <nav className="flex gap-6 items-center">
            <Link href="/posts" className="text-primary">文章</Link>
            <Link href="/archives" className="text-gray-400 hover:text-white">归档</Link>
            <Link href="/friends" className="text-gray-400 hover:text-white">友链</Link>
            <Link href="/about" className="text-gray-400 hover:text-white">关于</Link>
            <div className="h-4 w-px bg-white/10 mx-2"></div>
            <a href="http://localhost:5173" target="_blank" className="text-gray-400 hover:text-white text-sm">
              后台管理
            </a>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-8">所有文章</h1>
        
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">暂无文章 (请确认后端已启动并有数据)</p>
          </div>
        ) : (
          <div className="grid gap-6">
            {posts.map((post) => (
              <article
                key={post.id}
                className="p-6 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all"
              >
                <Link href={`/posts/${post.slug}`}>
                  <h2 className="text-xl font-semibold text-white mb-2 hover:text-primary">
                    {post.title}
                  </h2>
                </Link>
                <p className="text-gray-400 mb-4 line-clamp-2">{post.summary}</p>
                <div className="flex items-center justify-between">
                  {/* 使用简单的日期格式化，或者接受后端字符串 */}
                  <time className="text-sm text-gray-500">{new Date(post.publishedAt).toLocaleDateString()}</time>
                  <Link
                    href={`/posts/${post.slug}`}
                    className="text-primary text-sm flex items-center gap-1 hover:underline"
                  >
                    阅读全文 <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
