/**
 * 媒体网格骨架屏组件
 * @ref Phase 6: 性能优化 - 骨架屏加载状态
 */

interface MediaGridSkeletonProps {
  count?: number;
}

export function MediaGridSkeleton({ count = 12 }: MediaGridSkeletonProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="relative bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-hidden"
        >
          {/* 图片区域骨架 */}
          <div className="aspect-square bg-gradient-to-br from-white/5 to-white/10 animate-pulse" />

          {/* 信息区域骨架 */}
          <div className="p-4 space-y-3">
            {/* 文件名骨架 */}
            <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: '80%' }} />

            {/* 元数据骨架 */}
            <div className="flex items-center gap-2">
              <div className="h-3 bg-white/5 rounded animate-pulse" style={{ width: '40%' }} />
              <div className="h-3 bg-white/5 rounded animate-pulse" style={{ width: '30%' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 媒体列表骨架屏组件
 */
export function MediaListSkeleton({ count = 10 }: MediaGridSkeletonProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-4 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl"
        >
          {/* 缩略图骨架 */}
          <div className="w-16 h-16 bg-gradient-to-br from-white/5 to-white/10 rounded-lg animate-pulse" />

          {/* 信息骨架 */}
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: '60%' }} />
            <div className="h-3 bg-white/5 rounded animate-pulse" style={{ width: '40%' }} />
          </div>

          {/* 操作按钮骨架 */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white/5 rounded-lg animate-pulse" />
            <div className="w-8 h-8 bg-white/5 rounded-lg animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 文件夹树骨架屏组件
 */
export function FolderTreeSkeleton({ count = 8 }: MediaGridSkeletonProps) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2">
          {/* 展开图标骨架 */}
          <div className="w-4 h-4 bg-white/5 rounded animate-pulse" />

          {/* 文件夹图标骨架 */}
          <div className="w-5 h-5 bg-white/5 rounded animate-pulse" />

          {/* 文件夹名称骨架 */}
          <div
            className="h-3 bg-white/5 rounded animate-pulse"
            style={{ width: `${60 + Math.random() * 30}%` }}
          />

          {/* 文件数量徽章骨架 */}
          <div className="ml-auto w-8 h-5 bg-white/5 rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}
