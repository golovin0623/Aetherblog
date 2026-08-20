/**
 * @file AetherHubKeepAliveHost.tsx
 * @description 灵境跨页保活宿主 —— 让灵境在离开 /aetherhub 后收成胶囊浮岛而
 * 不是被卸载，从而支持「去模型中心配好服务商 → 一键回到刚才的对话」。
 *
 * 为什么必须保活而不是每次重建：
 *   1. 流式回答挂在页面自己的 AbortController 上，卸载即断流（页面里那条
 *      `卸载即断流` 的 effect）。路由一跳就把生成到一半的回答丢了。
 *   2. 输入框草稿、选中的知识来源 / 文章 / 标签、待发送的图片附件都是组件
 *      state，不进 localStorage —— 卸载后无法还原，「快速返回」名存实亡。
 *
 * 实现取舍：用 visibility 而不是条件渲染或 display:none。
 *   - 条件渲染 = 卸载，见上。
 *   - display:none 会塌掉布局，消息列表的 scrollTop 归零，回来时跳到顶部。
 *   - visibility:hidden 保留布局与滚动位置，且天然不吃指针事件；配合 inert
 *     把整棵子树移出 Tab 序与无障碍树。
 *
 * 生命周期：首次进入 /aetherhub 才挂载（保住 lazy 分包对从不用灵境的用户的
 * 价值），此后常驻；退出登录即整体卸载（连带断流），避免下一个登录者继承上
 * 一个人的草稿与知识来源选择。
 */

import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { spring, transition } from '@aetherblog/ui';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { AetherHubSkeleton } from '@/pages/aetherhub/AetherHubSkeleton';
import { useAetherHubPresenceStore } from '@/stores/aetherHubPresenceStore';
import { useAuthStore } from '@/stores';
import { cn } from '@/lib/utils';

const AetherHubWorkspacePage = lazy(() => import('@/pages/aetherhub/AetherHubWorkspacePage'));

export const AETHERHUB_ROUTE = '/aetherhub';

function normalizePathname(pathname: string) {
  return pathname.replace(/\/+$/, '') || '/';
}

