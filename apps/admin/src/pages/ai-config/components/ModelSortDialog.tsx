// 模型拖拽排序弹窗

import { useState, useEffect, useMemo } from 'react';
import { motion, Reorder } from 'framer-motion';
import { X, GripVertical, Loader2 } from 'lucide-react';
import type { AiModel } from '@/services/aiProviderService';
import { useUpdateModelSort } from '../hooks/useModels';

interface ModelSortDialogProps {
  providerCode: string;
  models: AiModel[];
  onClose: () => void;
}

interface SortItem {
  id: number;
  model_id: string;
  display_name: string;
  model_type: string;
  sort?: number;
}

function getSortValue(model: AiModel): number {
  const caps = model.capabilities as Record<string, unknown> | undefined;
  const raw = caps?.sort;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return parseInt(raw, 10) || 999999;
  return 999999;
}

export default function ModelSortDialog({ providerCode, models, onClose }: ModelSortDialogProps) {
  const enabledModels = useMemo(() => models.filter((m) => m.is_enabled), [models]);
  const [items, setItems] = useState<SortItem[]>([]);

  const updateMutation = useUpdateModelSort();

  useEffect(() => {
    const sorted = [...enabledModels]
      .sort((a, b) => getSortValue(a) - getSortValue(b))
      .map((m) => ({
        id: m.id,
        model_id: m.model_id,
        display_name: m.display_name || m.model_id,
        model_type: m.model_type,
        sort: getSortValue(m),
      }));
    setItems(sorted);
  }, [enabledModels]);

  const handleSave = () => {
    const updates = items.map((item, index) => ({
      id: item.id,
      sort: index + 1,
    }));
    updateMutation.mutate({ providerCode, items: updates }, { onSuccess: onClose });
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
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[var(--bg-primary)] shadow-2xl overflow-hidden"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">模型排序</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 排序列表 */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)] text-sm">暂无已启用模型</div>
          ) : (
            <Reorder.Group axis="y" values={items} onReorder={setItems} className="space-y-2">
              {items.map((item) => (
                <Reorder.Item
                  key={item.id}
                  value={item}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5 bg-[var(--bg-card)]/50 cursor-grab active:cursor-grabbing select-none"
                >
                  <GripVertical className="w-4 h-4 text-[var(--text-muted)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {item.display_name}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">{item.model_id}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-[var(--text-muted)]">
                    {item.model_type}
                  </span>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          )}
        </div>

        {/* 底部操作 */}
        <div className="p-4 border-t border-white/5">
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
