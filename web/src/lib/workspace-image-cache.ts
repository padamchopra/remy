export function createWorkspaceImageCache(limit = 32, freshnessMs = 300_000) {
  const images = new Map<string, { src: string; savedAt: number }>();
  const pending = new Map<string, Promise<string>>();
  return {
    peek(key: string) { return images.get(key)?.src; },
    load(key: string, fetchImage: () => Promise<string>): Promise<string> {
      const image = images.get(key);
      if (image && Date.now() - image.savedAt < freshnessMs) return Promise.resolve(image.src);
      const existing = pending.get(key);
      if (existing) return existing;
      const request = fetchImage().then(src => {
        images.delete(key);
        images.set(key, { src, savedAt: Date.now() });
        while (images.size > limit) images.delete(images.keys().next().value!);
        return src;
      }).finally(() => { pending.delete(key); });
      pending.set(key, request);
      return request;
    },
  };
}
