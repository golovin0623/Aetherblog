import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Edit2, Trash2, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FriendLink } from '@/services/friendService';

interface SortableFriendItemProps {
  friend: FriendLink;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisible: () => void;
}

export function SortableFriendItem({ friend, onEdit, onDelete, onToggleVisible }: SortableFriendItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: friend.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : 1,
    opacity: isDragging ? 0.8 : 1,
    position: 'relative' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-center justify-between p-4 rounded-xl",
        "bg-[var(--bg-secondary)] border border-[var(--border-subtle)]",
        "hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] transition-all duration-200",
        isDragging && "shadow-xl ring-2 ring-primary/50 bg-[var(--bg-card)] scale-[1.02]",
        !friend.visible && "opacity-60 grayscale-[0.5]"
      )}
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        {/* Drag Handle */}
        <div 
          {...attributes} 
          {...listeners} 
          className={cn(
            "cursor-grab active:cursor-grabbing p-1.5 rounded-md",
            "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-colors"
          )}
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Logo/Avatar */}
        <div className={cn(
          "w-12 h-12 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] overflow-hidden shrink-0",
          "flex items-center justify-center transition-transform group-hover:scale-105"
        )}>
          {friend.logo ? (
            <img 
              src={friend.logo} 
              alt={friend.name} 
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement?.classList.add('fallback-avatar');
              }} 
            />
          ) : (
            <div className="text-lg font-bold text-[var(--text-muted)] font-mono">
              {friend.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-medium text-[var(--text-primary)] truncate leading-none">
              {friend.name}
            </h4>
            {friend.isOnline === false && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500/80 ring-2 ring-red-500/20" title="站点无法访问" />
            )}
            {!friend.visible && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border border-yellow-500/20">
                已隐藏
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <a 
              href={friend.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="hover:text-primary transition-colors truncate max-w-[200px] flex items-center gap-1"
            >
              {friend.url}
              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
            {friend.description && (
              <span className="hidden sm:inline-flex items-center gap-2 max-w-[300px]">
                <span className="w-0.5 h-3 bg-[var(--border-default)]" />
                <span className="truncate text-[var(--text-secondary)]">{friend.description}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 pl-4">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
          className={cn(
            "p-2 rounded-lg transition-colors",
            friend.visible 
              ? "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]" 
              : "text-yellow-600 dark:text-yellow-500 hover:bg-yellow-500/10"
          )}
          title={friend.visible ? "隐藏" : "显示"}
        >
          {friend.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-2 rounded-lg text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
          title="编辑"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-2 rounded-lg text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
