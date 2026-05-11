import { useState, useEffect, useMemo, useRef } from 'react';
import type { ElementType } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Sparkles,
  BrainCircuit,
  Wand2,
  ListTree,
  Languages,
  PenLine,
  FileEdit,
  Wrench,
  Plus,
  Settings2,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Layers3,
  Workflow,
  BadgeCheck,
  GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AIToolsWorkspace } from '@/components/ai/AIToolsWorkspace';
import { CustomToolModal } from '@/components/ai/CustomToolModal';
import { aiProviderService, AiTaskType } from '@/services/aiProviderService';
import { useAiToolTarget } from '@/hooks/useAiToolTarget';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const SYSTEM_TOOLS = [
  {
    code: 'summary',
    name: '生成摘要',
    description: '提炼文章核心要点',
    icon: BrainCircuit,
    impact: '内容资产',
    outcome: '摘要卡片',
    applyTarget: '文章摘要',
  },
  {
    code: 'tags',
    name: '智能标签',
    description: '推荐相关标签',
    icon: Wand2,
    impact: '检索增长',
    outcome: '标签策略',
    applyTarget: '文章标签',
  },
  {
    code: 'titles',
    name: '标题建议',
    description: '基于正文生成多个标题建议',
    icon: FileEdit,
    impact: '点击转化',
    outcome: '标题候选',
    applyTarget: '标题选择',
  },
  {
    code: 'outline',
    name: '生成大纲',
    description: '生成结构化文章提纲',
    icon: ListTree,
    impact: '结构规划',
    outcome: '文章骨架',
    applyTarget: '正文结构',
  },
  {
    code: 'polish',
    name: '全文润色',
    description: '优化表达、语气与可读性',
    icon: PenLine,
    impact: '质量提升',
    outcome: '润色正文',
    applyTarget: '正文替换',
  },
  {
    code: 'translate',
    name: '全文翻译',
    description: '将正文翻译为指定语言',
    icon: Languages,
    impact: '多语言',
    outcome: '本地化稿件',
    applyTarget: '正文替换',
  },
];

const SYSTEM_ORDER_KEY = 'ai-tools-system-order';
const CUSTOM_ORDER_KEY = 'ai-tools-custom-order';

type PromptConfig = {
  task_type: string;
  default_prompt: string;
  custom_prompt: string | null;
};

const loadOrder = (key: string) => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const persistOrder = (key: string, order: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(order));
  } catch {
    // 忽略存储相关错误
  }
};

const syncOrder = (current: string[], nextIds: string[]) => {
  const nextSet = new Set(nextIds);
  const filtered = current.filter((id) => nextSet.has(id));
  const missing = nextIds.filter((id) => !filtered.includes(id));
  return [...filtered, ...missing];
};

const isNonNullable = <T,>(value: T): value is NonNullable<T> => {
  return value !== null && value !== undefined;
};

const applyOrder = <T,>(items: T[], order: string[], getId: (item: T) => string) => {
  if (!order.length) return items;
  const lookup = new Map(items.map((item) => [getId(item), item]));
  const ordered = order.map((id) => lookup.get(id)).filter(isNonNullable);
  const used = new Set(order);
  const rest = items.filter((item) => !used.has(getId(item)));
  return [...ordered, ...rest];
};

