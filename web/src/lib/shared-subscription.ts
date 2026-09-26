/// One upstream subscription per key, however many listeners share it.
///
/// A listener that joins late is handed the last value at once. `retain` says
/// which values are state worth handing over: an event such as "something
/// changed" is not, because replaying it makes every late listener act on a
/// change it already read past.
export function shareSubscription<T extends unknown[]>(
  start: (key: string, changed: (...value: T) => void, failed: (error: string) => void) => () => void,
  retain: (...value: T) => boolean = () => true,
) {
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
        if (retain(...value)) current.value = value;
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
      if (current.listeners.size) return;
      // A view that unsubscribes and subscribes again in the same commit — a
      // changed effect key, a remount — keeps the subscription and its value
      // rather than closing it and reading everything again.
      setTimeout(() => {
        if (!current.listeners.size && active.get(key) === current) {
          active.delete(key);
          current.stop();
        }
      }, 0);
    };
  };
}
