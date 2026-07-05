import { targetId } from "../../semantic/ids";
import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import type { OptIrProgram } from "../program";
import { stableDigestHex, stableJson } from "../../shared/stable-json";
export { stableDigestHex, stableJson } from "../../shared/stable-json";
import type { OptimizeOptIrResult, OptimizedOptIrProvenanceSnapshot } from "./pipeline-types";

export function stableProgram(program: OptIrProgram): unknown {
  return {
    programId: program.programId,
    targetId: program.targetId,
    functions: program.functions.entries().map((func) => ({
      ...func,
      edges: func.edges.entries(),
    })),
    regions: program.regions.entries(),
    constants: program.constants.entries(),
    callGraph: program.callGraph,
    provenance: program.provenance,
  };
}

export function stableOptimizedOptIrResultKey(result: OptimizeOptIrResult): string {
  if (result.kind === "error") {
    return stableJson({ kind: result.kind, diagnostics: result.diagnostics });
  }
  return stableJson({
    kind: result.kind,
    program: stableProgram(result.program),
    operations: result.operations,
    optimizationRegions: result.optimizationRegions,
    facts: result.facts,
    provenance: result.provenance,
    decisionLog: result.decisionLog.entries(),
    diagnostics: result.diagnostics,
  });
}

export function snapshotOptimizedProvenance(
  originIds: readonly OptimizedOptIrProvenanceSnapshot["originIds"][number][],
): OptimizedOptIrProvenanceSnapshot {
  const snapshot = Object.freeze([...originIds].sort((left, right) => left - right));
  return Object.freeze({
    originIds: snapshot,
    fingerprint: {
      authorityKind: "semantics" as const,
      targetId: targetId("opt-ir-provenance"),
      version: "opt-ir-optimization-v1",
      digestAlgorithm: "sha256" as const,
      digestHex: stableDigestHex(snapshot),
    },
  });
}

export function pipelineDiagnostic(input: {
  readonly code: Parameters<typeof optIrDiagnosticCode>[0];
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly severity?: OptIrDiagnostic["severity"];
}): OptIrDiagnostic {
  const diagnosticCode = optIrDiagnosticCode(input.code);
  return {
    severity: input.severity ?? "error",
    code: diagnosticCode,
    messageTemplate: input.stableDetail,
    arguments: {},
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code: diagnosticCode,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
}
