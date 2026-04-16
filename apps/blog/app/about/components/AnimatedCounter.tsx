'use client';

import { useEffect } from 'react';
import { useSpring, useTransform, motion } from 'framer-motion';

interface Props {
  target: number;
  isVisible: boolean;
  suffix?: string;
  className?: string;
}

export default function AnimatedCounter({ target, isVisible, suffix = '', className }: Props) {
  const springValue = useSpring(0, { stiffness: 180, damping: 24 });
  const display = useTransform(springValue, v => Math.round(v).toLocaleString());

  useEffect(() => {
    if (isVisible) springValue.set(target);
  }, [isVisible, target, springValue]);

  return (
    <span className={`tnum ${className || ''}`}>
      <motion.span>{display}</motion.span>
      {suffix && <span className="ml-1 text-[var(--ink-muted)]">{suffix}</span>}
    </span>
  );
}
