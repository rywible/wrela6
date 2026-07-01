import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64ObjectModule } from "../object/object-module";
import type { AArch64BackendFactIndex } from "../facts/backend-fact-query";
import type {
  AArch64BackendDebugArtifactRequest,
  AArch64BackendDebugArtifacts,
} from "./backend-debug-artifacts";
import { defaultAArch64BackendPipeline } from "./backend-pipeline";
import {
  aarch64BackendVerificationSummary,
  verifierRun,
  type AArch64BackendVerificationSummary,
} from "./verification-summary";

export function collectAArch64BackendDebugArtifacts(
  request: AArch64BackendDebugArtifactRequest | undefined,
  verifierKeys: readonly string[],
  context: {
    readonly factIndex?: AArch64BackendFactIndex;
    readonly objectModule?: AArch64ObjectModule;
    readonly layoutTrace?: readonly string[];
    readonly allocationPlan?: readonly string[];
    readonly framePlan?: readonly string[];
  } = {},
): AArch64BackendDebugArtifacts | undefined {
  const requested = Object.entries(request ?? {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
    .sort(compareCodeUnitStrings);
  if (requested.length === 0) return undefined;
  return Object.freeze({
    stableKey: "aarch64-backend-debug-artifacts",
    requested: Object.freeze(requested),
    ...(request?.verifierTrace === true ? { verifierTrace: Object.freeze([...verifierKeys]) } : {}),
    ...(request?.allocationPlan === true
      ? {
          allocationPlan: Object.freeze(
            [...(context.allocationPlan ?? [])].sort(compareCodeUnitStrings),
          ),
        }
      : {}),
    ...(request?.framePlan === true
      ? { framePlan: Object.freeze([...(context.framePlan ?? [])].sort(compareCodeUnitStrings)) }
      : {}),
    ...(request?.layoutTrace === true
      ? {
          layoutTrace: Object.freeze([...(context.layoutTrace ?? [])].sort(compareCodeUnitStrings)),
        }
      : {}),
    ...(request?.factTransferGraph === true
      ? {
          factTransferGraph: Object.freeze(
            (context.factIndex?.allFacts() ?? []).map(
              (fact) => `${fact.family}:${fact.subjectKey}`,
            ),
          ),
        }
      : {}),
    ...(request?.byteProvenance === true
      ? {
          byteProvenance: Object.freeze(
            (context.objectModule?.byteProvenance ?? []).map(
              (record) =>
                `${record.sectionKey}:${record.startOffsetBytes}:${record.byteLength}:${record.source}`,
            ),
          ),
        }
      : {}),
    factSpendingSummary: Object.freeze(
      (context.objectModule?.factSpending ?? []).map(
        (record) => `${record.authority}:${record.payload}`,
      ),
    ),
  });
}

export function passedAArch64BackendVerification(): AArch64BackendVerificationSummary {
  return aarch64BackendVerificationSummary({
    runs: [
      verifierRun({ verifierKey: "input-contract" }),
      ...defaultAArch64BackendPipeline.map((stage) => verifierRun({ verifierKey: stage.stageKey })),
      verifierRun({ verifierKey: "object-module" }),
    ],
  });
}

export function failedAArch64BackendVerification(
  failedVerifierKey: string,
  inputContractOnly = false,
): AArch64BackendVerificationSummary {
  if (inputContractOnly) {
    return aarch64BackendVerificationSummary({
      runs: [verifierRun({ verifierKey: "input-contract", status: "failed" })],
    });
  }
  const runs = [];
  for (const stage of defaultAArch64BackendPipeline) {
    const verifierKey =
      stage.stageKey === "verify-input-contract" ? "input-contract" : stage.stageKey;
    runs.push(
      verifierRun({
        verifierKey,
        status:
          verifierKey === failedVerifierKey || stage.stageKey === failedVerifierKey
            ? "failed"
            : "passed",
      }),
    );
    if (verifierKey === failedVerifierKey || stage.stageKey === failedVerifierKey) break;
  }
  return aarch64BackendVerificationSummary({ runs });
}
