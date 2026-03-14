import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, Command } from 'lucide-react';
import { useEffect } from 'react';

/**
 * 键盘快捷键面板组件
 * @ref Phase 6: 性能优化 - 键盘快捷键
 */

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
  { 
    category: '通用',
    items: [
      { key: ['⌘', 'F'], description: '搜索' },
      { key: ['⌘', '/'], description: '显示/隐藏此面板' },
      { key: ['Esc'], description: '关闭对话框 / 取消选择' },
    ]
  },
  { 
    category: '文件操作',
    items: [
      { key: ['⌘', 'U'], description: '上传文件' },
      { key: ['⌘', 'N'], description: '新建文件夹' },
      { key: ['⌘', 'A'], description: '全选' },
      { key: ['Del'], description: '删除选中项' },
    ]
  }
];

export function KeyboardShortcutsPanel({ open, onOpenChange }: KeyboardShortcutsPanelProps) {
  // 监听 Esc 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* 对话框 */}
          <div className="fixed inset-0 flex items-center justify-center z-[101] p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className="pointer-events-auto relative w-full max-w-2xl bg-white/90 dark:bg-[#111118d9] backdrop-blur-xl border border-[var(--border-default)] dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* 头部 */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-default)] dark:border-white/10 bg-[var(--bg-secondary)]/50 dark:bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Keyboard className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                      键盘快捷键
                    </h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      使用快捷键提高工作效率
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onOpenChange(false)}
                  className="p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors group"
                >
                  <X className="w-5 h-5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                </button>
              </div>

              {/* 内容 */}
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                {SHORTCUTS.map((group) => (
                  <div key={group.category} className="space-y-4">
                    <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      {group.category}
                    </h3>
                    <div className="space-y-3">
                      {group.items.map((shortcut, index) => (
                        <div key={index} className="flex items-center justify-between group/item">
                          <span className="text-sm text-[var(--text-secondary)] group-hover/item:text-[var(--text-primary)] transition-colors">
                            {shortcut.description}
                          </span>
                          <div className="flex items-center gap-1.5 direction-ltr">
                            {shortcut.key.map((k, i) => (
                              <kbd
                                key={i}
                                className="min-w-[24px] h-6 px-1.5 flex items-center justify-center bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded text-xs font-mono text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] shadow-sm"
                              >
                                {k === '⌘' ? <Command className="w-3 h-3" /> : k}
                              </kbd>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* 底部提示 */}
              <div className="px-6 py-4 bg-[var(--bg-secondary)]/50 dark:bg-white/5 border-t border-[var(--border-default)] dark:border-white/10">
                <p className="text-xs text-[var(--text-muted)] text-center">
                  Windows 系统下 <kbd className="font-mono bg-[var(--bg-tertiary)] dark:bg-[var(--bg-tertiary)] px-1 rounded mx-0.5 text-[var(--text-secondary)] dark:text-[var(--text-tertiary)]">⌘</kbd> 对应 <kbd className="font-mono bg-[var(--bg-tertiary)] dark:bg-[var(--bg-tertiary)] px-1 rounded mx-0.5 text-[var(--text-secondary)] dark:text-[var(--text-tertiary)]">Ctrl</kbd> 键
                </p>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