export function AetherHubKeepAliveHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const authorized = useAetherHubPresenceStore((state) => state.authorized);
  const sessionTitle = useAetherHubPresenceStore((state) => state.sessionTitle);
  const streamingCount = useAetherHubPresenceStore((state) => state.streamingCount);
  const clearAuthorized = useAetherHubPresenceStore((state) => state.clearAuthorized);
  const resetPresence = useAetherHubPresenceStore((state) => state.reset);

  const onHub = normalizePathname(location.pathname) === AETHERHUB_ROUTE;
  const [activated, setActivated] = useState(false);
  const [islandHidden, setIslandHidden] = useState(false);

  // 只认 AetherHubRouteAnchor 发的许可（它渲染在 AuthGuard 内部 = /auth/me 已
  // 校验通过）。直接用 authStore 的 persist 布尔值会在令牌过期、校验尚未返回
  // 的窗口里抢先挂载，露出上一位用户的本地会话并发出注定 401 的请求。
  useEffect(() => {
    if (authorized && isAuthenticated) setActivated(true);
  }, [authorized, isAuthenticated]);

  // 身份换人必须在**渲染期**同步断开，不能等 passive effect。
  //
  // /login 没有鉴权守卫，已登录用户可以直接访问并用另一个账号 login()，而
  // login() 只是覆盖 user 并把 isAuthenticated 置 true —— 全程没有 false 态。
  // 若只在 effect 里收尾，保活树会先带着 A 的 sessions、用 B 的身份渲染一次，
  // 其落盘 effect（deps 含 currentUser.id 与 sessions）随即执行
  // scheduleSaveSessions(B, A 的会话) —— sessions.ts 的 storageKey 按 userId
  // 分命名空间，等于把 A 的对话写进 B 的本地存储，卸载时的 flush 还会把这份
  // 快照坐实。
  //
  // 这里用「渲染期自我 setState」（React 官方的 derive-state-on-prop-change
  // 写法）：React 丢弃本次渲染产物、立刻重渲染本组件，**在渲染子树之前**，
  // 于是旧实例根本没机会带着新身份跑一次。
  // `null → 真实 id` 不是换人，而是**首次补齐身份**：authStore 的 partialize 只
  // 持久化 isAuthenticated，硬刷新后 user 要等 AuthGuard 的 /auth/me 回来才有值。
  // 把它误判成换人会当场撤掉 anchor 刚发的许可（anchor 在 Outlet 里、effect 比
  // 本组件先跑），而 anchor 已经挂载、不会再补发 —— 直接进 /aetherhub 会永远停在
  // 骨架屏。开发环境看不出来：StrictMode 的 mark→clear→mark 双调用恰好把它盖住，
  // 生产只跑一次就暴露。因此只认「两侧都非 null 且不相等」这一种真·换人。
  const [ownerUserId, setOwnerUserId] = useState<string | null>(userId);
  if (userId !== null && ownerUserId !== userId) {
    setOwnerUserId(userId);
    if (ownerUserId !== null) {
      setActivated(false);
      setIslandHidden(false);
    }
  }

  // 退出登录 / 被踢下线：整体卸载并撤权。撤权是必须的 —— 留着 authorized=true，
  // 下一个账号一登录（isAuthenticated 转 true）就会在自己的 anchor 跑之前显形。
  useEffect(() => {
    if (isAuthenticated) return;
    setActivated(false);
    setIslandHidden(false);
    clearAuthorized();
    resetPresence();
  }, [isAuthenticated, clearAuthorized, resetPresence]);

  // store 写入是副作用，不能放渲染期，跟在后面收尾即可：此刻 activated 已是
  // false、宿主返回 null，不存在「先显形再撤权」的窗口。判定与上面渲染期那段
  // 保持同一条规则（含跳过首次补齐），否则两者会在硬刷新时打架。
  const settledUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    const prev = settledUserIdRef.current;
    if (userId === null || prev === userId) return;
    settledUserIdRef.current = userId;
    if (prev === null) return;
    clearAuthorized();
    resetPresence();
  }, [userId, clearAuthorized, resetPresence]);

  // 回到灵境本体 = 用户重新表达了「我要用它」，胶囊的手动关闭随之复位。
  useEffect(() => {
    if (onHub) setIslandHidden(false);
  }, [onHub]);

  if (!activated || !isAuthenticated) return null;

  // 显形 = 停在 /aetherhub **且**本次访问已通过 AuthGuard。二者分开的意义：
  // activated 决定「挂不挂载」（保活，一次就够），revealed 决定「给不给看」
  // （每次访问都要重新校验）。cookie 在别的页面上过期后回来，这段窗口里保活树
  // 保持不可见，屏幕上是骨架屏，校验通过才显形、失败则 AuthGuard 直接重定向。
  const revealed = onHub && authorized;
  const streaming = streamingCount > 0;
  const islandVisible = !onHub && !islandHidden;

  return (
    <>
      {/* 校验未回来之前先铺骨架屏，避免这段窗口是一片空白。 */}
      {onHub && !revealed && <AetherHubSkeleton />}

      <div
        className={cn(revealed ? 'visible' : 'invisible')}
        // 折叠期间暂停子树里的 CSS 动画（极光层是 40s infinite）——
        // visibility:hidden 不会让浏览器停掉动画，规则见 index.css。
        data-aetherhub-collapsed={revealed ? 'false' : 'true'}
        aria-hidden={!revealed}
        // inert 让整棵子树退出 Tab 序 —— 光靠 visibility 已经不可聚焦，但
        // 屏幕阅读器的虚拟光标仍可能游进去。React 19 起 inert 收布尔值。
        inert={!revealed}
      >
        <ErrorBoundary>
          <Suspense fallback={revealed ? <AetherHubSkeleton /> : null}>
            {/* onRoute 让页面自己收尾「离开路由」的副作用：关掉 portal 到
                document.body、因而逃出本容器 visibility 的浮层（连同它们持有的
                body 滚动锁与 capture 阶段键盘监听）；重新进入时补做只在挂载期
                跑过一次的一次性工作（工作台交接、模型清单刷新）。 */}
            <AetherHubWorkspacePage onRoute={revealed} />
          </Suspense>
        </ErrorBoundary>
      </div>

      <AnimatePresence>
        {islandVisible && (
          <motion.div
            key="aetherhub-island"
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96, transition: transition.quick }}
            transition={spring.soft}
            // viewport-fit=cover 下 bottom-5 会落进 iPhone home indicator 区域，
            // 按 AGENTS.md 的 max(x, env(safe-area-inset-*)) 惯例避让上来。
            className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-50 print:hidden"
          >
            <div
              className="surface-raised flex items-center gap-2 rounded-full py-1.5 pl-2 pr-1.5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)]"
              data-interactive
            >
              <button
                type="button"
                onClick={() => navigate(AETHERHUB_ROUTE)}
                title="返回灵境"
                className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pl-1 pr-2 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
              >
                <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]">
                  <Sparkles className="h-4 w-4" />
                  {streaming && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--aurora-3)] ring-2 ring-[var(--bg-raised)]"
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                    {streaming ? `生成中 · ${streamingCount}` : '灵境'}
                  </span>
                  <span className="block max-w-[10.5rem] truncate text-[12.5px] font-medium leading-4 text-[var(--ink-primary)]">
                    {sessionTitle || '新对话'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIslandHidden(true)}
                title="隐藏浮岛（灵境继续在后台运行，可从侧栏返回）"
                aria-label="隐藏灵境浮岛"
                // 触控区不额外加伪元素：index.css 的全局
                // `button {min-width:44px;min-height:44px} @media (hover:none) and
                // (pointer:coarse)` 已把这里撑到 44×44（实测），本组件也没像
                // composer 的 ToolButton 那样 !min-w-0 opt-out。再叠 before 只会把
                // 命中区撑到 60px，吃掉与主按钮之间的 gap-2。
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-leaf)] hover:text-[var(--ink-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default AetherHubKeepAliveHost;
