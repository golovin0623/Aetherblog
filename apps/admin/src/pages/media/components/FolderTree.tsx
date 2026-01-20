/**
 * 文件夹树组件 - 支持拖拽
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 *
 * 设计哲学: Cognitive Elegance
 * - 玻璃态卡片效果
 * - 流畅的展开/折叠动画
 * - @dnd-kit 拖拽支持
 * - 右键菜单
 */

import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  MouseSensor,
} from '@dnd-kit/core';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  Plus,
  Edit2,
  Trash2,
  Move,
  MoreVertical,
  GripVertical,
} from 'lucide-react';
import type { MediaFolder, FolderTreeNode } from '@aetherblog/types';
import { folderService } from '../../../services/folderService';
import { cn } from '@aetherblog/utils';
import { toast } from 'sonner';

interface FolderTreeProps {
  selectedFolderId?: number;
  onSelectFolder: (folderId: number | undefined) => void;
  onCreateFolder?: (parentId?: number) => void;
  onEditFolder?: (folder: MediaFolder) => void;
  onDeleteFolder?: (folderId: number) => void;
  onMoveFolder?: (folderId: number, targetParentId?: number) => void;
}

export const FolderTree = memo(({
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  onMoveFolder,
}: FolderTreeProps) => {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // 拖拽传感器配置 - 使用 MouseSensor 更精确
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // 获取文件夹树
  const { data: response, isLoading, error, refetch } = useQuery({
    queryKey: ['folders', 'tree'],
    queryFn: () => folderService.getTree(),
    staleTime: 30000, // 30秒内认为是新鲜的，避免频繁挂载导致的重复请求
    gcTime: 300000, // 缓存保留5分钟
    refetchOnMount: false, // 挂载时不强制刷新，除非数据已过期
    refetchOnWindowFocus: false,
  });

  const folders = response?.data || [];

  // 移动文件夹 mutation
  const moveMutation = useMutation({
    mutationFn: ({ folderId, targetParentId }: { folderId: number; targetParentId?: number }) =>
      folderService.move(folderId, { targetParentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success('文件夹已移动');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '移动失败');
    },
  });

  // 找到被拖拽的文件夹
  const activeFolder = useMemo(() => {
    if (!activeId) return null;
    const findFolder = (items: FolderTreeNode[]): FolderTreeNode | null => {
      for (const item of items) {
        if (item.id === activeId) return item;
        if (item.children?.length) {
          const found = findFolder(item.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findFolder(folders);
  }, [activeId, folders]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverId(event.over?.id as number | null);
  };

  // 跟踪鼠标位置用于自定义拖拽预览
  useEffect(() => {
    if (!activeId) return;

    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [activeId]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);

    if (!over || active.id === over.id) return;

    const draggedId = active.id as number;
    const targetId = over.id as number | undefined;

    // 不能将文件夹拖拽到自己的子文件夹中
    const isDescendant = (parentId: number, childId: number, items: FolderTreeNode[]): boolean => {
      const findParent = (items: FolderTreeNode[]): FolderTreeNode | null => {
        for (const item of items) {
          if (item.id === parentId) return item;
          if (item.children?.length) {
            const found = findParent(item.children);
            if (found) return found;
          }
        }
        return null;
      };
      const parent = findParent(items);
      if (!parent) return false;
      const checkDescendant = (node: FolderTreeNode): boolean => {
        if (node.id === childId) return true;
        return node.children?.some(checkDescendant) || false;
      };
      return checkDescendant(parent);
    };

    if (targetId && isDescendant(draggedId, targetId, folders)) {
      toast.error('不能将文件夹移动到自己的子文件夹中');
      return;
    }

    // 执行移动
    moveMutation.mutate({
      folderId: draggedId,
      targetParentId: targetId === 0 ? undefined : targetId, // 0 表示根目录
    });
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverId(null);
  };

  if (error) {
    console.error('Failed to load folder tree:', error);
    return (
      <div className="p-4 text-center text-[var(--text-muted)]">
        <p>加载文件夹失败</p>
        <button
          onClick={() => refetch()}
          className="mt-2 text-indigo-400 hover:text-indigo-300"
        >
          重试
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <FolderTreeSkeleton />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      autoScroll={false}
    >
      <div className="space-y-1">
        {/* 根目录 - 可作为放置目标 */}
        <DroppableFolderNode
          folder={{
            id: 0,
            name: '全部文件',
            slug: 'all',
            path: '/',
            depth: 0,
            sortOrder: 0,
            color: '#6366f1',
            icon: 'Folder',
            visibility: 'PRIVATE',
            fileCount: folders.reduce((sum, f) => sum + f.fileCount, 0),
            totalSize: folders.reduce((sum, f) => sum + f.totalSize, 0),
            createdAt: '',
            updatedAt: '',
            children: [],
          }}
          selected={selectedFolderId === undefined}
          onSelect={() => onSelectFolder(undefined)}
          onCreateChild={() => onCreateFolder?.()}
          isRoot
          isOver={overId === 0}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          onEditFolder={onEditFolder}
          onDeleteFolder={onDeleteFolder}
          onMoveFolder={onMoveFolder}
          onCreateFolder={onCreateFolder}
        />

        {/* 文件夹树 */}
        {folders.map((folder) => (
          <DraggableFolderNode
            key={folder.id}
            folder={folder}
            selected={selectedFolderId === folder.id}
            onSelect={() => onSelectFolder(folder.id)}
            onEdit={() => onEditFolder?.(folder)}
            onDelete={() => onDeleteFolder?.(folder.id)}
            onCreateChild={() => onCreateFolder?.(folder.id)}
            isOver={overId === folder.id}
            isDragging={activeId === folder.id}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onEditFolder={onEditFolder}
            onDeleteFolder={onDeleteFolder}
            onMoveFolder={onMoveFolder}
            onCreateFolder={onCreateFolder}
          />
        ))}
      </div>

      {/* 自定义拖拽预览 - 使用 Portal 渲染到 body，完全跟随鼠标 */}
      {activeFolder && createPortal(
        <div
          className="fixed pointer-events-none z-[99999]"
          style={{
            left: mousePosition.x,
            top: mousePosition.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 border border-primary/50 shadow-2xl">
            <Folder className="w-5 h-5" style={{ color: activeFolder.color }} />
            <span className="text-sm font-medium text-white">{activeFolder.name}</span>
          </div>
        </div>,
        document.body
      )}
    </DndContext>
  );
});

interface DraggableFolderNodeProps {
  folder: FolderTreeNode;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCreateChild?: () => void;
  depth?: number;
  isOver?: boolean;
  isDragging?: boolean;
  selectedFolderId?: number;
  onSelectFolder: (folderId: number | undefined) => void;
  onEditFolder?: (folder: MediaFolder) => void;
  onDeleteFolder?: (folderId: number) => void;
  onMoveFolder?: (folderId: number, targetParentId?: number) => void;
  onCreateFolder?: (parentId?: number) => void;
}

function DraggableFolderNode({
  folder,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onCreateChild,
  depth = 0,
  isOver = false,
  isDragging = false,
  selectedFolderId,
  onSelectFolder,
  onEditFolder,
  onDeleteFolder,
  onMoveFolder,
  onCreateFolder,
}: DraggableFolderNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showMenu, setShowMenu] = useState(false);

  const hasChildren = folder.children && folder.children.length > 0;

  // 拖拽
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
  } = useDraggable({
    id: folder.id,
  });

  // 放置
  const { setNodeRef: setDroppableRef, isOver: isDropOver } = useDroppable({
    id: folder.id,
  });

  // 合并 refs
  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  // 拖拽时不移动原元素，只通过 DragOverlay 显示预览
  // 所以这里不使用 transform

  return (
    <div>
      {/* 文件夹项 */}
      <motion.div
        ref={setNodeRef}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: isDragging ? 0.3 : 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'group relative flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200',
          selected
            ? 'bg-primary text-white shadow-md shadow-primary/20'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
          (isOver || isDropOver) && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--bg-card)] bg-primary/10',
          isDragging && 'opacity-40'
        )}
        onClick={onSelect}
      >
        {/* 拖拽手柄 - 始终可见但颜色较淡 */}
        <div
          {...attributes}
          {...listeners}
          className={cn(
            "flex-shrink-0 cursor-grab active:cursor-grabbing p-1 -ml-1 rounded transition-colors",
            selected ? "text-white/60 hover:text-white hover:bg-white/10" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
          )}
          style={{ marginLeft: `${depth * 16}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* 展开/折叠图标 */}
        {hasChildren && (
          <motion.div
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className={cn(
              "flex-shrink-0 cursor-pointer p-0.5 rounded transition-colors",
              selected ? "hover:bg-white/10" : "hover:bg-[var(--bg-card-hover)]"
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </motion.div>
        )}

        {!hasChildren && <div className="w-5" />}

        {/* 文件夹图标 */}
        <div className="flex-shrink-0">
          {expanded && hasChildren ? (
            <FolderOpen className={cn("w-5 h-5", selected ? "text-white" : "")} style={!selected ? { color: folder.color } : {}} />
          ) : (
            <Folder className={cn("w-5 h-5", selected ? "text-white" : "")} style={!selected ? { color: folder.color } : {}} />
          )}
        </div>

        {/* 文件夹名称 */}
        <span className={cn(
          "flex-1 text-sm font-medium truncate",
          selected ? "text-white" : "text-[var(--text-primary)]"
        )}>
          {folder.name}
        </span>

        {/* 文件数量徽章 */}
        {folder.fileCount > 0 && (
          <span className={cn(
            "text-xs px-2 py-0.5 rounded-full transition-colors",
            selected
              ? "bg-white/20 text-white"
              : "text-[var(--text-muted)] bg-[var(--bg-secondary)] group-hover:bg-[var(--bg-card)]"
          )}>
            {folder.fileCount}
          </span>
        )}

        {/* 操作菜单 */}
        <div
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            data-folder-menu={folder.id}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className={cn(
              "p-1 rounded transition-colors",
              selected ? "hover:bg-white/10 text-white" : "hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
            )}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>

        {/* 下拉菜单 - 使用 Portal 渲染到 body */}
        {showMenu && (
          <FolderContextMenuPortal
            folder={folder}
            onEdit={onEdit}
            onDelete={onDelete}
            onCreateChild={onCreateChild}
            onMove={() => onMoveFolder?.(folder.id, undefined)}
            onClose={() => setShowMenu(false)}
          />
        )}
      </motion.div>

      {/* 子文件夹 */}
      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {folder.children.map((child) => (
              <DraggableFolderNode
                key={child.id}
                folder={child}
                selected={selectedFolderId === child.id}
                onSelect={() => onSelectFolder(child.id)}
                onEdit={() => onEditFolder?.(child)}
                onDelete={() => onDeleteFolder?.(child.id)}
                onCreateChild={() => onCreateFolder?.(child.id)}
                depth={depth + 1}
                selectedFolderId={selectedFolderId}
                onSelectFolder={onSelectFolder}
                onEditFolder={onEditFolder}
                onDeleteFolder={onDeleteFolder}
                onMoveFolder={onMoveFolder}
                onCreateFolder={onCreateFolder}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DroppableFolderNodeProps {
  folder: FolderTreeNode & { id: number };
  selected: boolean;
  onSelect: () => void;
  onCreateChild?: () => void;
  isRoot?: boolean;
  isOver?: boolean;
  selectedFolderId?: number;
  onSelectFolder: (folderId: number | undefined) => void;
  onEditFolder?: (folder: MediaFolder) => void;
  onDeleteFolder?: (folderId: number) => void;
  onMoveFolder?: (folderId: number, targetParentId?: number) => void;
  onCreateFolder?: (parentId?: number) => void;
}

function DroppableFolderNode({
  folder,
  selected,
  onSelect,
  onCreateChild,
  isRoot = false,
  isOver = false,
}: DroppableFolderNodeProps) {
  const { setNodeRef, isOver: isDropOver } = useDroppable({
    id: folder.id,
  });

  return (
    <motion.div
      ref={setNodeRef}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200',
        selected
          ? 'bg-primary text-white shadow-md shadow-primary/20'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
        (isOver || isDropOver) && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--bg-card)] bg-primary/10'
      )}
      style={{ paddingLeft: '12px' }}
      onClick={onSelect}
    >
      {/* 文件夹图标 */}
      <div className="flex-shrink-0">
        <Folder className={cn("w-5 h-5", selected ? "text-white" : "")} style={!selected ? { color: folder.color } : {}} />
      </div>

      {/* 文件夹名称 */}
      <span className={cn(
        "flex-1 text-sm font-medium truncate",
        selected ? "text-white" : "text-[var(--text-primary)]"
      )}>
        {folder.name}
      </span>

      {/* 文件数量徽章 */}
      {folder.fileCount > 0 && (
        <span className={cn(
          "text-xs px-2 py-0.5 rounded-full transition-colors",
          selected
            ? "bg-white/20 text-white"
            : "text-[var(--text-muted)] bg-[var(--bg-secondary)] group-hover:bg-[var(--bg-card)]"
        )}>
          {folder.fileCount}
        </span>
      )}

      {/* 根目录添加按钮 */}
      {isRoot && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCreateChild?.();
          }}
          className={cn(
            "opacity-0 group-hover:opacity-100 p-1 rounded transition-all",
            selected ? "hover:bg-white/10 text-white" : "hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
          )}
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  );
}

interface FolderContextMenuProps {
  onEdit?: () => void;
  onDelete?: () => void;
  onCreateChild?: () => void;
  onMove?: () => void;
  onClose: () => void;
}

interface FolderContextMenuPortalProps extends FolderContextMenuProps {
  folder: FolderTreeNode;
}

/**
 * 使用 Portal 渲染的右键菜单
 * 解决菜单被父容器裁剪和 z-index 问题
 */
function FolderContextMenuPortal({
  folder,
  onEdit,
  onDelete,
  onCreateChild,
  onMove,
  onClose,
}: FolderContextMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    // 获取触发按钮的位置
    const button = document.querySelector(`[data-folder-menu="${folder.id}"]`);
    if (button) {
      const rect = button.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.right - 160, // 菜单宽度 160px，右对齐
      });
    }

    // 点击外部关闭
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 按 Escape 关闭
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // 延迟添加事件监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [folder.id, onClose]);

  const menuItems = [
    {
      icon: Plus,
      label: '新建子文件夹',
      onClick: () => {
        onCreateChild?.();
        onClose();
      },
    },
    {
      icon: Edit2,
      label: '重命名',
      onClick: () => {
        onEdit?.();
        onClose();
      },
    },
    {
      icon: Move,
      label: '移动',
      onClick: () => {
        onMove?.();
        onClose();
      },
    },
    {
      icon: Trash2,
      label: '删除',
      onClick: () => {
        onDelete?.();
        onClose();
      },
      danger: true,
    },
  ];

  return createPortal(
    <>
      {/* 透明遮罩层 - 用于捕获点击 */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />

      {/* 菜单 */}
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.15 }}
        className="fixed z-[9999] bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-subtle)] rounded-lg shadow-2xl overflow-hidden"
        style={{
          top: position.top,
          left: Math.max(8, position.left), // 确保不超出左边界
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="py-1 min-w-[160px]">
          {menuItems.map((item, index) => (
            <button
              key={index}
              onClick={item.onClick}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
                item.danger
                  ? 'text-red-400 hover:bg-red-500/10'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              )}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </>,
    document.body
  );
}

function FolderContextMenu({ onEdit, onDelete, onCreateChild, onMove, onClose }: FolderContextMenuProps) {
  const menuItems = [
    {
      icon: Plus,
      label: '新建子文件夹',
      onClick: () => {
        onCreateChild?.();
        onClose();
      },
    },
    {
      icon: Edit2,
      label: '重命名',
      onClick: () => {
        onEdit?.();
        onClose();
      },
    },
    {
      icon: Move,
      label: '移动',
      onClick: () => {
        onMove?.();
        onClose();
      },
    },
    {
      icon: Trash2,
      label: '删除',
      onClick: () => {
        onDelete?.();
        onClose();
      },
      danger: true,
    },
  ];

  return (
    <div className="py-1 min-w-[160px]">
      {menuItems.map((item, index) => (
        <button
          key={index}
          onClick={item.onClick}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
            item.danger
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          )}
        >
          <item.icon className="w-4 h-4" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function FolderTreeSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-10 bg-white/5 rounded-lg animate-pulse"
          style={{ marginLeft: `${(i % 3) * 16}px` }}
        />
      ))}
    </div>
  );
}
