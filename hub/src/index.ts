import { CONTRACT_VERSION } from "@remy/contract";

export {
  computerRuntimeProviders,
  type ComputerRuntime,
  type ComputerRuntimeCapabilities,
  type ComputerRuntimeProvider,
  type ProvisionComputerInput,
} from "./computer-runtime.js";

export const supportedContractVersion = CONTRACT_VERSION;
