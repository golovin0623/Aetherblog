'use client';

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Copy, Trash2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'copy';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  
  const variantConfig = {
    danger: {
      icon: Trash2,
      iconBg: 'bg-gradient-to-br from-status-danger/20 to-status-danger/10',
      iconColor: 'text-status-danger',
      iconGlow: 'shadow-[0_0_20px_rgba(239,68,68,0.3)]',
      buttonBg: 'bg-gradient-to-r from-status-danger to-status-danger hover:from-status-danger hover:to-status-danger',
      buttonShadow: 'shadow-lg shadow-status-danger/25',
    },
    warning: {
      icon: AlertTriangle,
      iconBg: 'bg-gradient-to-br from-status-warning/20 to-status-warning/10',
      iconColor: 'text-status-warning',
      iconGlow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]',
      buttonBg: 'bg-gradient-to-r from-status-warning to-status-warning hover:from-status-warning hover:to-status-warning',
      buttonShadow: 'shadow-lg shadow-status-warning/25',
    },
    info: {
      icon: Info,
      iconBg: 'bg-gradient-to-br from-primary/20 to-accent/10',
      iconColor: 'text-primary',
      iconGlow: 'shadow-[0_0_20px_rgba(99,102,241,0.3)]',
      buttonBg: 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90',
      buttonShadow: 'shadow-lg shadow-primary/25',
    },
    copy: {
      icon: Copy,
      iconBg: 'bg-gradient-to-br from-primary/20 to-accent/10',
      iconColor: 'text-primary',
      iconGlow: 'shadow-[0_0_20px_rgba(99,102,241,0.3)]',
      buttonBg: 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90',
      buttonShadow: 'shadow-lg shadow-primary/25',
    },
  };

  const config = variantConfig[variant];
  const IconComponent = config.icon;

  const content = (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            onClick={onCancel}
          />
          
          {/* 对话框 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="relative w-full max-w-md"
          >
            {/* 玻璃拟态卡片 —— 规范 surface-overlay 层级（40px blur + aurora 辉光边）*/}
            <div className="relative overflow-hidden surface-overlay">
              {/* 微妙的渐变叠加 */}
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-overlay)] to-transparent pointer-events-none" />
              
              {/* 关闭按钮 */}
              <button
                onClick={onCancel}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors z-10"
              >
                <X className="w-4 h-4" />
              </button>
              
              {/* 内容 */}
              <div className="relative p-6">
                <div className="flex items-start gap-4">
                  {/* 图标 */}
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', delay: 0.1, duration: 0.4, bounce: 0.4 }}
                    className={cn(
                      'flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center',
                      config.iconBg,
                      config.iconGlow
                    )}
                  >
                    <IconComponent className={cn('w-6 h-6', config.iconColor)} />
                  </motion.div>
                  
                  {/* 文本 */}
                  <div className="flex-1 pt-1">
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
                    <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">{message}</p>
                  </div>
                </div>
                
                {/* 操作按钮 */}
                <div className="flex justify-end gap-3 mt-8">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onCancel}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all duration-200"
                  >
                    {cancelText}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onConfirm}
                    className={cn(
                      'px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200',
                      config.buttonBg,
                      config.buttonShadow
                    )}
                  >
                    {confirmText}
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

export default ConfirmDialog;
