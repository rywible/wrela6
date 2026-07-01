import { AARCH64_BACKEND_STAGE_KEYS, type AArch64BackendStageKey } from "./backend-pipeline";
import {
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "./diagnostics";

export type AArch64FunctionStageResult<Value> =
  | {
      readonly kind: "ok";
      readonly value: Value;
    }
  | AArch64FunctionStageFailure;

export interface AArch64FunctionStageFailure {
  readonly kind: "error";
  readonly failedStage: AArch64BackendStageKey;
  readonly diagnostics: readonly AArch64BackendDiagnostic[];
}

export function runAArch64FunctionStage<Value>(input: {
  readonly stageKey: AArch64BackendStageKey;
  readonly execute: () => AArch64BackendResult<Value>;
}): AArch64FunctionStageResult<Value> {
  const result = input.execute();
  if (result.kind === "error")
    return aarch64FunctionStageFailure(input.stageKey, result.diagnostics);
  return { kind: "ok", value: result.value };
}

export function aarch64FunctionStageFailure(
  failedStage: AArch64BackendStageKey,
  diagnostics: readonly AArch64BackendDiagnostic[],
): AArch64FunctionStageFailure {
  return {
    kind: "error",
    failedStage,
    diagnostics: sortAArch64BackendDiagnostics(diagnostics),
  };
}

export function earlierAArch64BackendStage(
  current: AArch64BackendStageKey | undefined,
  candidate: AArch64BackendStageKey,
): AArch64BackendStageKey {
  if (current === undefined) return candidate;
  return stageOrder(candidate) < stageOrder(current) ? candidate : current;
}

function stageOrder(stageKey: AArch64BackendStageKey): number {
  const index = AARCH64_BACKEND_STAGE_KEYS.indexOf(stageKey);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
