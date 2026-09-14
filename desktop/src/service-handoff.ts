export interface ServiceHealth {
  ok: boolean;
  release?: string;
  instance?: string;
}

export interface ServiceLifecycle {
  health(): Promise<ServiceHealth | undefined>;
  shutdown(instance: string): Promise<void>;
  stop(): Promise<void>;
  install(): Promise<void>;
  wait(): Promise<void>;
}

export async function ensureServiceRelease(release: string, lifecycle: ServiceLifecycle): Promise<void> {
  const health = await lifecycle.health();
  if (health?.ok && health.release === release && health.instance) return;
  if (health?.ok) {
    if (!health.instance || !health.release) {
      throw new Error("Remy needs a one-time restart after this update; finish your threads, restart your Mac, then reopen Remy.");
    }
    await lifecycle.shutdown(health.instance);
    await lifecycle.stop();
    for (let attempt = 0; ; attempt++) {
      if (!(await lifecycle.health())) break;
      if (attempt >= 40) throw new Error("Remy could not stop its older copy; restart your Mac after your threads finish.");
      await lifecycle.wait();
    }
  }
  await lifecycle.install();
  for (let attempt = 0; attempt < 120; attempt++) {
    const replacement = await lifecycle.health();
    if (replacement?.ok && replacement.release === release && replacement.instance && replacement.instance !== health?.instance) return;
    await lifecycle.wait();
  }
  throw new Error("Remy could not finish updating; reopen Remy to try again.");
}
