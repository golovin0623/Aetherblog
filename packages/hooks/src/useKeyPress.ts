import { useState, useEffect } from 'react';

export function useKeyPress(targetKey: string): boolean {
  const [keyPressed, setKeyPressed] = useState(false);

  useEffect(() => {
    const downHandler = (event: KeyboardEvent) => {
      if (event.key === targetKey) {
        setKeyPressed(true);
      }
    };

    const upHandler = (event: KeyboardEvent) => {
      if (event.key === targetKey) {
        setKeyPressed(false);
      }
    };

    window.addEventListener('keydown', downHandler);
    window.addEventListener('keyup', upHandler);

    return () => {
      window.removeEventListener('keydown', downHandler);
      window.removeEventListener('keyup', upHandler);
    };
  }, [targetKey]);

  return keyPressed;
}

// 按键组合 Hook
export function useKeyCombo(keys: string[], callback: () => void): void {
  useEffect(() => {
    const pressedKeys = new Set<string>();

    const downHandler = (event: KeyboardEvent) => {
      pressedKeys.add(event.key.toLowerCase());
      if (keys.every((key) => pressedKeys.has(key.toLowerCase()))) {
        callback();
      }
    };

    const upHandler = (event: KeyboardEvent) => {
      pressedKeys.delete(event.key.toLowerCase());
    };

    window.addEventListener('keydown', downHandler);
    window.addEventListener('keyup', upHandler);

    return () => {
      window.removeEventListener('keydown', downHandler);
      window.removeEventListener('keyup', upHandler);
    };
  }, [keys, callback]);
}
