import { ArrowRight, Sparkles } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center min-h-screen px-4 text-center">
        {/* 背景效果 */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
        </div>

        {/* 内容 */}
        <div className="relative z-10 max-w-4xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-white/5 border border-white/10">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-gray-300">AI 驱动的智能博客</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
            AetherBlog
          </h1>

          <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
            融合 AI 与现代 Web 技术的下一代博客系统
            <br />
            智能写作、语义搜索、优雅呈现
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/posts"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
            >
              浏览文章
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="/about"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-colors"
            >
              了解更多
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
