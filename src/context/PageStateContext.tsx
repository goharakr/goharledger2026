import { createContext, useContext, useRef, useState, type ReactNode } from 'react';

interface PageStateContextType {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}

const PageStateContext = createContext<PageStateContextType | null>(null);

// Mounted once, above the router, so its ref survives a page unmounting and
// remounting on navigation - unlike a page's own useState, which resets every
// time you leave and come back.
export function PageStateProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<Record<string, unknown>>({});
  const value: PageStateContextType = {
    get: (key) => storeRef.current[key],
    set: (key, val) => { storeRef.current[key] = val; },
  };
  return <PageStateContext.Provider value={value}>{children}</PageStateContext.Provider>;
}

// Drop-in replacement for useState with the exact same [value, setter] shape,
// except the value lives in PageStateProvider's ref instead of the component
// instance - so navigating away and back restores it instead of resetting to
// the initial value. `key` must be unique per field per page.
export function usePersistentState<T>(key: string, initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
  const ctx = useContext(PageStateContext);
  if (!ctx) throw new Error('usePersistentState must be used within PageStateProvider');

  const [state, setState] = useState<T>(() => {
    const existing = ctx.get(key);
    if (existing !== undefined) return existing as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  const setPersistent = (v: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof v === 'function' ? (v as (prev: T) => T)(prev) : v;
      ctx.set(key, next);
      return next;
    });
  };

  return [state, setPersistent];
}