export default function AIToolsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const target = useAiToolTarget();
  const [selectedToolId, setSelectedToolId] = useState(() => searchParams.get('tool') || 'summary');
  const [customTools, setCustomTools] = useState<AiTaskType[]>([]);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 处理 URL 驱动的深链：?tool=summary&postId=123
  // - tool：预选工具
  // - postId：作为目标文章（在 useAiToolTarget 中触发从数据库刷新）
  // 仅在挂载时消费一次 —— 后续 URL 变化不会覆盖用户状态。
  useEffect(() => {
    const urlTool = searchParams.get('tool');
    const urlPostId = searchParams.get('postId');
    let mutated = false;
    const next = new URLSearchParams(searchParams);
    if (urlTool) {
      setSelectedToolId(urlTool);
      next.delete('tool');
      mutated = true;
    }
    if (urlPostId) {
      const parsed = Number(urlPostId);
      if (Number.isFinite(parsed)) {
        target.setTargetPostId(parsed);
      }
      next.delete('postId');
      mutated = true;
    }
    if (mutated) {
      // 清除参数，防止刷新时再次触发流程。
      setSearchParams(next, { replace: true });
    }
  }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const systemCodes = useMemo(() => SYSTEM_TOOLS.map(t => t.code), []);
  const [systemOrder, setSystemOrder] = useState<string[]>(systemCodes);
  const [customOrder, setCustomOrder] = useState<string[]>([]);

  // 挂载后从 localStorage 恢复排序，防止 SSR 不一致
  useEffect(() => {
    setSystemOrder(syncOrder(loadOrder(SYSTEM_ORDER_KEY), systemCodes));
    setCustomOrder(loadOrder(CUSTOM_ORDER_KEY));
  }, [systemCodes]);

  // 自定义工具管理状态
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingTool, setEditingTool] = useState<AiTaskType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 移动端侧边栏状态
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // 移动端工具标签栏滚动引用
  const toolTabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [promptsRes, tasksRes] = await Promise.all([
        aiProviderService.listPromptConfigs(),
        aiProviderService.listTasks()
      ]);

      if (promptsRes.code === 200) setPromptConfigs(promptsRes.data || []);
      if (tasksRes.code === 200) {
        // 过滤：
        // 1) 系统工具已在 SYSTEM_TOOLS 中硬编码，数据库里可能存在同名副本，去重。
        // 2) 非 chat 类任务（embedding / tts / stt 等）不适合"生成→应用到文章"
        //    的工具箱范式——embedding 产生的是向量，没有可插入的文本。这些
        //    任务应该在「索引管理 / RAG 配置」模块里单独呈现，而不是混入此处
        //    给用户制造"工具可用"的错觉。
        const systemCodes = SYSTEM_TOOLS.map(t => t.code);
        const filtered = (tasksRes.data || []).filter((t) => {
          if (systemCodes.includes(t.code)) return false;
          const mt = (t.model_type || '').toLowerCase();
          // 仅保留 chat / reasoning / completion / code 等文本生成类任务
          if (mt && !['chat', 'reasoning', 'completion', 'code'].includes(mt)) {
            return false;
          }
          return true;
        });
        setCustomTools(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch AI tools data:', err);
      toast.error('获取工具列表失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    setCustomOrder((prev) => syncOrder(prev, customTools.map(t => t.code)));
  }, [customTools]);

  useEffect(() => {
    persistOrder(SYSTEM_ORDER_KEY, systemOrder);
  }, [systemOrder]);

  useEffect(() => {
    persistOrder(CUSTOM_ORDER_KEY, customOrder);
  }, [customOrder]);

  useEffect(() => {
    if (isMobileSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }, [isMobileSidebarOpen]);

  const handleSaveTool = async (data: Partial<AiTaskType>) => {
    setIsSaving(true);
    try {
      let res;
      if (editingTool) {
        res = await aiProviderService.updateTask(editingTool.code, data);
      } else {
        res = await aiProviderService.createTask(data);
      }

      if (res.code === 200) {
        toast.success(editingTool ? '更新成功' : '创建成功');
        setShowToolModal(false);
        fetchAllData();
      } else {
        toast.error(res.message || '操作失败');
      }
    } catch (_err) {
      toast.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTool = async (code: string) => {
    if (!confirm('确定要删除这个自定义工具吗？相关的路由配置也将被删除。')) return;

    try {
      const res = await aiProviderService.deleteTask(code);
      if (res.code === 200) {
        toast.success('删除成功');
        if (selectedToolId === code) setSelectedToolId('summary');
        setShowToolModal(false);
        fetchAllData();
      } else {
        toast.error(res.message || '删除失败');
      }
    } catch (_err) {
      toast.error('删除过程中出错');
    }
  };

  const orderedSystemTools = useMemo(
    () => applyOrder(SYSTEM_TOOLS, systemOrder, (t) => t.code),
    [systemOrder]
  );

  const orderedCustomTools = useMemo(
    () => applyOrder(customTools, customOrder, (t) => t.code),
    [customTools, customOrder]
  );

  const systemToolItems = orderedSystemTools.map(t => ({
    ...t,
    description: t.description || '',
    isSystem: true,
  }));

  const customToolItems = orderedCustomTools.map(t => ({
    code: t.code,
    name: t.name,
    description: t.description || '',
    icon: Wrench,
    isSystem: false,
    impact: '自定义流程',
    outcome: '定制输出',
    applyTarget: '按结果应用',
    raw: t
  }));

  const allTools = [
    ...systemToolItems,
    ...customToolItems,
  ];

  const selectedTool = allTools.find(t => t.code === selectedToolId) || allTools[0];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (systemToolItems.some(t => t.code === activeId) && systemToolItems.some(t => t.code === overId)) {
      const oldIndex = systemOrder.indexOf(activeId);
      const newIndex = systemOrder.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        setSystemOrder(arrayMove(systemOrder, oldIndex, newIndex));
      }
      return;
    }

    if (customToolItems.some(t => t.code === activeId) && customToolItems.some(t => t.code === overId)) {
      const oldIndex = customOrder.indexOf(activeId);
      const newIndex = customOrder.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        setCustomOrder(arrayMove(customOrder, oldIndex, newIndex));
      }
    }
  };

  // 检查移动端标签栏的可滚动状态
  const checkScrollState = () => {
    if (toolTabsRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = toolTabsRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    }
  };

  useEffect(() => {
    checkScrollState();
    const el = toolTabsRef.current;
    if (el) {
      el.addEventListener('scroll', checkScrollState);
      window.addEventListener('resize', checkScrollState);
      return () => {
        el.removeEventListener('scroll', checkScrollState);
        window.removeEventListener('resize', checkScrollState);
      };
    }
  }, [allTools]);

  // 移动端：将已选中的工具标签滚动至可视区域
  useEffect(() => {
    if (toolTabsRef.current) {
      const selectedEl = toolTabsRef.current.querySelector(`[data-tool-id="${selectedToolId}"]`) as HTMLElement;
      if (selectedEl) {
        const container = toolTabsRef.current;
        const containerRect = container.getBoundingClientRect();
        const selectedRect = selectedEl.getBoundingClientRect();

        // 将选中项滚动至居中位置
        const scrollOffset = selectedRect.left - containerRect.left - (containerRect.width / 2) + (selectedRect.width / 2);
        container.scrollTo({
          left: container.scrollLeft + scrollOffset,
          behavior: 'smooth'
        });
      }
      checkScrollState();
    }
  }, [selectedToolId]);

  const scrollTabs = (direction: 'left' | 'right') => {
    if (toolTabsRef.current) {
      const scrollAmount = 150;
      toolTabsRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const handleMobileToolSelect = (code: string) => {
    setSelectedToolId(code);
  };

  const sidebarStats = [
    { label: '系统', value: systemToolItems.length },
    { label: '自定义', value: customToolItems.length },
    { label: '总计', value: allTools.length },
  ];

  return (
    <div className="ai-tools-page h-[calc(100dvh-6rem)] md:h-[calc(100dvh-6rem)] overflow-hidden flex flex-col md:flex-row gap-3 md:gap-5 relative isolate">
      {/* 移动端：顶部工具标签栏 */}
      <div className="ai-tools-mobile-rail md:hidden sticky top-0 z-40 flex items-center h-[60px] overflow-hidden flex-shrink-0 rounded-2xl border border-[var(--border-subtle)]">
        {/* 菜单按钮 - 固定在左侧 */}
        <button
          onClick={() => setIsMobileSidebarOpen(true)}
          className="flex-shrink-0 w-14 h-full flex items-center justify-center border-r border-[var(--border-subtle)] text-[var(--text-primary)] transition-colors active:bg-[var(--bg-tertiary)] dark:active:bg-[var(--bg-secondary)]"
          aria-label="打开工具导航"
        >
          <Menu className="w-6 h-6" />
        </button>

        <div className="flex-1 relative h-full overflow-hidden">
          <div
            ref={toolTabsRef}
            className="flex items-center h-full gap-2 px-4 overflow-x-auto no-scrollbar scroll-smooth"
          >
            {allTools.map((tool) => {
              const Icon = tool.icon;
              const isSelected = selectedToolId === tool.code;
              return (
                <button
                  key={tool.code}
                  data-tool-id={tool.code}
                  onClick={() => handleMobileToolSelect(tool.code)}
                  className={cn(
                    "flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl text-xs font-bold transition-all border shadow-sm active:scale-95",
                    isSelected
                      ? "bg-[var(--ink-primary)] text-[var(--bg-void)] border-[var(--ink-primary)] shadow-[0_12px_28px_-18px_color-mix(in_oklch,var(--aurora-1)_70%,black)]"
                      : "bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]"
                  )}
                  title={tool.name}
                >
                  <Icon className="w-5 h-5" />
                </button>
              );
            })}
          </div>

          {/* 滚动指示器 / 渐隐边缘 */}
          <div className={cn(
            "absolute left-0 top-0 bottom-0 w-5 bg-gradient-to-r from-[var(--bg-leaf)] to-transparent pointer-events-none transition-opacity duration-300",
            canScrollLeft ? "opacity-100" : "opacity-0"
          )} />
          <div className={cn(
            "absolute right-0 top-0 bottom-0 w-5 bg-gradient-to-l from-[var(--bg-leaf)] to-transparent pointer-events-none transition-opacity duration-300",
            canScrollRight ? "opacity-100" : "opacity-0"
          )} />
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollTabs('left')}
              className="absolute left-1 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-popover)]/90 text-[var(--text-primary)] shadow-sm"
              aria-label="向左滚动工具"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollTabs('right')}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-popover)]/90 text-[var(--text-primary)] shadow-sm"
              aria-label="向右滚动工具"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 添加按钮 - 固定在右侧 */}
        <button
          onClick={() => {
            setEditingTool(null);
            setShowToolModal(true);
          }}
          className="flex-shrink-0 w-14 h-full flex items-center justify-center border-l border-[var(--border-subtle)] text-[var(--text-primary)] transition-colors active:bg-[var(--bg-tertiary)] dark:active:bg-[var(--bg-secondary)]"
          aria-label="新建工具"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {/* 移动端：侧边栏抽屉（挂载于主容器内） */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <>
            {/* 遮罩层 - 内部 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileSidebarOpen(false)}
              className="md:hidden absolute inset-0 z-[60] bg-black/20 dark:bg-black/40 backdrop-blur-[2px]"
            />

            {/* 抽屉内容 - 内部 */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300, mass: 1 }}
              className="surface-raised md:hidden absolute left-0 top-0 bottom-0 z-[70] w-[88vw] max-w-[312px] flex flex-col !rounded-none border-r border-[var(--border-subtle)] shadow-2xl overflow-hidden"
            >

              {/* 头部 */}
              <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/70">
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ink-primary)] text-[var(--bg-void)]">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-[var(--text-muted)]">AI 内容运营</p>
                      <h2 className="truncate text-lg font-bold text-[var(--text-primary)]">工具中枢</h2>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingTool(null);
                        setShowToolModal(true);
                        setIsMobileSidebarOpen(false);
                      }}
                      className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--ink-primary)] text-[var(--bg-void)] hover:opacity-90 transition-all shadow-sm"
                      aria-label="新建工具"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setIsMobileSidebarOpen(false)}
                      className="p-2 rounded-xl hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      aria-label="关闭工具导航"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {sidebarStats.map((item) => (
                    <div key={item.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-2 py-2 text-center">
                      <div className="font-mono text-sm tnum text-[var(--text-primary)]">{item.value}</div>
                      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>


              {/* 工具列表 */}
              <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <div className="space-y-2 relative">

                    <ToolSectionHeader title="系统能力" count={systemToolItems.length} />
                    <SortableContext
                      items={systemToolItems.map(t => t.code)}
                      strategy={verticalListSortingStrategy}
                    >
                      {systemToolItems.map((tool) => (
                        <SortableToolItem
                          key={tool.code}
                          tool={tool}
                          isSelected={selectedToolId === tool.code}
                          onSelect={() => {
                            setSelectedToolId(tool.code);
                            setIsMobileSidebarOpen(false);
                          }}
                        />
                      ))}
                    </SortableContext>

                    {customToolItems.length > 0 && <ToolSectionHeader title="自定义流程" count={customToolItems.length} className="pt-3" />}

                    <SortableContext
                      items={customToolItems.map(t => t.code)}
                      strategy={verticalListSortingStrategy}
                    >
                      {customToolItems.map((tool) => (
                        <SortableToolItem
                          key={tool.code}
                          tool={tool}
                          isSelected={selectedToolId === tool.code}
                          onSelect={() => {
                            setSelectedToolId(tool.code);
                            setIsMobileSidebarOpen(false);
                          }}
                          onEdit={() => {
                            setEditingTool(tool.raw);
                            setShowToolModal(true);
                            setIsMobileSidebarOpen(false);
                          }}
                        />
                      ))}
                    </SortableContext>

                  </div>
                </DndContext>
              </div>


            </motion.div>
          </>
        )}
      </AnimatePresence>


      {/* 桌面端：左侧栏 - 工具列表 */}
      <div className="ai-tools-sidebar surface-raised hidden md:flex w-[300px] flex-shrink-0 flex-col rounded-2xl border border-[var(--border-subtle)] overflow-hidden h-full">
        {/* 头部 */}

        <div className="p-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 px-2.5 py-1 text-[11px] text-[var(--text-muted)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--aurora-1)]" />
                AI 内容运营
              </div>
              <h1 className="mt-3 text-xl font-bold text-[var(--text-primary)]">
                工具中枢
              </h1>
            </div>
            <button
              onClick={() => {
                setEditingTool(null);
                setShowToolModal(true);
              }}
              className="w-9 h-9 flex shrink-0 items-center justify-center rounded-xl bg-[var(--ink-primary)] text-[var(--bg-void)] hover:opacity-90 transition-all shadow-sm"
              title="新建工具"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {sidebarStats.map((item) => (
              <div key={item.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-2 py-2 text-center">
                <div className="font-mono text-base tnum text-[var(--text-primary)]">{item.value}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <Workflow className="h-4 w-4 text-[var(--aurora-1)]" />
              增长闭环
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {['选稿', '生成', '应用', '复盘'].map((step, index) => (
                <div key={step} className="flex flex-col items-center gap-1">
                  <span className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-mono tnum',
                    index === 0
                      ? 'border-[var(--aurora-1)] bg-[var(--aurora-1)] text-[var(--bg-void)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-muted)]',
                  )}>
                    {index + 1}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>


        {/* 可滚动工具列表 */}
        <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={systemToolItems.map(t => t.code)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                <ToolSectionHeader title="系统能力" count={systemToolItems.length} />
                {systemToolItems.map((tool) => (
                  <SortableToolItem
                    key={tool.code}
                    tool={tool}
                    isSelected={selectedToolId === tool.code}
                    onSelect={() => setSelectedToolId(tool.code)}
                  />
                ))}
              </div>
            </SortableContext>

            {customToolItems.length > 0 && <div className="h-3" />}

            <SortableContext
              items={customToolItems.map(t => t.code)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {customToolItems.length > 0 && <ToolSectionHeader title="自定义流程" count={customToolItems.length} />}
                {customToolItems.map((tool) => (
                  <SortableToolItem
                    key={tool.code}
                    tool={tool}
                    isSelected={selectedToolId === tool.code}
                    onSelect={() => setSelectedToolId(tool.code)}
                    onEdit={() => {
                      setEditingTool(tool.raw);
                      setShowToolModal(true);
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>


      </div>

      {/* 主内容区：工作台 */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <AIToolsWorkspace
          selectedTool={{
            id: selectedTool.code,
            label: selectedTool.name,
            desc: selectedTool.description || '',
            impact: selectedTool.impact,
            outcome: selectedTool.outcome,
            applyTarget: selectedTool.applyTarget,
          }}
          allConfigs={promptConfigs}
          onConfigUpdated={fetchAllData}
          isGlobalLoading={isLoading}
          isMobileSidebarOpen={isMobileSidebarOpen}
          target={target}
        />
      </div>

      <CustomToolModal
        isOpen={showToolModal}
        onClose={() => setShowToolModal(false)}
        tool={editingTool}
        onSave={handleSaveTool}
        onDelete={handleDeleteTool}
        isSaving={isSaving}
      />
    </div>
  );
}

function SortableToolItem({
  tool,
  isSelected,
  onSelect,
  onEdit,
}: {
  tool: {
    code: string;
    name: string;
    description: string;
    icon: ElementType;
    isSystem: boolean;
    impact?: string;
    outcome?: string;
    applyTarget?: string;
  };
  isSelected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tool.code,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const Icon = tool.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'relative w-full min-w-0 flex items-start gap-3 px-3.5 py-3.5 rounded-2xl text-left transition-all duration-300 cursor-grab active:cursor-grabbing select-none group',
        'border mb-2 overflow-hidden',
        isSelected
          ? 'bg-[var(--bg-leaf)] border-[color-mix(in_oklch,var(--aurora-1)_34%,transparent)] shadow-[0_16px_34px_-26px_color-mix(in_oklch,var(--aurora-1)_60%,black)] text-[var(--text-primary)] font-bold z-10'
          : 'bg-[var(--bg-secondary)]/65 text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]',
        isDragging && 'opacity-80 ring-2 ring-primary/20 scale-[1.02] z-50 shadow-2xl'
      )}
    >


      <div
        className={cn(
          'p-2.5 rounded-xl transition-colors flex-shrink-0',
          isSelected
            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
            : 'bg-[var(--bg-card)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
        )}
      >
        <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
      </div>

      <div className={cn("flex-1 min-w-0", !tool.isSystem && "pr-8")}>
        <div className="flex min-w-0 items-center gap-2">
          <div className={cn('truncate text-sm sm:text-[15px] font-bold', isSelected ? '' : 'text-[var(--text-primary)]')}>
            {tool.name}
          </div>
          {tool.impact && (
            <span className="hidden xl:inline-flex shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
              {tool.impact}
            </span>
          )}
        </div>
        <p className={cn(
          'mt-1 text-[11px] sm:text-xs leading-snug line-clamp-2 min-h-[30px] overflow-hidden whitespace-normal font-medium',
          isSelected ? 'opacity-80' : 'text-[var(--text-muted)]'
        )}>
          {tool.description}
        </p>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <BadgeCheck className="h-3 w-3 shrink-0 text-[var(--signal-success)]" />
          <span className="truncate">{tool.outcome || tool.impact || '输出'}</span>
          <span className="shrink-0 opacity-40">/</span>
          <span className="truncate">{tool.applyTarget || '应用'}</span>
        </div>
      </div>

      <GripVertical className="absolute right-3 top-3 h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-60" />

      {!tool.isSystem && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.();
          }}
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-xl transition-all',
            isSelected
              ? 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm bg-[var(--bg-card)]'
          )}
          aria-label="编辑工具"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function ToolSectionHeader({
  title,
  count,
  className,
}: {
  title: string;
  count: number;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between px-1 pb-1', className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
        <Layers3 className="h-3.5 w-3.5" />
        {title}
      </div>
      <span className="font-mono text-[10px] tnum text-[var(--text-muted)]">{count}</span>
    </div>
  );
}
