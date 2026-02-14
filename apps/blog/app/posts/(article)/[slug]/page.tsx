import { PencilLine } from 'lucide-react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import MarkdownRenderer from '../../../components/MarkdownRenderer';
import BackButton from '../../../components/BackButton';
import FadeIn from '../../../components/FadeIn';
import CommentSection from '../../../components/CommentSection';
import TableOfContents from '../../../components/TableOfContents';
import { SERVER_API_URL } from '../../../lib/api';
import { buildAdminPostEditUrl, getAdminLinkConfig } from '../../../lib/adminUrl';
import { logger } from '../../../lib/logger';
import { getSiteSettings } from '../../../lib/services';

// 服务端 API URL - 使用内部 Docker 网络 URL
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

const MARKDOWN_AUDIT_SLUG = '__markdown_audit__';
const MARKDOWN_AUDIT_FILE = join(process.cwd(), 'docs', 'blog-markdown-regression-sample.md');

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

async function getMarkdownAuditPost(): Promise<Post | null> {
  try {
    const markdownContent = await readFile(MARKDOWN_AUDIT_FILE, 'utf-8');
    return {
      id: -1,
      title: 'Markdown 覆盖样例验收页',
      slug: MARKDOWN_AUDIT_SLUG,
      content: markdownContent,
      summary: '用于验证详情页 Markdown 渲染边界的一次性回归样例。',
      categoryName: 'Regression',
      tags: ['markdown', 'regression', 'audit'],
      viewCount: 0,
      publishedAt: '2026-02-12',
    };
  } catch (error) {
    logger.error('Failed to load markdown regression sample:', error);
    return null;
  }
}

export default async function PostDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const post = slug === MARKDOWN_AUDIT_SLUG ? await getMarkdownAuditPost() : await getPost(slug);
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

  const adminEditUrl = buildAdminPostEditUrl(post.id);
  const adminLinkConfig = getAdminLinkConfig();

  return (
    <div className="min-h-screen bg-background">
      {/* 响应式布局容器：PC端显示侧边目录，移动端隐藏 */}
      <div className="max-w-7xl mx-auto flex justify-center gap-12 px-4 pt-28 pb-12">
        {/* 主要文章内容 */}
        <article className="w-full max-w-4xl min-w-0">
          <FadeIn>
            <BackButton fallbackHref="/posts" className="mb-8" />
          </FadeIn>

          <FadeIn delay={0.1}>
            <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">{post.title}</h1>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)] mb-8">
              <time>{post.publishedAt}</time>
              {post.categoryName && <span>{post.categoryName}</span>}
              <span>{post.viewCount} 阅读</span>
              <div className="flex items-center gap-2 ml-1">
                {adminEditUrl ? (
                  <a
                    href={adminEditUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-primary hover:border-primary/40 transition-colors"
                    title={`编辑文章 #${post.id}`}
                    aria-label={`编辑文章 #${post.id}`}
                  >
                    <PencilLine size={14} />
                  </a>
                ) : (
                  <span
                    className="inline-flex items-center text-xs text-[var(--text-muted)]"
                    title={adminLinkConfig.reason}
                  >
                    编辑入口未配置
                  </span>
                )}
                {/* 目录触发按钮 - 图标形式，在非宽屏下显示，位置紧邻编辑按钮 */}
                <div className="xl:hidden">
                  <TableOfContents content={post.content} variant="icon" />
                </div>
              </div>
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
            {post.id > 0 ? (
              <CommentSection postId={post.id} settings={settings} />
            ) : (
              <div className="mt-10 rounded-lg border border-dashed border-[var(--border-default)] p-4 text-sm text-[var(--text-muted)]">
                当前为 Markdown 样例验收页，不启用评论区。
              </div>
            )}
          </FadeIn>
        </article>

        {/* PC端侧边栏目录 - 仅在宽屏显示且不影响正文布局 */}
        <aside className="hidden xl:block w-72 flex-shrink-0">
          <div className="sticky top-28">
            <FadeIn delay={0.2}>
              <TableOfContents
                content={post.content}
                variant="sidebar"
                className="max-h-[calc(100vh-140px)]"
              />
            </FadeIn>
          </div>
        </aside>
      </div>
    </div>
  );
}
