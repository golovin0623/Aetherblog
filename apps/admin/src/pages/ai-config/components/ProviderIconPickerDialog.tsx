import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';

import {
  BRAND_ICON_ITEMS,
  type BrandIconGroup,
  getBrandIconPreviewUrl,
  resolveBrandIconId,
} from '../utils/lobeIcons';

interface ProviderIconPickerDialogProps {
  value?: string | null;
  onChange: (iconId: string | null) => void;
  onClose: () => void;
}

export default function ProviderIconPickerDialog({
  value,
  onChange,
  onClose,
}: ProviderIconPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<BrandIconGroup | 'all'>('all');

  const selectedId = resolveBrandIconId(value) || null;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return BRAND_ICON_ITEMS.filter((item) => {
      if (group !== 'all' && item.group !== group) return false;
      if (!q) return true;
      const hay = `${item.id} ${item.title} ${item.fullTitle || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [group, query]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[92vw] sm:w-full sm:max-w-2xl max-h-[82vh] flex flex-col rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-5 border-b border-[var(--border-default)]">
          <div className="min-w-0">
            <div className="text-base font-semibold text-[var(--text-primary)] truncate">选择图标</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">
              从 LobeHub 图标库中选择（支持服务商/模型品牌）
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-[var(--border-default)] space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索图标（如 OpenAI / Claude / Groq）"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                onClose();
              }}
              className="px-3 py-2.5 rounded-xl border border-[var(--border-default)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-colors"
              title="清除自定义图标（恢复按代码识别）"
            >
              清除
            </button>
          </div>

          <div className="flex items-center gap-2">
            <TabButton active={group === 'all'} onClick={() => setGroup('all')}>
              全部
            </TabButton>
            <TabButton active={group === 'provider'} onClick={() => setGroup('provider')}>
              服务商
            </TabButton>
            <TabButton active={group === 'model'} onClick={() => setGroup('model')}>
              模型
            </TabButton>
            <div className="ml-auto text-xs text-[var(--text-muted)]">
              {items.length} 个结果
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent">
          {items.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--text-muted)]">
              没有匹配的图标
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {items.map((item) => {
                const isSelected = selectedId === item.id;
                const url = getBrandIconPreviewUrl(item, 'aliyun');
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChange(item.id);
                      onClose();
                    }}
                    className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-black dark:border-white bg-black/5 dark:bg-white/5'
                        : 'border-[var(--border-default)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]'
                    }`}
                    title={item.fullTitle || item.title || item.id}
                  >
                    <img
                      src={url}
                      alt={item.title || item.id}
                      width={28}
                      height={28}
                      loading="lazy"
                      decoding="async"
                      className="w-7 h-7 object-contain"
                      onError={(e) => {
                        // Hide broken icons without breaking the layout
                        (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
                      }}
                    />
                    <div className="w-full text-[10px] leading-tight text-[var(--text-muted)] line-clamp-2 text-center">
                      {item.title || item.id}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
        active
          ? 'bg-black dark:bg-white text-white dark:text-black border-transparent'
          : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
      }`}
    >
      {children}
    </button>
  );
}

