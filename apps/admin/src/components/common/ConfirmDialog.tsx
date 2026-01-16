'use client';

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
      iconBg: 'bg-gradient-to-br from-red-500/20 to-red-600/10',
      iconColor: 'text-red-400',
      iconGlow: 'shadow-[0_0_20px_rgba(239,68,68,0.3)]',
      buttonBg: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
      buttonShadow: 'shadow-lg shadow-red-500/25',
    },
    warning: {
      icon: AlertTriangle,
      iconBg: 'bg-gradient-to-br from-amber-500/20 to-orange-600/10',
      iconColor: 'text-amber-400',
      iconGlow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]',
      buttonBg: 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600',
      buttonShadow: 'shadow-lg shadow-amber-500/25',
    },
    info: {
      icon: Info,
      iconBg: 'bg-gradient-to-br from-primary/20 to-violet-600/10',
      iconColor: 'text-primary',
      iconGlow: 'shadow-[0_0_20px_rgba(99,102,241,0.3)]',
      buttonBg: 'bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-700',
      buttonShadow: 'shadow-lg shadow-primary/25',
    },
    copy: {
      icon: Copy,
      iconBg: 'bg-gradient-to-br from-primary/20 to-violet-600/10',
      iconColor: 'text-primary',
      iconGlow: 'shadow-[0_0_20px_rgba(99,102,241,0.3)]',
      buttonBg: 'bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-700',
      buttonShadow: 'shadow-lg shadow-primary/25',
    },
  };

  const config = variantConfig[variant];
  const IconComponent = config.icon;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            onClick={onCancel}
          />
          
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="relative w-full max-w-md"
          >
            {/* Card with glassmorphism */}
            <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] shadow-2xl backdrop-blur-xl">
              {/* Subtle gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-overlay)] to-transparent pointer-events-none" />
              
              {/* Close button */}
              <button
                onClick={onCancel}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors z-10"
              >
                <X className="w-4 h-4" />
              </button>
              
              {/* Content */}
              <div className="relative p-6">
                <div className="flex items-start gap-4">
                  {/* Icon */}
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
                  
                  {/* Text */}
                  <div className="flex-1 pt-1">
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
                    <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">{message}</p>
                  </div>
                </div>
                
                {/* Actions */}
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
}

export default ConfirmDialog;
