export function shareSubscription<T extends unknown[]>(start: (key: string, changed: (...value: T) => void, failed: (error: string) => void) => () => void) {
  type Listener = { changed: (...value: T) => void; failed: (error: string) => void };
  const active = new Map<string, { listeners: Set<Listener>; value?: T; error?: string; stop: () => void }>();
  return (key: string, changed: (...value: T) => void, failed: (error: string) => void) => {
    const listener = { changed, failed };
    let entry = active.get(key);
    if (!entry) {
      entry = { listeners: new Set([listener]), stop: () => {} };
      active.set(key, entry);
      const current = entry;
      current.stop = start(key, (...value) => {
        current.value = value;
        current.error = undefined;
        for (const item of current.listeners) item.changed(...value);
      }, error => {
        current.error = error;
        for (const item of current.listeners) item.failed(error);
      });
    } else {
      entry.listeners.add(listener);
      if (entry.value) changed(...entry.value);
      if (entry.error) failed(entry.error);
    }
    const current = entry;
    return () => {
      current.listeners.delete(listener);
      if (!current.listeners.size && active.get(key) === current) {
        active.delete(key);
        current.stop();
      }
    };
  };
}
