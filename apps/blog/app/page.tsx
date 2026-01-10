import { ArrowRight, Sparkles, LayoutGrid } from 'lucide-react';
import { getSiteSettings, getRecentPosts } from './lib/services';
import ArticleCard from './components/ArticleCard';

export const revalidate = 300; // 5 minutes ISR for homepage

export default async function HomePage() {
  const [settings, posts] = await Promise.all([
    getSiteSettings(),
    getRecentPosts(6)
  ]);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
        {/* 背景效果 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl opacity-60" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl opacity-60" />
        </div>

        {/* 内容 */}
        <div className="relative z-10 max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-gray-300">AI 驱动的智能博客</span>
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent leading-tight tracking-tight">
            {settings.siteTitle}
          </h1>

          <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto leading-relaxed">
            {settings.siteDescription}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/posts"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/20"
            >
              浏览文章
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="/about"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-all hover:scale-105 backdrop-blur-sm"
            >
              关于我
            </a>
          </div>
        </div>
      </section>

      {/* Latest Posts Section */}
      {posts.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 py-20">
          <div className="flex items-center justify-between mb-12">
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <LayoutGrid className="w-6 h-6 text-primary" />
              最新发布
            </h2>
            <a href="/posts" className="text-sm text-gray-400 hover:text-primary transition-colors">
              查看全部 →
            </a>
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
