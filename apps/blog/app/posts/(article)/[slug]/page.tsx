import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import MarkdownRenderer from '../../../components/MarkdownRenderer';
import BackButton from '../../../components/BackButton';
import { SERVER_API_URL } from '../../../lib/api';

// Server-side API URL - use internal Docker network URL
const API_BASE_URL = SERVER_API_URL;

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
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/public/posts/${slug}`, { 
      cache: 'no-store' 
    });
    
    if (!res.ok) {
      console.error('Failed to fetch post:', res.status, res.statusText);
      return null;
    }
    
    const json = await res.json();
    if (json.code === 200 && json.data) {
        return {
            id: json.data.id,
            title: json.data.title,
            slug: json.data.slug,
            content: json.data.content,
            summary: json.data.summary,
            coverImage: json.data.coverImage,
            categoryName: json.data.categoryName,
            tags: json.data.tags ? json.data.tags.map((t: any) => t.name) : [],
            viewCount: json.data.viewCount,
            publishedAt: new Date(json.data.publishedAt).toLocaleDateString('zh-CN'),
        };
    }
    return null;
  } catch (error) {
    console.error('Error fetching post:', error);
    return null;
  }
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
          <BackButton fallbackHref="/posts" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Article */}
      <article className="max-w-4xl mx-auto px-4 pt-28 pb-12">
        <BackButton fallbackHref="/posts" className="mb-8" />

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

        <MarkdownRenderer
          content={post.content}
          className="max-w-none"
        />
      </article>
    </div>
  );
}
