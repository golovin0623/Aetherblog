import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface FocusModeValue {
  isFocus: boolean;
  toggle: () => void;
  enter: () => void;
  exit: () => void;
}

const FocusModeContext = createContext<FocusModeValue | null>(null);

export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [isFocus, setIsFocus] = useState(false);

  const toggle = useCallback(() => setIsFocus(v => !v), []);
  const enter = useCallback(() => setIsFocus(true), []);
  const exit = useCallback(() => setIsFocus(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘. or Ctrl+. toggles focus mode
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setIsFocus(v => !v);
      } else if (e.key === 'Escape' && isFocus) {
        setIsFocus(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFocus]);

  useEffect(() => {
    const root = document.documentElement;
    if (isFocus) root.setAttribute('data-focus-mode', 'true');
    else root.removeAttribute('data-focus-mode');
    return () => { root.removeAttribute('data-focus-mode'); };
  }, [isFocus]);

  const value = useMemo(() => ({ isFocus, toggle, enter, exit }), [isFocus, toggle, enter, exit]);

  return (
    <FocusModeContext.Provider value={value}>
      {children}
    </FocusModeContext.Provider>
  );
}

export function useFocusMode(): FocusModeValue {
  const ctx = useContext(FocusModeContext);
  if (!ctx) {
    // Graceful fallback for components rendered outside provider during hot-reload.
    return { isFocus: false, toggle: () => {}, enter: () => {}, exit: () => {} };
  }
  return ctx;
}
