/**
 * Posts 页面加载骨架屏
 * 在数据加载期间显示，提供流畅的过渡体验
 * 使用 shimmer 动画效果
 */
export default function PostsLoading() {
  return (
    <div className="min-h-screen bg-background text-white">
      <main className="max-w-7xl mx-auto px-4 pt-24 pb-12">
        {/* 顶部区域骨架 */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-12">
          {/* Featured Post 骨架 */}
          <div className="lg:col-span-3 lg:h-[420px] lg:min-h-[420px]">
            <div className="h-full rounded-3xl bg-white/5 border border-white/10 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          </div>
          
          {/* Author Card 骨架 */}
          <div className="lg:col-span-1 lg:h-[420px] lg:min-h-[420px]">
            <div className="h-full rounded-3xl bg-white/5 border border-white/10 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          </div>
        </div>

        {/* 最新发布标题骨架 */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-6 h-6 rounded bg-white/10 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
          <div className="w-24 h-8 rounded bg-white/10 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
        </div>

        {/* 文章卡片网格骨架 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div 
              key={i} 
              className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              {/* 封面图骨架 */}
              <div className="aspect-video bg-white/10 overflow-hidden relative">
                <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </div>
              {/* 内容区骨架 */}
              <div className="p-5 space-y-3">
                <div className="flex justify-between">
                  <div className="w-16 h-4 bg-white/10 rounded overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                  <div className="w-20 h-4 bg-white/10 rounded overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                </div>
                <div className="w-full h-6 bg-white/10 rounded overflow-hidden relative">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
                <div className="w-3/4 h-4 bg-white/10 rounded overflow-hidden relative">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
                <div className="w-1/2 h-4 bg-white/10 rounded overflow-hidden relative">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
