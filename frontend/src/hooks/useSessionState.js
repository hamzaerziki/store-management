import { useEffect, useState } from 'react';

export default function useSessionState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? initialValue : JSON.parse(raw);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { return undefined; }
  }, [key, value]);

  return [value, setValue];
}
