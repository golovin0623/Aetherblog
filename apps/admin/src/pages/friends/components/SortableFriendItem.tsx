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
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center justify-between p-4 rounded-lg",
        "bg-white/5 border border-white/5 hover:border-white/10 transition-colors",
        !friend.visible && "opacity-60 bg-white/2"
      )}
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        {/* Drag Handle */}
        <div 
          {...attributes} 
          {...listeners} 
          className="cursor-move p-1 text-gray-500 hover:text-white transition-colors"
        >
          <GripVertical className="w-5 h-5" />
        </div>

        {/* Logo/Avatar */}
        <div className="w-10 h-10 rounded-lg bg-black/30 overflow-hidden flex-shrink-0 border border-white/5">
          {friend.logo ? (
            <img src={friend.logo} alt={friend.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-lg font-bold text-gray-600 bg-white/5">
              {friend.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-white truncate">{friend.name}</h4>
            {friend.isOnline === false && (
              <span className="w-2 h-2 rounded-full bg-red-500" title="站点无法访问" />
            )}
            {!friend.visible && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">已隐藏</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <a 
              href={friend.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="hover:text-primary transition-colors truncate max-w-[200px]"
            >
              {friend.url}
            </a>
            {friend.description && (
              <>
                <span className="w-1 h-1 rounded-full bg-gray-700" />
                <span className="truncate max-w-[300px]">{friend.description}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity pl-4">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          title={friend.visible ? "隐藏" : "显示"}
        >
          {friend.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-2 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors"
          title="编辑"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
