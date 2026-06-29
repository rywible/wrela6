import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrOperationId, OptIrRegionId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import { makeOptIrVerifierDiagnostic, type OptIrVerifierContext } from "./structural-verifier";

export function verifyOptIrRegions(input: {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly context: OptIrVerifierContext;
}): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  for (const operation of input.operations.values()) {
    if (operation.effects.readsRegionVersion || operation.effects.writesRegionVersion) {
      const region = memoryRegionForOperation(operation);
      if (region === undefined || !input.program.regions.has(region)) {
        diagnostics.push(
          makeOptIrVerifierDiagnostic({
            code: "OPT_IR_EFFECT_TOKEN_INCOMPLETE",
            messageTemplate:
              "Effectful operation does not reference an existing represented region token.",
            ownerKey: `operation:${operation.operationId}`,
            rootCauseKey: region === undefined ? "region:missing" : `region:${region}`,
            stableDetail: `effect-region-token:${operation.operationId}:${region ?? "missing"}`,
            originId: operation.originId,
            functionId: input.context.functionId,
          }),
        );
      }
    }
  }
  return diagnostics;
}

function memoryRegionForOperation(operation: OptIrOperation): OptIrRegionId | undefined {
  switch (operation.kind) {
    case "memoryLoad":
    case "memoryStore":
    case "vectorLoad":
    case "vectorStore":
    case "vectorMaskedLoad":
    case "vectorMaskedStore":
      return operation.memoryAccess.region;
    default:
      return undefined;
  }
}
