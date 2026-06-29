import { optIrOperationEffectMetadataForKind } from "../operation-effects";
import { optIrOperationSemanticsMetadataForKind } from "../operation-semantics";
import type { OptIrOperation } from "../operations";
import { makeOptIrVerifierDiagnostic, type OptIrVerifierContext } from "./structural-verifier";

export function verifyOptIrOperationMetadata(input: {
  readonly operation: OptIrOperation;
  readonly context: OptIrVerifierContext;
}) {
  const expectedSemantics = optIrOperationSemanticsMetadataForKind(input.operation.kind);
  const expectedEffects = optIrOperationEffectMetadataForKind(input.operation.kind);
  if (
    stableStringify(input.operation.semantics) === stableStringify(expectedSemantics) &&
    stableStringify(input.operation.effects) === stableStringify(expectedEffects)
  ) {
    return [];
  }

  return [
    makeOptIrVerifierDiagnostic({
      code: "OPT_IR_OPERATION_METADATA_MISMATCH",
      messageTemplate: "Operation cached metadata does not match schema-derived metadata.",
      ownerKey: `operation:${input.operation.operationId}`,
      rootCauseKey: `operation-kind:${input.operation.kind}`,
      stableDetail: `metadata-mismatch:${input.operation.kind}:${input.operation.operationId}`,
      originId: input.operation.originId,
      functionId: input.context.functionId,
    }),
  ];
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (nestedValue === null || typeof nestedValue !== "object" || Array.isArray(nestedValue)) {
      return nestedValue;
    }
    return Object.fromEntries(
      Object.entries(nestedValue as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  });
}
