/**
 * 友链页骨架屏 —— 严格镜像「星群与信笺」的最终布局
 * (居中页头 + 胶囊切换器 + iOS 通知栈),加载完成零视觉跳变。
 * 骨骼色全部取自 Codex 令牌,亮暗主题自动正确。
 */

const BONE_STRONG = 'color-mix(in oklch, var(--ink-primary) 9%, transparent)';
const BONE_SOFT = 'color-mix(in oklch, var(--ink-primary) 5%, transparent)';

function Bone({ className }: { className: string }) {
  return <div className={className} style={{ background: BONE_STRONG }} />;
}

function SoftBone({ className }: { className: string }) {
  return <div className={className} style={{ background: BONE_SOFT }} />;
}

export default function FriendsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-24 md:pb-16">
        {/* 页头骨架(居中) */}
        <div className="mb-8 flex flex-col items-center md:mb-10" aria-hidden="true">
          <Bone className="h-3 w-28 rounded-full" />
          <Bone className="mt-4 h-9 w-52 rounded-lg md:h-11 md:w-64" />
          <SoftBone className="mt-4 h-5 w-72 max-w-full rounded-md" />
          <SoftBone className="mt-4 h-3 w-40 rounded-full" />
        </div>

        {/* 切换器骨架 */}
        <div className="mb-10 flex justify-center md:mb-12" aria-hidden="true">
          <Bone className="h-10 w-44 rounded-full" />
        </div>

        {/* 通知栈骨架 */}
        <div
          className="mx-auto flex w-full max-w-2xl flex-col gap-2.5"
          role="status"
          aria-label="友链加载中"
        >
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="surface-leaf relative overflow-hidden rounded-2xl px-4 py-3.5 md:px-5 md:py-4"
            >
              {/* 光扫 shimmer */}
              <div
                className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite]"
                style={{
                  background: `linear-gradient(90deg, transparent, ${BONE_SOFT}, transparent)`,
                }}
                aria-hidden="true"
              />
              <div className="relative flex items-start gap-3.5 md:gap-4">
                {/* squircle 头像骨架 */}
                <Bone className="h-11 w-11 flex-shrink-0 rounded-[var(--radius-md)] md:h-12 md:w-12" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center justify-between gap-3">
                    <Bone className="h-4 w-24 rounded-md" />
                    <SoftBone className="h-3 w-20 rounded-md" />
                  </div>
                  <SoftBone className="mt-2.5 h-3 w-3/4 rounded-md" />
                  <SoftBone className="mt-1.5 h-3 w-1/2 rounded-md" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
