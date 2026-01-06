'use client';

/**
 * 友链页面的高级骨架屏加载状态
 * 严格对齐 FriendCard 的视觉样式，避免加载完成时的视觉跳变
 */
export default function FriendsLoading() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="relative block overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
        >
          {/* 模拟顶部的微弱渐变背景 (中性色) */}
          <div 
            className="absolute inset-0 opacity-20"
            style={{ background: 'linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02))' }}
          />

          {/* 顶部微弱高亮边线占位 */}
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-40" />

          {/* 动态光扫过效果 (Shimmer) */}
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />

          {/* 内容布局 (完全对应 FriendCard p-5 flex items-start gap-4) */}
          <div className="relative p-5 flex items-start gap-4">
            {/* 头像占位 (对应 w-14 h-14 rounded-full) */}
            <div className="relative flex-shrink-0">
               <div className="w-14 h-14 rounded-full bg-white/10" />
            </div>

            {/* 文本区域占位 */}
            <div className="flex-1 min-w-0 pt-1 space-y-3">
              {/* 标题占位 (h-5 approx 20px, similar to text-lg) */}
              <div className="h-5 w-24 bg-white/10 rounded-md" />
              
              {/* 描述占位 (对应两行文字) */}
              <div className="space-y-2">
                <div className="h-3 w-3/4 bg-white/5 rounded-md" />
                <div className="h-3 w-1/2 bg-white/5 rounded-md" />
              </div>
            </div>
          </div>
          
          {/* 确保高度撑开，模拟 FriendCard 的自然高度 */}
          <div className="h-2" />
        </div>
      ))}
    </div>
  );
}
