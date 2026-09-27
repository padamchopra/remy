import { lazy, useState, type ComponentProps, type ComponentType } from "react";

/// A lazily loaded surface whose download can start before it is drawn.
///
/// `lazy` suspends on its first render even when the code has already arrived,
/// and React holds a revealed boundary back for a moment after a fallback, so
/// each lazy step on the way to a pane cost about a third of a second of
/// nothing. Once `preload` has landed, a new instance draws the module
/// directly. An instance keeps whichever form it started with, so it is never
/// remounted when the code lands.
export function preloadable<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let loaded: T | undefined;
  let pending: Promise<{ default: T }> | undefined;
  const preload = () => (pending ??= load().then((module) => { loaded = module.default; return module; }));
  const Lazy = lazy(preload) as unknown as ComponentType<ComponentProps<T>>;
  function Surface(props: ComponentProps<T>) {
    const [Ready] = useState(() => loaded as unknown as ComponentType<ComponentProps<T>> | undefined);
    return Ready ? <Ready {...props} /> : <Lazy {...props} />;
  }
  return { Surface, preload };
}
