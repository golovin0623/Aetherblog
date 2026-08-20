import { create } from 'zustand';

/**
 * 灵境「在场」状态 —— 唯一目的是让 AetherHubKeepAliveHost 的胶囊浮岛在不挂载
 * 灵境页面内部状态的前提下，显示当前会话标题与是否正在生成。
 *
 * 为什么用 store 而不是 context：灵境工作台（保活实例）与浮岛是兄弟节点，
 * 中间隔着整个路由 Outlet；提到公共 context 意味着把 9000 行页面的 state
 * 往上抬，而这里只需要单向广播两个标量。
 *
 * 不持久化：刷新后灵境实例本来就没了，残留的「生成中」会是假象。
 */
interface AetherHubPresenceState {
  /**
   * 鉴权已通过的 /aetherhub 访问标记 —— 由 AetherHubRouteAnchor 置位，而它渲染
   * 在 AuthGuard 内部，即「`/auth/me` 校验已完成且通过」。
   *
   * 保活宿主**不能**直接看 authStore 的 `isAuthenticated`：那是 persist 到
   * localStorage 的布尔值，令牌过期后它在 AuthGuard 异步校验返回前仍是 true。
   * 用它当挂载条件，会在校验失败登出之前就把工作台挂起来 —— 既可能露出上一位
   * 用户本地已加载的会话，也会抢先发出一批注定 401 的受保护请求。
   *
   * **每次访问都要重新授权**：anchor 卸载（离开路由）即 clearAuthorized。否则
   * 授权一次就永久生效，用户在别的页面待到 cookie 过期后再回 /aetherhub，保活
   * 树会在新一轮 AuthGuard 校验返回之前就直接显形。
   */
  authorized: boolean;
  /** 会话标题（未命名会话为 null，浮岛回落到「灵境」）。 */
  sessionTitle: string | null;
  /** 正在生成回答的会话数 —— 跨会话并发流时浮岛要显示总数。 */
  streamingCount: number;
  markAuthorized: () => void;
  clearAuthorized: () => void;
  setPresence: (presence: { sessionTitle: string | null; streamingCount: number }) => void;
  /** 只清 sessionTitle / streamingCount；authorized 由 markAuthorized / clearAuthorized 独占。 */
  reset: () => void;
}

const EMPTY_PRESENCE = { sessionTitle: null, streamingCount: 0 } as const;

export const useAetherHubPresenceStore = create<AetherHubPresenceState>()((set) => ({
  authorized: false,
  ...EMPTY_PRESENCE,
  markAuthorized: () => set((state) => (state.authorized ? state : { authorized: true })),
  clearAuthorized: () => set((state) => (state.authorized ? { authorized: false } : state)),
  setPresence: ({ sessionTitle, streamingCount }) =>
    set((state) =>
      state.sessionTitle === sessionTitle && state.streamingCount === streamingCount
        ? state
        : { sessionTitle, streamingCount },
    ),
  // 只清广播字段，**不碰 authorized**：调用方是工作台页面的卸载清理，而授权归
  // AetherHubRouteAnchor 管。混在一起会让页面的卸载（含 StrictMode 的双调用）
  // 顺手撤掉当前访问的授权，宿主随即收起，屏幕上只剩骨架屏。
  reset: () => set({ ...EMPTY_PRESENCE }),
}));
