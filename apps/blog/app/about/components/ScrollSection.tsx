'use client';

import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useIntersectionObserver } from '@aetherblog/hooks';

interface ScrollSectionProps {
  children: React.ReactNode | ((isVisible: boolean) => React.ReactNode);
  className?: string;
  id?: string;
}

export default function ScrollSection({ children, className, id }: ScrollSectionProps) {
  const [ref, isVisible] = useIntersectionObserver<HTMLElement>({
    threshold: 0.15,
    freezeOnceVisible: true,
  });

  return (
    <section
      ref={ref}
      id={id}
      className={`min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-20 ${className || ''}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-6xl mx-auto w-full"
      >
        {typeof children === 'function' ? children(isVisible) : children}
      </motion.div>
    </section>
  );
}
