export interface VirtualLayout {
  starts: number[];
  sizes: number[];
  total: number;
}

export interface VirtualRange {
  start: number;
  end: number;
}

export function virtualLayout(
  keys: readonly string[],
  measured: ReadonlyMap<string, number>,
  estimate: number,
  gap: number,
): VirtualLayout {
  const starts: number[] = [];
  const sizes: number[] = [];
  let top = 0;
  for (const key of keys) {
    starts.push(top);
    const size = measured.get(key) ?? estimate;
    sizes.push(size);
    top += size + gap;
  }
  return { starts, sizes, total: Math.max(0, top - gap) };
}

export function virtualRange(
  layout: VirtualLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): VirtualRange {
  if (layout.starts.length === 0) return { start: 0, end: -1 };
  const first = rowAt(layout, Math.max(0, scrollTop - overscan));
  const last = rowAt(layout, Math.max(0, scrollTop + viewportHeight + overscan));
  return { start: first, end: Math.min(layout.starts.length - 1, last) };
}

export function rowAt(layout: VirtualLayout, offset: number): number {
  let low = 0;
  let high = layout.starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (layout.starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
