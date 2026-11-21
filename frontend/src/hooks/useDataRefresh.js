import { useEffect } from 'react';

export const DATA_CHANGED_EVENT = 'safari:data-changed';

export function emitDataChanged(detail = {}) {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail }));
}

export function useDataRefresh(handler, deps = []) {
  useEffect(() => {
    if (typeof handler !== 'function') return undefined;
    let timer;
    const run = (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => handler(event?.detail), 150);
    };
    const onFocus = () => run({ type: 'focus' });
    const onVisible = () => { if (document.visibilityState === 'visible') run({ type: 'visible' }); };
    window.addEventListener(DATA_CHANGED_EVENT, run);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(DATA_CHANGED_EVENT, run);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
