import { ArrowRight, Sparkles, LayoutGrid } from 'lucide-react';
import { getRecentPosts } from './lib/services';
import ArticleCard from './components/ArticleCard';

export const revalidate = 300; // 5 minutes ISR for homepage

export default async function HomePage() {
  const [posts] = await Promise.all([
    getRecentPosts(6)
  ]);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center min-h-screen px-4 text-center">
        {/* 背景效果 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
          <div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
        </div>

        {/* 内容 */}
        <div className="relative z-10 max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-[var(--bg-card)] border border-[var(--border-default)] backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-[var(--text-secondary)]">AI 驱动的智能博客</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] bg-clip-text text-transparent leading-tight tracking-tight">
            AetherBlog
          </h1>

          <p className="text-xl text-[var(--text-secondary)] mb-8 max-w-2xl mx-auto leading-relaxed">
            融合 AI 与现代 Web 技术的下一代博客系统
            <br />
            智能写作、语义搜索、优雅呈现
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="/posts"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/20 w-36"
            >
              浏览文章
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="/about"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-default)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card-hover)] transition-all hover:scale-105 backdrop-blur-sm w-36"
            >
              关于我
            </a>
          </div>
        </div>
      </section>

      {/* Elegant Divider with Gradient Line */}
      <div className="relative max-w-7xl mx-auto px-4 py-16">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-[var(--border-subtle)]"></div>
        </div>
        <div className="relative flex justify-center">
          <div className="px-8 py-3 bg-[var(--bg-primary)] rounded-full border border-[var(--border-default)] backdrop-blur-xl shadow-lg">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-gradient-to-r from-primary to-purple-500 animate-pulse"></div>
              <span className="text-sm font-medium bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
                精选内容
              </span>
              <div className="w-2 h-2 rounded-full bg-gradient-to-r from-primary to-purple-500 animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Latest Posts Section */}
      {posts.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 pb-20">
          {/* Section Header with Decorative Elements */}
          <div className="relative mb-12">
            {/* Background Glow */}
            <div className="absolute -top-8 left-0 w-64 h-32 bg-gradient-to-r from-primary/10 to-purple-500/10 blur-3xl rounded-full"></div>

            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-500 shadow-lg shadow-primary/30">
                  <LayoutGrid className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">
                    最新发布
                  </h2>
                  <p className="text-sm text-[var(--text-muted)] mt-1">共 {posts.length} 篇文章</p>
                </div>
              </div>
              <a
                href="/posts"
                className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-default)] hover:border-primary/50 text-[var(--text-secondary)] hover:text-primary transition-all hover:shadow-lg hover:shadow-primary/10"
              >
                <span className="text-sm font-medium">查看全部</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post, index) => (
              <ArticleCard
                key={post.id}
                title={post.title}
                slug={post.slug}
                summary={post.summary}
                coverImage={post.coverImage}
                category={post.categoryName ? { name: post.categoryName, slug: post.categoryName } : undefined}
                tags={post.tagNames?.map(name => ({ name, slug: name }))}
                publishedAt={new Date(post.publishedAt).toLocaleDateString('zh-CN')}
                viewCount={post.viewCount}
                index={index}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

