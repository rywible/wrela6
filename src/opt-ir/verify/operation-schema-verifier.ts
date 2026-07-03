import { optIrOperationSchemaForKind } from "../operation-schema";
import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrOperation } from "../operations";
import { makeOptIrVerifierDiagnostic, type OptIrVerifierContext } from "./structural-verifier";

export function verifyOptIrOperationSchema(input: {
  readonly operation: OptIrOperation;
  readonly context: OptIrVerifierContext;
}): OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  try {
    optIrOperationSchemaForKind(input.operation.kind);
  } catch {
    diagnostics.push(
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_INPUT_CONTRACT_INVALID",
        messageTemplate: "Operation has no matching OptIR schema.",
        ownerKey: `operation:${input.operation.operationId}`,
        rootCauseKey: `operation-kind:${input.operation.kind}`,
        stableDetail: `missing-operation-schema:${input.operation.kind}`,
        originId: input.operation.originId,
        functionId: input.context.functionId,
      }),
    );
  }

  if (input.operation.resultIds.length !== input.operation.resultTypes.length) {
    diagnostics.push(
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_INPUT_CONTRACT_INVALID",
        messageTemplate: "Operation result IDs and result types must have matching arity.",
        ownerKey: `operation:${input.operation.operationId}`,
        rootCauseKey: `operation-results:${input.operation.operationId}`,
        stableDetail: `result-arity:${input.operation.resultIds.length}:${input.operation.resultTypes.length}`,
        originId: input.operation.originId,
        functionId: input.context.functionId,
      }),
    );
  }
  diagnostics.push(...verifyOperationRuntimeShape(input.operation, input.context));
  return diagnostics;
}

function verifyOperationRuntimeShape(
  operation: OptIrOperation,
  context: OptIrVerifierContext,
): OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const expectOperands = (expected: readonly unknown[], label: string) => {
    if (!sameSequence(operation.operandIds, expected)) {
      diagnostics.push(
        arityDiagnostic({
          operation,
          context,
          detail: `operand-shape:${operation.kind}:${label}:${operation.operandIds.length}:${expected.length}`,
        }),
      );
    }
  };
  const expectResultCount = (expected: number) => {
    if (operation.resultIds.length !== expected) {
      diagnostics.push(
        arityDiagnostic({
          operation,
          context,
          detail: `result-count:${operation.kind}:${operation.resultIds.length}:${expected}`,
        }),
      );
    }
  };
  const expectResultCountAtMost = (maximum: number) => {
    if (operation.resultIds.length > maximum) {
      diagnostics.push(
        arityDiagnostic({
          operation,
          context,
          detail: `result-count-at-most:${operation.kind}:${operation.resultIds.length}:${maximum}`,
        }),
      );
    }
  };

  switch (operation.kind) {
    case "constant":
      expectOperands([], "none");
      expectResultCount(1);
      break;
    case "integerUnary":
    case "booleanNot":
      expectOperands([operation.operand], "operand");
      expectResultCount(1);
      break;
    case "integerBinary":
    case "integerCompare":
    case "booleanBinary":
      expectOperands([operation.left, operation.right], "left-right");
      expectResultCount(1);
      break;
    case "aggregateConstruct":
      expectOperands(operation.fieldIds, "fields");
      expectResultCount(1);
      break;
    case "aggregateExtract":
      expectOperands([operation.aggregate], "aggregate");
      expectResultCount(1);
      break;
    case "aggregateInsert":
      expectOperands([operation.aggregate, operation.field], "aggregate-field");
      expectResultCount(1);
      break;
    case "layoutOffset":
    case "layoutByteRange":
      expectOperands([operation.base], "base");
      expectResultCount(1);
      break;
    case "layoutEndianDecode":
      expectOperands([operation.bytes], "bytes");
      expectResultCount(1);
      break;
    case "memoryLoad":
      if (operation.operandIds.length > 1) {
        diagnostics.push(
          arityDiagnostic({
            operation,
            context,
            detail: `operand-shape:${operation.kind}:optional-address-base:${operation.operandIds.length}:0..1`,
          }),
        );
      }
      expectResultCount(1);
      break;
    case "vectorLoad":
      expectOperands([], "none");
      expectResultCount(1);
      break;
    case "memoryStore":
      expectOperands([operation.storeValue], "store-value");
      expectResultCount(0);
      break;
    case "sourceCall":
    case "runtimeCall":
    case "platformCall":
    case "intrinsicCall":
      expectOperands(operation.argumentIds, "call-arguments");
      break;
    case "vectorMaskedLoad":
      expectOperands(operation.mask === undefined ? [] : [operation.mask], "mask");
      expectResultCount(1);
      break;
    case "vectorStore":
      expectOperands([operation.vector, operation.storeValue], "vector-store-value");
      expectResultCount(0);
      break;
    case "vectorMaskedStore":
      expectOperands(
        operation.mask === undefined
          ? [operation.vector, operation.storeValue]
          : [operation.vector, operation.storeValue, operation.mask],
        "vector-store-value-mask",
      );
      expectResultCount(0);
      break;
    case "vectorShuffle":
    case "vectorCompare":
      expectOperands(operation.sourceValueIds, "source-values");
      expectResultCount(1);
      break;
    case "vectorSelect":
      expectOperands([operation.mask, ...operation.sourceValueIds], "mask-source-values");
      expectResultCount(1);
      break;
    case "vectorByteSwap":
      expectOperands([operation.vector], "vector");
      expectResultCount(1);
      break;
    case "semanticAtomic":
      expectOperands(operation.sourceValueIds, "source-values");
      expectResultCountAtMost(1);
      break;
    case "semanticChecksum":
    case "semanticPolynomial":
    case "semanticCryptoMix":
    case "semanticClassifier":
    case "fpNumeric":
      expectOperands(operation.sourceValueIds, "source-values");
      expectResultCount(1);
      break;
    case "semanticFence":
    case "semanticRegionMarker":
      expectOperands(operation.sourceValueIds, "source-values");
      expectResultCount(0);
      break;
    case "proofErasedMarker":
      expectOperands([], "none");
      expectResultCount(0);
      break;
  }
  return diagnostics;
}

function sameSequence(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function arityDiagnostic(input: {
  readonly operation: OptIrOperation;
  readonly context: OptIrVerifierContext;
  readonly detail: string;
}): OptIrDiagnostic {
  return makeOptIrVerifierDiagnostic({
    code: "OPT_IR_INPUT_CONTRACT_INVALID",
    messageTemplate: "Operation runtime operand/result shape does not match its OptIR schema.",
    ownerKey: `operation:${input.operation.operationId}`,
    rootCauseKey: `operation-kind:${input.operation.kind}`,
    stableDetail: input.detail,
    originId: input.operation.originId,
    functionId: input.context.functionId,
  });
}
