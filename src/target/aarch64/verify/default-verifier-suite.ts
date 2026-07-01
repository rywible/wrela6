import { aarch64AbiVerifierDescriptor } from "./abi-verifier";
import { aarch64FactPreservationVerifierDescriptor } from "./fact-preservation-verifier";
import { aarch64FpEnvironmentVerifierDescriptor } from "./fp-environment-verifier";
import { aarch64MemoryOrderVerifierDescriptor } from "./memory-order-verifier";
import { aarch64NzcvVerifierDescriptor } from "./nzcv-verifier";
import { aarch64RegionVerifierDescriptor } from "./region-verifier";
import { aarch64SchedulerVerifierDescriptor } from "./scheduler-verifier";
import { aarch64SecurityVerifierDescriptor } from "./security-verifier";
import { aarch64StructuralVerifierDescriptor } from "./structural-verifier";
import { aarch64SuperselectionVerifierDescriptor } from "./superselection-verifier";
import { aarch64TilingVerifierDescriptor } from "./tiling-verifier";
import {
  AARCH64_MACHINE_VERIFIER_KEYS,
  type AArch64MachineVerifierDescriptor,
  type AArch64MachineVerifierKey,
} from "./verifier-suite";

export const AARCH64_MACHINE_VERIFIER_DESCRIPTORS: Readonly<
  Record<AArch64MachineVerifierKey, AArch64MachineVerifierDescriptor>
> = Object.freeze({
  structural: aarch64StructuralVerifierDescriptor,
  nzcv: aarch64NzcvVerifierDescriptor,
  abi: aarch64AbiVerifierDescriptor,
  regions: aarch64RegionVerifierDescriptor,
  facts: aarch64FactPreservationVerifierDescriptor,
  tiling: aarch64TilingVerifierDescriptor,
  superselection: aarch64SuperselectionVerifierDescriptor,
  "memory-order": aarch64MemoryOrderVerifierDescriptor,
  scheduler: aarch64SchedulerVerifierDescriptor,
  "fp-environment": aarch64FpEnvironmentVerifierDescriptor,
  security: aarch64SecurityVerifierDescriptor,
});

export const defaultAArch64MachineVerifierSuite = Object.freeze(
  AARCH64_MACHINE_VERIFIER_KEYS.map(
    (verifierKey) => AARCH64_MACHINE_VERIFIER_DESCRIPTORS[verifierKey],
  ),
);
