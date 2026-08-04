import { useRef, useState, useCallback } from 'react';

// A Save button with no in-flight guard can be clicked twice - once while
// the first click's request is still on the way to the server - and create
// two identical records, especially on a slow connection where nothing
// visibly happens right after the first click. This wraps a save handler so
// a second click while the first is still running is simply ignored, and
// exposes `saving` to disable the button and show a "Saving..." state so
// there's visible feedback instead of the silence that causes the retry-click
// in the first place.
export function useSaveGuard() {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const guard = useCallback((fn: () => Promise<void> | void) => {
    return async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSaving(true);
      try {
        await fn();
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    };
  }, []);

  return { saving, guard };
}
