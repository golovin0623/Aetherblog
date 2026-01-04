/**
 * Timeline 页面加载骨架屏
 * 在数据加载期间显示，提供流畅的过渡体验
 * 使用 shimmer 动画效果
 */
export default function TimelineLoading() {
  return (
    <div className="min-h-screen bg-background text-white selection:bg-primary/30">
      <main className="max-w-4xl mx-auto px-4 pt-32 pb-12">
        {/* 标题骨架 */}
        <div className="relative mb-8 pl-4">
          <div className="w-32 h-9 bg-white/10 rounded overflow-hidden relative mb-2">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
          <div className="w-48 h-4 bg-white/10 rounded overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
          <div className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-primary to-purple-600 rounded-full" />
        </div>

        {/* 时间轴骨架 */}
        <div className="space-y-8">
          {[2024, 2023].map((year) => (
            <div key={year} className="space-y-4">
              {/* 年份骨架 */}
              <div className="flex items-center gap-3">
                <div className="w-16 h-8 bg-white/10 rounded-lg overflow-hidden relative">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
                <div className="w-20 h-5 bg-white/5 rounded-full overflow-hidden relative">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              </div>

              {/* 月份和文章骨架 */}
              {[1, 2, 3].map((month) => (
                <div key={month} className="pl-6 border-l-2 border-white/10 space-y-3">
                  {/* 月份标签 */}
                  <div className="w-12 h-6 bg-white/10 rounded overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                  
                  {/* 文章项骨架 */}
                  {[1, 2].map((post) => (
                    <div key={post} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                      <div className="w-4 h-4 rounded-full bg-white/10 overflow-hidden relative">
                        <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      </div>
                      <div className="flex-1">
                        <div className="w-3/4 h-5 bg-white/10 rounded overflow-hidden relative mb-2">
                          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                        </div>
                        <div className="w-20 h-3 bg-white/5 rounded overflow-hidden relative">
                          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
