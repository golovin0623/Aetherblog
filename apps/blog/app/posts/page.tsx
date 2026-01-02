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

// 模拟数据，实际应从API获取
async function getPosts(): Promise<Post[]> {
  return [];
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
          <nav className="flex gap-6">
            <Link href="/posts" className="text-primary">文章</Link>
            <Link href="/archives" className="text-gray-400 hover:text-white">归档</Link>
            <Link href="/friends" className="text-gray-400 hover:text-white">友链</Link>
            <Link href="/about" className="text-gray-400 hover:text-white">关于</Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-8">所有文章</h1>
        
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">暂无文章</p>
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
                  <time className="text-sm text-gray-500">{post.publishedAt}</time>
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
