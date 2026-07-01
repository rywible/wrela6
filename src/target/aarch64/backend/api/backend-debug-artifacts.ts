export interface AArch64BackendDebugArtifactRequest {
  readonly allocationPlan?: boolean;
  readonly framePlan?: boolean;
  readonly layoutTrace?: boolean;
  readonly verifierTrace?: boolean;
  readonly factTransferGraph?: boolean;
  readonly byteProvenance?: boolean;
}

export interface AArch64BackendDebugArtifacts {
  readonly stableKey: "aarch64-backend-debug-artifacts";
  readonly requested: readonly string[];
  readonly allocationPlan?: readonly string[];
  readonly framePlan?: readonly string[];
  readonly verifierTrace?: readonly string[];
  readonly layoutTrace?: readonly string[];
  readonly factTransferGraph?: readonly string[];
  readonly byteProvenance?: readonly string[];
  readonly factSpendingSummary?: readonly string[];
}
