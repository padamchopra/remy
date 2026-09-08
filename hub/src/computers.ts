import {
  COMPUTER_HEARTBEAT_TIMEOUT_MS,
  MINIMUM_COMPUTER_PROTOCOL_VERSION,
  computerRegistrationInputSchema,
  computerSummarySchema,
  type ComputerRegistrationInput,
} from "@remy/contract";
import type { ComputerStore } from "./computer-store.js";
import { OrganizationError } from "./organizations.js";

export class ComputerService {
  constructor(private readonly store: ComputerStore, private readonly now: () => number = Date.now, private readonly minimumDaemonVersion = "0.1.0") {}

  async register(organizationId: string, ownerUserId: string, input: ComputerRegistrationInput) {
    const parsed = computerRegistrationInputSchema.parse(input);
    const at = this.now();
    const computer = { ...parsed, organizationId, ownerUserId, registeredAt: at, updatedAt: at, lastSeenAt: null };
    if (await this.store.register(computer) === "conflict") throw new OrganizationError(409, "This computer is already registered.");
    const { lastSeenAt: _, ...registration } = computer;
    return registration;
  }

  async list(organizationId: string) {
    const now = this.now();
    return (await this.store.computers(organizationId)).map(({ publicKey: _, ...computer }) => computerSummarySchema.parse({
      ...computer,
      availability: computer.lastSeenAt !== null && now - computer.lastSeenAt <= COMPUTER_HEARTBEAT_TIMEOUT_MS ? "available" : "offline",
      updateRequired: computer.protocol.maximum < MINIMUM_COMPUTER_PROTOCOL_VERSION || versionBefore(computer.daemonVersion, this.minimumDaemonVersion),
    }));
  }
}

export function versionBefore(current: string, minimum: string): boolean {
  const parts = (value: string) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0];
  const left = parts(current); const right = parts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
}
