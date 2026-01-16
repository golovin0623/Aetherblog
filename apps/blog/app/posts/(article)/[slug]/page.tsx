import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import MarkdownRenderer from '../../../components/MarkdownRenderer';
import BackButton from '../../../components/BackButton';
import FadeIn from '../../../components/FadeIn';
import CommentSection from '../../../components/CommentSection';
import { SERVER_API_URL } from '../../../lib/api';
import { logger } from '../../../lib/logger';
import { getSiteSettings } from '../../../lib/services';

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
      logger.error('Failed to fetch post:', res.status, res.statusText);
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
    logger.error('Error fetching post:', error);
    return null;
  }
}

export default async function PostDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPost(slug);
  const settings = await getSiteSettings();

  if (!post) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <FadeIn>
          <div className="text-center">
            <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-4">404</h1>
            <p className="text-[var(--text-muted)] mb-6">文章不存在</p>
            <BackButton fallbackHref="/posts" />
          </div>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Article with fade-in animation */}
      <article className="max-w-4xl mx-auto px-4 pt-28 pb-12">
        <FadeIn>
          <BackButton fallbackHref="/posts" className="mb-8" />
        </FadeIn>

        <FadeIn delay={0.1}>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">{post.title}</h1>
        </FadeIn>

        <FadeIn delay={0.15}>
          <div className="flex items-center gap-4 text-sm text-[var(--text-muted)] mb-8">
            <time>{post.publishedAt}</time>
            {post.categoryName && <span>{post.categoryName}</span>}
            <span>{post.viewCount} 阅读</span>
          </div>
        </FadeIn>

        {post.tags.length > 0 && (
          <FadeIn delay={0.2}>
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
          </FadeIn>
        )}

        <FadeIn delay={0.25} duration={0.8}>
          <MarkdownRenderer
            content={post.content}
            className="max-w-none"
          />
        </FadeIn>

        <FadeIn delay={0.3}>
          <CommentSection postId={post.id} settings={settings} />
        </FadeIn>
      </article>
    </div>
  );
}

