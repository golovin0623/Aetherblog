/**
 * 文章详情页加载骨架屏
 * 专门为阅读全文设计的加载效果，模拟文章详情页的布局
 */
export default function PostDetailLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* 主要是模拟文章容器 */}
      <article className="max-w-4xl mx-auto px-4 pt-28 pb-12">
        {/* 返回按钮骨架 */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-24 h-4 rounded bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
        </div>

        {/* 标题骨架 */}
        <div className="w-3/4 h-12 rounded-xl bg-white/10 mb-6 overflow-hidden relative">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>

        {/* 元数据骨架 (日期, 分类, 阅读量) */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-20 h-4 rounded bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
          <div className="w-16 h-4 rounded bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
          <div className="w-24 h-4 rounded bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
        </div>

        {/* 标签骨架 */}
        <div className="flex gap-2 mb-12">
          <div className="w-16 h-6 rounded-full bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
          <div className="w-16 h-6 rounded-full bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
          <div className="w-16 h-6 rounded-full bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
        </div>

        {/* 正文内容骨架 - 模拟多段落 */}
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="w-full h-4 rounded bg-white/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
            <div className="w-full h-4 rounded bg-white/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
            <div className="w-11/12 h-4 rounded bg-white/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
            <div className="w-4/5 h-4 rounded bg-white/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
          </div>

          <div className="w-full h-64 rounded-2xl bg-white/5 overflow-hidden relative">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          </div>

          <div className="space-y-3">
            <div className="w-full h-4 rounded bg-white/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
            <div className="w-full h-4 rounded bg-white/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
            <div className="w-5/6 h-4 rounded bg-white/5 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
