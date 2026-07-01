export const AARCH64_BACKEND_STAGE_KEYS = [
  "verify-input-contract",
  "import-backend-facts",
  "verify-closed-image-plan",
  "classify-public-abi",
  "reconcile-call-boundaries",
  "build-liveness-and-interference",
  "allocate-registers",
  "repair-spills-and-remats",
  "resolve-parallel-copies",
  "verify-allocation",
  "layout-frames",
  "finalize-prologue-epilogue-tail-trap-noreturn",
  "plan-unwind",
  "build-physical-ir-and-expand-pseudos",
  "post-ra-schedule-and-peephole",
  "layout-and-encode",
  "assemble-object-module",
  "verify-object-module",
  "debug-artifact-collection",
  "end-to-end-stage-wiring",
] as const;

export type AArch64BackendStageKey = (typeof AARCH64_BACKEND_STAGE_KEYS)[number];

export interface AArch64BackendPipelineStage {
  readonly stageKey: AArch64BackendStageKey;
}

export const defaultAArch64BackendPipeline: readonly AArch64BackendPipelineStage[] = Object.freeze(
  AARCH64_BACKEND_STAGE_KEYS.map((stageKey) => Object.freeze({ stageKey })),
);
