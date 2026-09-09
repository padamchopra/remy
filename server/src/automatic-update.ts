export type AutomaticUpdatePhase =
  "idle" | "downloading" | "waiting" | "countdown" | "installing" | "failed";
export interface AutomaticUpdateStatus {
  phase: AutomaticUpdatePhase;
  deadline?: number;
  snoozedUntil?: number;
  error?: string;
}

/// The owning computer decides when it is safe to restart; clients only display
/// the deadline and request an action against the current countdown.
export class AutomaticUpdate {
  status: AutomaticUpdateStatus = { phase: "idle" };
  private nextCheck = 0;
  private enabled = false;
  private available = false;
  private busy = true;
  private downloadStarted = 0;
  constructor(
    private readonly effects: {
      download: () => void;
      install: () => void;
      changed: () => void;
      now: () => number;
    },
  ) {}

  tick(enabled: boolean, available: boolean, busy: boolean): void {
    this.enabled = enabled;
    this.available = available;
    this.busy = busy;
    const now = this.effects.now();
    if (!available) {
      this.nextCheck = 0;
      if (this.status.phase !== "idle") this.set({ phase: "idle" });
      return;
    }
    if (
      this.status.phase === "downloading" &&
      now - this.downloadStarted > 20 * 60_000
    ) {
      this.fail("The update download timed out; Remy will try again.");
      return;
    }
    if (!enabled || busy) {
      if (this.status.phase === "countdown") this.set({ phase: "waiting" });
      return;
    }
    if (
      (this.status.phase === "idle" || this.status.phase === "failed") &&
      now >= this.nextCheck
    ) {
      this.nextCheck = now + 60 * 60_000;
      this.downloadStarted = now;
      this.set({ phase: "downloading" });
      this.effects.download();
    } else if (
      this.status.phase === "waiting" &&
      now >= (this.status.snoozedUntil ?? 0)
    ) {
      this.set({ phase: "countdown", deadline: now + 30_000 });
    } else if (
      this.status.phase === "countdown" &&
      now >= this.status.deadline!
    ) {
      this.relaunch(this.status.deadline!);
    }
  }

  downloaded(found: boolean): void {
    if (this.status.phase !== "downloading") return;
    this.set({ phase: found ? "waiting" : "idle" });
  }

  fail(error: string): void {
    this.nextCheck = this.effects.now() + 5 * 60_000;
    this.set({ phase: "failed", error });
  }

  snooze(deadline: number): void {
    this.assertCountdown(deadline);
    this.set({
      phase: "waiting",
      snoozedUntil: this.effects.now() + 5 * 60_000,
    });
  }

  relaunch(deadline: number): void {
    this.assertCountdown(deadline);
    if (!this.enabled || !this.available || this.busy)
      throw new Error("Remy will update when your threads settle.");
    this.set({ phase: "installing" });
    this.effects.install();
  }

  private assertCountdown(deadline: number): void {
    if (
      this.status.phase !== "countdown" ||
      deadline !== this.status.deadline
    ) {
      throw new Error("That update countdown has ended.");
    }
  }

  private set(status: AutomaticUpdateStatus): void {
    this.status = status;
    this.effects.changed();
  }
}
