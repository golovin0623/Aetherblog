// 拖拽排序弹窗组件
// ref: §5.1 - AI Service 架构 (参考 LobeChat 图2)

import { useState, useEffect } from 'react';
import { motion, Reorder } from 'framer-motion';
import { X, GripVertical, Loader2 } from 'lucide-react';
import type { AiProvider } from '@/services/aiProviderService';
import { useUpdateProviderPriorities } from '../hooks/useProviders';
import ProviderIcon from './ProviderIcon';

interface SortDialogProps {
  providers: AiProvider[];
  onClose: () => void;
}

interface SortItem {
  id: number;
  code: string;
  name: string;
  displayName: string;
}

export default function SortDialog({ providers, onClose }: SortDialogProps) {
  // 仅对已启用的供应商排序
  const enabledProviders = providers.filter((p) => p.is_enabled);

  const [items, setItems] = useState<SortItem[]>([]);

  const updateMutation = useUpdateProviderPriorities();

  // 初始化排序列表
  useEffect(() => {
    setItems(
      enabledProviders
        .sort((a, b) => a.priority - b.priority)
        .map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          displayName: p.display_name || p.name,
        }))
    );
  }, [enabledProviders.length]);

  const handleSave = () => {
    const updates = items.map((item, index) => ({
      id: item.id,
      priority: index + 1,
    }));
    updateMutation.mutate(updates, { onSuccess: onClose });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            自定义排序
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 排序列表 */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)] text-sm">
              暂无已启用的供应商
            </div>
          ) : (
            <Reorder.Group axis="y" values={items} onReorder={setItems} className="space-y-2">
              {items.map((item) => (
                <Reorder.Item
                  key={item.id}
                  value={item}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] cursor-grab active:cursor-grabbing select-none"
                >
                  <GripVertical className="w-4 h-4 text-[var(--text-muted)]" />
                  <ProviderIcon code={item.code} size={20} />
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {item.displayName}
                  </span>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          )}
        </div>

        {/* 底部操作 */}
        <div className="p-4 border-t border-[var(--border-default)]">
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending || items.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-card)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card)]/80 transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            更 新
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
