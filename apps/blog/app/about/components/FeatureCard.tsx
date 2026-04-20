'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { useSpotlightEffect } from '@/app/hooks/useSpotlightEffect';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
}

function FeatureCard({ icon, title, description, className }: FeatureCardProps) {
  const {
    spotlightRef,
    isHovering,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
  } = useSpotlightEffect({ radius: 600 });

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className={`relative surface-leaf rounded-2xl border border-[var(--ink-subtle)]/20 p-6 overflow-hidden ${className || ''}`}
      data-interactive
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Spotlight overlay */}
      <div
        ref={spotlightRef}
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
        style={{ opacity: isHovering ? 'var(--spotlight-opacity)' : 0 }}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative z-10">
        <div className="mb-4 text-[var(--aurora-1)]">
          {icon}
        </div>
        <h3 className="text-h4 font-display font-semibold text-[var(--ink-primary)] mb-2">
          {title}
        </h3>
        <p className="text-body text-[var(--ink-muted)] leading-relaxed">
          {description}
        </p>
      </div>
    </motion.div>
  );
}

export default memo(FeatureCard);
