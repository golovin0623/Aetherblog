import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from './utils';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

const variants = {
  primary: 'bg-gradient-to-r from-primary to-purple-500 text-white hover:shadow-[var(--shadow-primary-lg)] shadow-[var(--shadow-primary)]',
  secondary: 'bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] border-2 border-transparent bg-clip-padding relative before:absolute before:inset-0 before:bg-gradient-to-r before:from-primary before:to-purple-500 before:rounded-lg before:-z-10 before:m-[-2px]',
  ghost: 'text-[var(--text-secondary)] hover:text-white hover:bg-gradient-to-r hover:from-primary/10 hover:to-purple-500/10',
  danger: 'bg-red-500 text-white hover:bg-red-600',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  onClick,
  className,
  type = 'button',
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium',
        'transition-colors duration-200',
        variants[variant],
        sizes[size],
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </motion.button>
  );
}
