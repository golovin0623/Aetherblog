import { useState, useEffect, useMemo } from 'react';
import type { ElementType } from 'react';
import { Sparkles, BrainCircuit, Wand2, ListTree, Languages, PenLine, FileEdit, Wrench, Plus, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AIToolsWorkspace } from '@/components/ai/AIToolsWorkspace';
import { CustomToolModal } from '@/components/ai/CustomToolModal';
import { aiProviderService, AiTaskType } from '@/services/aiProviderService';
import { toast } from 'sonner';
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
  { code: 'summary', name: '智能摘要', description: '自动生成文章摘要', icon: BrainCircuit },
  { code: 'tags', name: '智能标签', description: '推荐相关标签', icon: Wand2 },
  { code: 'titles', name: '标题优化', description: '优化文章标题', icon: FileEdit },
  { code: 'outline', name: '大纲生成', description: '生成文章大纲', icon: ListTree },
  { code: 'polish', name: '内容润色', description: '润色文章内容', icon: PenLine },
  { code: 'translate', name: '智能翻译', description: '多语言翻译', icon: Languages },
];

const SYSTEM_ORDER_KEY = 'ai-tools-system-order';
const CUSTOM_ORDER_KEY = 'ai-tools-custom-order';

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
    // ignore storage errors
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
  const [selectedToolId, setSelectedToolId] = useState('summary');
  const [customTools, setCustomTools] = useState<AiTaskType[]>([]);
  const [promptConfigs, setPromptConfigs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const systemCodes = useMemo(() => SYSTEM_TOOLS.map(t => t.code), []);
  const [systemOrder, setSystemOrder] = useState<string[]>(() => syncOrder(loadOrder(SYSTEM_ORDER_KEY), systemCodes));
  const [customOrder, setCustomOrder] = useState<string[]>(() => loadOrder(CUSTOM_ORDER_KEY));
  
  // Custom tool management state
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingTool, setEditingTool] = useState<AiTaskType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [promptsRes, tasksRes] = await Promise.all([
        aiProviderService.listPromptConfigs(),
        aiProviderService.listTasks()
      ]);
      
      if (promptsRes.code === 200) setPromptConfigs(promptsRes.data || []);
      if (tasksRes.code === 200) {
        // Filter out system tools from the tasks list to avoid duplicates if they are in DB
        const systemCodes = SYSTEM_TOOLS.map(t => t.code);
        const filtered = (tasksRes.data || []).filter(t => !systemCodes.includes(t.code));
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
    } catch (err) {
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
    } catch (err) {
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

  return (
    <div className="h-[calc(100vh-6rem)] overflow-hidden flex gap-6">
      {/* Left Column: Tools List */}
      <div className="w-[280px] flex-shrink-0 flex flex-col bg-[var(--bg-card)] rounded-3xl border border-[var(--border-subtle)] overflow-hidden shadow-sm h-full">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-[var(--border-subtle)]">
          <h1 className="text-xl font-extrabold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI 工具箱
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1.5 font-light">
            选择工具以开始创作
          </p>
        </div>

        {/* Scrollable Tool List */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent">
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

            {customToolItems.length > 0 && <div className="h-2" />}

            <SortableContext
              items={customToolItems.map(t => t.code)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {customToolItems.map((tool) => (
                  <SortableToolItem
                    key={tool.code}
                    tool={tool}
                    isSelected={selectedToolId === tool.code}
                    onSelect={() => setSelectedToolId(tool.code)}
                    onEdit={() => {
                      setEditingTool((tool as any).raw);
                      setShowToolModal(true);
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        
        {/* Fixed Bottom: New Custom Tool */}
        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            onClick={() => {
              setEditingTool(null);
              setShowToolModal(true);
            }}
            className={cn(
              'group w-full flex items-center justify-center gap-2 p-3 rounded-xl transition-all duration-300',
              'bg-gradient-to-b from-[var(--bg-card)] to-[var(--bg-secondary)]',
              'border border-[var(--border-subtle)]',
              'text-[var(--text-secondary)] font-medium text-sm',
              'shadow-sm hover:shadow-md hover:shadow-primary/5',
              'hover:text-primary hover:border-primary/30 hover:bg-primary/5'
            )}
          >
            <Plus className="w-4 h-4 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-90" />
            新建功能
          </button>
        </div>
      </div>

      {/* Main Area: Workspace (Cols 2 & 3) */}
      <div className="flex-1 h-full min-w-0">
        <AIToolsWorkspace 
          selectedTool={{ 
            id: selectedTool.code, 
            label: selectedTool.name, 
            desc: selectedTool.description || '' 
          }} 
          allConfigs={promptConfigs}
          onConfigUpdated={fetchAllData}
          isGlobalLoading={isLoading}
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
        'relative w-full min-w-0 min-h-[60px] flex items-center gap-2.5 p-3 rounded-xl text-left transition-all duration-200 cursor-grab active:cursor-grabbing select-none',
        isSelected
          ? 'bg-primary text-white shadow-md shadow-primary/20'
          : 'hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)]',
        isDragging && 'opacity-80 ring-2 ring-primary/30'
      )}
    >
      <div
        className={cn(
          'p-2 rounded-lg transition-colors flex-shrink-0',
          isSelected ? 'bg-white/20 text-white' : 'bg-[var(--bg-card)] text-[var(--text-muted)]'
        )}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className={cn("flex-1 min-w-0", !tool.isSystem && "pr-8")}>
        <div className={cn('font-semibold text-sm truncate mb-0.5', isSelected ? 'text-white' : '')}>
          {tool.name}
        </div>
        <p className={cn('text-[11px] leading-tight line-clamp-2 h-[26px] overflow-hidden whitespace-normal', isSelected ? 'text-white/80' : 'text-[var(--text-muted)]')}>
          {tool.description}
        </p>
      </div>
      {!tool.isSystem && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.();
          }}
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg transition-all',
            isSelected
              ? 'text-white hover:bg-white/20'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm bg-[var(--bg-card)]'
          )}
          aria-label="编辑工具"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
