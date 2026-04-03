import Link from 'next/link';
import { ArrowRight, Sparkles, LayoutGrid, ChevronDown } from 'lucide-react';
import { getRecentPosts, getSiteSettings } from './lib/services';
import ArticleCard from './components/ArticleCard';
import HeroParallaxContent from './components/HeroParallaxContent';
import StackedParallax from './components/StackedParallax';

export const revalidate = 300; // 首页 5 分钟 ISR (增量静态再生)

export default async function HomePage() {
  const [posts, settings] = await Promise.all([
    getRecentPosts(6),
    getSiteSettings()
  ]);

  // show_banner 控制欢迎页显示，关闭则直接展示文章列表
  const showBanner = settings.show_banner !== 'false' && settings.show_banner !== false
    && settings.welcome_enabled !== 'false' && settings.welcome_enabled !== false;

  return (
    <div className="min-h-screen">
      {/* 顶部展示区 - 受 show_banner 控制 */}
      {showBanner && (
      <section className="relative flex flex-col items-center justify-center min-h-screen px-4 text-center">
        {/* 背景效果 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full theme-transition-glow"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
          <div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/20 rounded-full theme-transition-glow"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
        </div>

        {/* 视差滚动全屏包装器 - 让中心文字与滚动光点共同接受位移与虚化效果 */}
        <HeroParallaxContent className="absolute inset-0 w-full h-full flex flex-col items-center justify-center">
          {/* 中心内容 */}
          <div className="relative z-10 max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-[var(--bg-card)] border border-[var(--border-default)] backdrop-blur-md">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm text-[var(--text-secondary)]">AI 驱动的智能博客</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 pb-2 bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] bg-clip-text text-transparent leading-[1.15] tracking-tight">
              {settings?.welcome_title || 'AetherBlog'}
            </h1>

            <div className="text-xl text-[var(--text-secondary)] mb-8 max-w-2xl mx-auto leading-relaxed space-y-2">
              <p className="font-medium text-[var(--text-primary)]">
                {settings?.welcome_subtitle || '融合 AI 与现代 Web 技术的下一代博客系统'}
              </p>
              <p className="text-lg text-[var(--text-muted)]">
                {settings?.welcome_description || '智能写作、语义搜索、优雅呈现'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                href={settings?.welcome_primary_btn_link || '/posts'}
                className="hero-primary-btn group inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl text-white font-medium min-w-40"
              >
                <span className="hero-btn-shimmer" aria-hidden="true" />
                <span className="relative z-10">{settings?.welcome_primary_btn_text || '浏览文章'}</span>
                <ArrowRight className="relative z-10 w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href={settings?.welcome_secondary_btn_link || '/about'}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-default)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card-hover)] transition-all hover:scale-105 backdrop-blur-sm w-36"
              >
                {settings?.welcome_secondary_btn_text || '关于我'}
              </Link>
            </div>
          </div>

          {/* 滚动指示器，随容器一起视差位移 */}
          {posts.length > 0 && (
            <a
              href="#latest-posts"
              className="hero-scroll-indicator md:hidden"
              aria-label="下滑查看最新发布"
            >
              <span className="hero-scroll-indicator__runner" aria-hidden="true" />
            </a>
          )}
        </HeroParallaxContent>
      </section>
      )}

      {/* 叠层书页效果容器 */}
      <div className={`relative z-20 pb-8 bg-[var(--bg-primary)] dark:bg-[#101018] ${showBanner ? '-mt-[100px] pt-[100px] rounded-t-[46px] shadow-[0_-4px_12px_rgba(0,0,0,0.03),0_-12px_32px_rgba(0,0,0,0.05),0_-32px_80px_rgba(0,0,0,0.08)] dark:shadow-[0_-2px_8px_rgba(255,255,255,0.04),0_-8px_24px_rgba(255,255,255,0.03),0_-24px_64px_rgba(255,255,255,0.02)] border-t border-[var(--border-subtle)]/50 dark:border-white/10' : ''}`}>
        
        {/* 隐藏的可点击热区，覆盖顶部的圆角书页区域，实现点击空白区域自动下滑 */}
        {showBanner && (
        <a
          href="#latest-posts"
          className="absolute top-0 left-0 w-full h-[100px] z-30 rounded-t-[46px] cursor-pointer"
          title="点击即可阅读最新内容"
          aria-label="点击下滑查看最新内容"
        />
        )}

      {/* 叠层视差容器：滑动时消耗顶部 pt-100 的巨大空隙 */}
      <StackedParallax>
      {/* 最新文章区域 */}
      {posts.length > 0 && (
        <section id="latest-posts" className="max-w-7xl mx-auto px-4 pt-12 pb-28 md:pb-20 scroll-mt-32">
          {/* 带有装饰元素的区域标题 */}
          <div className="relative mb-12">
            {/* 背景光晕 */}
            <div className="absolute -top-8 left-0 w-64 h-32 bg-gradient-to-r from-primary/10 to-accent/10 blur-3xl rounded-full"></div>

            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/30">
                  <LayoutGrid className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">
                    最新发布
                  </h2>
                  <p className="text-sm text-[var(--text-muted)] mt-1">共 {posts.length} 篇文章</p>
                </div>
              </div>
              <Link
                href="/posts"
                className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-default)] hover:border-primary/50 text-[var(--text-secondary)] hover:text-primary transition-all hover:shadow-lg hover:shadow-primary/10"
              >
                <span className="text-sm font-medium">查看全部</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
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
                passwordRequired={post.passwordRequired}
                priority={index < 6}
              />
            ))}
          </div>
        </section>
      )}
      </StackedParallax>
      </div>
    </div>
  );
}
