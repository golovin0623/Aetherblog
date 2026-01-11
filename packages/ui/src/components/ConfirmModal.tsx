import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../utils';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title = '确认操作',
  message,
  confirmText = '确定',
  cancelText = '取消',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const variantStyles = {
    danger: {
      icon: 'bg-red-500/20 text-red-400',
      button: 'bg-red-500 hover:bg-red-600 text-white',
    },
    warning: {
      icon: 'bg-yellow-500/20 text-yellow-400',
      button: 'bg-yellow-500 hover:bg-yellow-600 text-black',
    },
    info: {
      icon: 'bg-blue-500/20 text-blue-400',
      button: 'bg-blue-500 hover:bg-blue-600 text-white',
    },
  };

  const styles = variantStyles[variant];

  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onCancel]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="relative z-10 w-full max-w-md"
          >
            <div className={cn(
              'rounded-2xl p-6',
              'bg-[#0a0a0c]/95 backdrop-blur-xl',
              'border border-white/10',
              'shadow-2xl shadow-black/50'
            )}>
              {/* Close button */}
              <button
                onClick={onCancel}
                className="absolute right-4 top-4 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Icon */}
              <div className={cn('w-12 h-12 rounded-full flex items-center justify-center mb-4', styles.icon)}>
                <AlertTriangle className="w-6 h-6" />
              </div>

              {/* Content */}
              <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
              <p className="text-gray-400 mb-6">{message}</p>

              {/* Actions */}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={onCancel}
                  className={cn(
                    'px-4 py-2.5 rounded-lg font-medium transition-colors',
                    'bg-white/5 text-gray-300 hover:bg-white/10'
                  )}
                >
                  {cancelText}
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onConfirm}
                  className={cn(
                    'px-4 py-2.5 rounded-lg font-medium transition-colors',
                    styles.button
                  )}
                >
                  {confirmText}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
