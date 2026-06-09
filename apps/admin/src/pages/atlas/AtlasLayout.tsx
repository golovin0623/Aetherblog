// Atlas 工作台外壳 —— 把原本散落在侧边栏的 5 个并列入口
// (知识图集 / 图集搜索 / 图集知识点 / 图谱视图 / 图集建议) 收敛为「一个工作台 + 内部 Tab」。
//
// ref: docs/pm/atlas-redesign.md §3.2 信息架构 Before/After
// 这里只渲染顶部 Tab 条 + <Outlet/>；各 Tab 页面保留自己的页头与操作区。
// Reader / KP 详情等沉浸式深页不在本壳之下（见 App.tsx 路由），因此不显示 Tab 条。

import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, Compass, GitBranch, LayoutDashboard, Library, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS: Array<{ to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }> = [
  { to: '/atlas', label: '概览', icon: LayoutDashboard, end: true },
  { to: '/atlas/readings', label: '读物', icon: BookOpen },
  { to: '/atlas/kps', label: '知识点', icon: Library },
  { to: '/atlas/graph', label: '图谱', icon: GitBranch },
  { to: '/atlas/suggestions', label: '建议', icon: Sparkles },
  { to: '/atlas/search', label: '搜索', icon: Search },
];

export default function AtlasLayout() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 overflow-x-auto border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pb-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 pr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
          <Compass className="h-3.5 w-3.5" />
          知识图集
        </span>
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] text-[var(--ink-primary)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-substrate)] hover:text-[var(--ink-primary)]'
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
