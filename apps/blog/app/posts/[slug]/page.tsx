import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  summary?: string;
  coverImage?: string;
  categoryName?: string;
  tags: string[];
  viewCount: number;
  publishedAt: string;
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getPost(slug: string): Promise<Post | null> {
  // 实际从API获取
  return null;
}

export default async function PostDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">404</h1>
          <p className="text-gray-400 mb-6">文章不存在</p>
          <Link
            href="/posts"
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            返回文章列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-white/10 py-4">
        <div className="max-w-4xl mx-auto px-4">
          <Link href="/" className="text-xl font-bold text-white">
            AetherBlog
          </Link>
        </div>
      </header>

      {/* Article */}
      <article className="max-w-4xl mx-auto px-4 py-12">
        <Link
          href="/posts"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          返回文章列表
        </Link>

        <h1 className="text-4xl font-bold text-white mb-4">{post.title}</h1>

        <div className="flex items-center gap-4 text-sm text-gray-400 mb-8">
          <time>{post.publishedAt}</time>
          {post.categoryName && <span>{post.categoryName}</span>}
          <span>{post.viewCount} 阅读</span>
        </div>

        {post.tags.length > 0 && (
          <div className="flex gap-2 mb-8">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 rounded-full text-xs bg-primary/20 text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div
          className="prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </article>
    </div>
  );
}
