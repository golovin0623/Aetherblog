import Link from 'next/link';
import { ArrowRight, LayoutGrid, ChevronDown } from 'lucide-react';
import { getRecentPosts, getSiteSettings } from './lib/services';
import ArticleCard from './components/ArticleCard';
import HeroParallaxContent from './components/HeroParallaxContent';
import { ProfileMusicPlayer } from './components/ProfileMusicPlayer';
import SiteFooter from './components/SiteFooter';
import StackedParallax from './components/StackedParallax';

export const revalidate = 300; // 首页 5 分钟 ISR (增量静态再生)

// 安全性（VULN-081）：welcome CTA 的 link 来自 site_settings（admin 可写）。
// 若有人把 link 改成 `javascript:alert(1)` 或 `//evil.com`，用户点击就出事。
// 仅允许站内绝对路径（单 '/' 开头，不能是 '//'）；越界时回落到合理默认。
function safeInternalHref(raw: string | undefined | null, fallback: string): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  return trimmed;
}

export default async function HomePage() {
  const [posts, settings] = await Promise.all([
    getRecentPosts(6),
    getSiteSettings()
  ]);

  // 欢迎页显示由「欢迎页设置 → 启用欢迎页」(welcome_enabled) 单一控制，关闭则直接展示文章列表。
  // 旧 show_banner 已从后台 UI 收敛掉，不再参与判定——否则其残留的 false 值在 UI 移除后无处可改，
  // 会把欢迎页永久关死（详见 PR 评审「Keep the legacy banner switch reachable」）。
  const showBanner = settings.welcome_enabled !== 'false' && settings.welcome_enabled !== false;

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
            {/* AI 徽标 —— 签名级标识:暗色磨砂玻璃药丸 + 沿边缓慢旋转的极光光弧(.ai-badge::before)
                + 自绘渐变火花微闪(.ai-badge__spark)。不再是「扁平灰胶囊 + 通用 lucide 火花」,
                而是用站点极光语言传达「智能/在线」的高级感;外辉与下方紫色 CTA、标题极光渐变同源。 */}
            <div className="ai-badge mb-6 inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklch,var(--bg-raised)_72%,transparent)] px-4 py-1.5 [backdrop-filter:blur(12px)_saturate(150%)] shadow-[0_10px_30px_-12px_color-mix(in_oklch,var(--aurora-1)_50%,transparent),0_0_22px_-8px_color-mix(in_oklch,var(--aurora-1)_42%,transparent)]">
              <span
                className="ai-badge__spark flex h-4 w-4 shrink-0 [filter:drop-shadow(0_0_5px_color-mix(in_oklch,var(--aurora-1)_60%,transparent))]"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <defs>
                    <linearGradient id="aiSparkGrad" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
                      <stop stopColor="var(--aurora-1)" />
                      <stop offset="0.5" stopColor="var(--aurora-3)" />
                      <stop offset="1" stopColor="var(--aurora-4)" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M12 1.8C12.42 7.78 16.22 11.58 22.2 12C16.22 12.42 12.42 16.22 12 22.2C11.58 16.22 7.78 12.42 1.8 12C7.78 11.58 11.58 7.78 12 1.8Z"
                    fill="url(#aiSparkGrad)"
                  />
                </svg>
              </span>
              <span className="text-[13px] font-medium tracking-[0.04em] text-[color-mix(in_oklch,var(--ink-primary)_82%,var(--aurora-1))]">
                AI 驱动的智能博客
              </span>
            </div>

            <h1
              className="font-display text-[clamp(3rem,7vw,5.5rem)] font-semibold mb-6 pb-2 bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] bg-clip-text text-transparent leading-[1.05] tracking-[-0.02em]"
              style={{
                animation: 'breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1) infinite',
                textWrap: 'balance' as unknown as 'inherit',
              }}
            >
              {settings?.welcome_title || 'AetherBlog'}
            </h1>

            <div className="mb-8 max-w-2xl mx-auto space-y-2">
              <p className="font-editorial italic text-[var(--text-primary)] text-xl md:text-2xl leading-relaxed" style={{ textWrap: 'balance' as unknown as 'inherit' }}>
                {settings?.welcome_subtitle || '融合 AI 与现代 Web 技术的下一代博客系统'}
              </p>
              <p className="text-base md:text-lg text-[var(--text-muted)] leading-relaxed">
                {settings?.welcome_description || '智能写作、语义搜索、优雅呈现'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                href={safeInternalHref(settings?.welcome_primary_btn_link, '/posts')}
                className="hero-primary-btn group inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl text-white font-medium min-w-40"
              >
                <span className="hero-btn-shimmer" aria-hidden="true" />
                <span className="relative z-10">{settings?.welcome_primary_btn_text || '浏览文章'}</span>
                <ArrowRight className="relative z-10 w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href={safeInternalHref(settings?.welcome_secondary_btn_link, '/about')}
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
      <div
        data-theme-book-page
        className={`relative z-20 pb-8 bg-[var(--bg-primary)] dark:bg-[#101018] ${showBanner ? '-mt-[100px] pt-[100px] rounded-t-[46px] shadow-[0_-4px_12px_rgba(0,0,0,0.03),0_-12px_32px_rgba(0,0,0,0.05),0_-32px_80px_rgba(0,0,0,0.08)] dark:shadow-[0_-2px_8px_rgba(255,255,255,0.04),0_-8px_24px_rgba(255,255,255,0.03),0_-24px_64px_rgba(255,255,255,0.02)] border-t border-[var(--border-subtle)]/50 dark:border-white/10' : ''}`}
      >
        
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
          <ProfileMusicPlayer surface="home" className="mx-auto max-w-3xl" />

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
                  <h2 className="font-display text-h3 md:text-h2 bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">
                    最新发布
                  </h2>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)] mt-2 tabular-nums">
                    {posts.length} posts
                  </p>
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
                contentPreview={post.contentPreview}
                category={post.categoryName ? { name: post.categoryName, slug: post.categoryName } : undefined}
                tags={post.tagNames?.map(name => ({ name, slug: name }))}
                publishedAt={new Date(post.publishedAt).toLocaleDateString('zh-CN')}
                viewCount={post.viewCount}
                index={index}
                passwordRequired={post.passwordRequired}
              />
            ))}
          </div>
        </section>
      )}
      </StackedParallax>
      </div>
      <SiteFooter />
    </div>
  );
}
