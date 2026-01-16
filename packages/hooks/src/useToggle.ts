'use client';

import { useState, useCallback } from 'react';

export function useToggle(initialValue = false): [boolean, () => void, (value: boolean) => void] {
  const [value, setValue] = useState(initialValue);

  const toggle = useCallback(() => {
    setValue((v) => !v);
  }, []);

  const setTo = useCallback((v: boolean) => {
    setValue(v);
  }, []);

  return [value, toggle, setTo];
}
