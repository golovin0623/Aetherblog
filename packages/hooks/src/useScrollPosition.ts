'use client';
import { useState, useEffect } from 'react';

interface ScrollPosition {
  x: number;
  y: number;
}

export function useScrollPosition(): ScrollPosition {
  const [position, setPosition] = useState<ScrollPosition>(() => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 };
    }
    return { x: window.scrollX, y: window.scrollY };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleScroll = () => {
      setPosition({ x: window.scrollX, y: window.scrollY });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return position;
}

// Percentage-based scroll progress
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateProgress = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrolled = (window.scrollY / scrollHeight) * 100;
      setProgress(Math.min(100, Math.max(0, scrolled)));
    };

    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
    return () => window.removeEventListener('scroll', updateProgress);
  }, []);

  return progress;
}
