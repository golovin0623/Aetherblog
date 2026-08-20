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
  /** 会话标题（未命名会话为 null，浮岛回落到「灵境」）。 */
  sessionTitle: string | null;
  /** 正在生成回答的会话数 —— 跨会话并发流时浮岛要显示总数。 */
  streamingCount: number;
  setPresence: (presence: { sessionTitle: string | null; streamingCount: number }) => void;
  reset: () => void;
}

const EMPTY = { sessionTitle: null, streamingCount: 0 } as const;

export const useAetherHubPresenceStore = create<AetherHubPresenceState>()((set) => ({
  ...EMPTY,
  setPresence: ({ sessionTitle, streamingCount }) =>
    set((state) =>
      state.sessionTitle === sessionTitle && state.streamingCount === streamingCount
        ? state
        : { sessionTitle, streamingCount },
    ),
  reset: () => set({ ...EMPTY }),
}));
