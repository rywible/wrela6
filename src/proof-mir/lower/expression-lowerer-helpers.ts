import { hirLocalId, hirStatementId, resourcePlaceId } from "../../hir/ids";
import { instantiatedHirId, instantiatedHirIdKey, type MonoInstanceId } from "../../mono/ids";
import type {
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonomorphizedHirProgram,
  MonoLocalId,
  MonoPlaceProjection,
  MonoPlaceRoot,
  MonoResourcePlace,
  MonoStatementId,
} from "../../mono/mono-hir";
import type { ParameterId } from "../../semantic/ids";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import {
  proofMirLoanId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirScopeId,
  proofMirStatementId,
  proofMirValueId,
  type ProofMirLoanId,
  type ProofMirOriginId,
  type ProofMirPlaceId,
  type ProofMirScopeId,
  type ProofMirStatementId,
  type ProofMirValueId,
} from "../ids";
import type { DraftProofMirStatementKind } from "../draft/draft-statement";
import type {
  ProofMirBinaryOperator,
  ProofMirComparisonOperator,
  ProofMirUnaryOperator,
} from "../model/graph";
import type { ProofMirExpressionLoweringInput, ProofMirLoweringResult } from "./lowering-context";

export interface ProofMirExpressionLowererBlockKeyRef {
  blockKey?: ProofMirCanonicalKey;
}

export interface RecordedProofMirStatement {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}

export interface ProofMirLoweringIdAllocator {
  valueForKey(key: ProofMirCanonicalKey): ProofMirValueId;
  placeForKey(key: ProofMirCanonicalKey): ProofMirPlaceId;
  scopeForKey(key: ProofMirCanonicalKey): ProofMirScopeId;
  loanForKey(key: ProofMirCanonicalKey): ProofMirLoanId;
  nextStatementId(): ProofMirStatementId;
  nextOrigin(note: string): ProofMirOriginId;
  nextMonoStatementId(functionInstanceId: MonoInstanceId): MonoStatementId;
}

export function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export function loweringError(
  diagnostics: readonly ProofMirDiagnostic[],
): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

export function invalidStatementOperatorDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly operator: string;
  readonly sourceOrigin?: string;
  readonly nodeDetail?: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_STATEMENT_OPERATOR",
    message: "Proof MIR lowering encountered an unknown source operator spelling.",
    functionInstanceId: input.functionInstanceId,
    ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
    ...(input.nodeDetail === undefined ? {} : { nodeDetail: input.nodeDetail }),
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "statement-operator",
    stableDetail: input.operator,
  });
}

export function unlowerableExpressionDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly stableDetail: string;
  readonly sourceOrigin?: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
    message: "Proof MIR expression lowering does not handle this mono expression shape.",
    functionInstanceId: input.functionInstanceId,
    ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "expression-shape",
    stableDetail: input.stableDetail,
  });
}

export function invalidValueResourceKindDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly stableDetail: string;
  readonly sourceOrigin?: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
    message: "Proof MIR expression lowering could not resolve operand storage.",
    functionInstanceId: input.functionInstanceId,
    ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "operand-storage",
    stableDetail: input.stableDetail,
  });
}

export function createLoweringIdAllocator(): ProofMirLoweringIdAllocator {
  let nextValue = 0;
  let nextPlace = 0;
  let nextScope = 0;
  let nextLoan = 0;
  let nextStatement = 0;
  let nextOrigin = 1;
  let nextMonoStatement = 1;
  const valueKeys = new Map<ProofMirCanonicalKey, ProofMirValueId>();
  const placeKeys = new Map<ProofMirCanonicalKey, ProofMirPlaceId>();
  const scopeKeys = new Map<ProofMirCanonicalKey, ProofMirScopeId>();
  const loanKeys = new Map<ProofMirCanonicalKey, ProofMirLoanId>();

  return {
    valueForKey(key) {
      const existing = valueKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirValueId(nextValue++);
      valueKeys.set(key, id);
      return id;
    },
    placeForKey(key) {
      const existing = placeKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirPlaceId(nextPlace++);
      placeKeys.set(key, id);
      return id;
    },
    scopeForKey(key) {
      const existing = scopeKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirScopeId(nextScope++);
      scopeKeys.set(key, id);
      return id;
    },
    loanForKey(key) {
      const existing = loanKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirLoanId(nextLoan++);
      loanKeys.set(key, id);
      return id;
    },
    nextStatementId() {
      return proofMirStatementId(nextStatement++);
    },
    nextOrigin(_note) {
      return proofMirOriginId(nextOrigin++);
    },
    nextMonoStatementId(functionInstanceId) {
      return instantiatedHirId(functionInstanceId, hirStatementId(nextMonoStatement++));
    },
  };
}

export function mapUnaryOperator(operator: string): ProofMirUnaryOperator | undefined {
  switch (operator.trim()) {
    case "!":
      return "logicalNot";
    case "-":
      return "numericNegate";
    case "~":
      return "bitwiseNot";
    default:
      return undefined;
  }
}

export function mapBinaryOperator(operator: string): ProofMirBinaryOperator | undefined {
  switch (operator.trim()) {
    case "+":
      return "add";
    case "-":
      return "subtract";
    case "*":
      return "multiply";
    case "/":
      return "divide";
    case "%":
      return "remainder";
    case "&":
      return "bitwiseAnd";
    case "|":
      return "bitwiseOr";
    case "^":
      return "bitwiseXor";
    case "<<":
      return "shiftLeft";
    case ">>":
      return "shiftRight";
    default:
      return undefined;
  }
}

export function mapComparisonOperator(operator: string): ProofMirComparisonOperator | undefined {
  switch (operator.trim()) {
    case "==":
      return "eq";
    case "!=":
      return "ne";
    case "<":
      return "lt";
    case "<=":
      return "le";
    case ">":
      return "gt";
    case ">=":
      return "ge";
    default:
      return undefined;
  }
}

export function originForExpression(
  context: ProofMirExpressionLoweringInput["context"],
  expression: MonoExpression,
): ProofMirCanonicalKey {
  return context.originMap.fromMonoExpression({
    owner: { kind: "function", functionInstanceId: context.functionInstanceId },
    sourceOrigin: expression.sourceOrigin as never,
    monoExpressionId: expression.expressionId,
  });
}

export function requireBlockKey(
  blockKeyRef: ProofMirExpressionLowererBlockKeyRef | undefined,
  functionInstanceId: MonoInstanceId,
): ProofMirLoweringResult<ProofMirCanonicalKey> {
  if (blockKeyRef?.blockKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_CFG",
        message: "Proof MIR expression lowering requires an active block key.",
        functionInstanceId,
        ownerKey: `function:${String(functionInstanceId)}`,
        rootCauseKey: "missing-block-key",
        stableDetail: "expression:block",
      }),
    ]);
  }
  return loweringOk(blockKeyRef.blockKey);
}

export function monoPlaceForLocal(input: {
  readonly program?: MonomorphizedHirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly localId: MonoLocalId;
  readonly parameterId?: ParameterId;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: string;
  readonly projection?: readonly MonoPlaceProjection[];
}): MonoResourcePlace {
  const projection = input.projection ?? [];
  const root =
    input.parameterId !== undefined
      ? ({ kind: "parameter", parameterId: input.parameterId } as const)
      : ({ kind: "local", localId: input.localId } as const);
  const existing = input.program?.proofMetadata?.resourcePlaces
    .entries()
    .find(
      (place) =>
        sameMonoPlaceRoot(place.root, root) && sameMonoProjection(place.projection, projection),
    );
  if (existing !== undefined) {
    return existing;
  }
  const canonicalKey = `function:${String(input.functionInstanceId)}/root:${root.kind}:${input.parameterId !== undefined ? String(input.parameterId) : instantiatedHirIdKey(input.localId)}${projection.map((entry) => `/${entry.kind}:${entry.kind === "field" ? String(entry.fieldId) : ""}`).join("")}`;
  return {
    placeId: {
      owner: { kind: "function", instanceId: input.functionInstanceId },
      hirId: resourcePlaceId(1),
      instanceId: input.functionInstanceId,
    },
    canonicalKey,
    root,
    projection,
    type: input.type,
    resourceKind: input.resourceKind,
    sourceOrigin: input.sourceOrigin,
    kind: root.kind === "parameter" ? "parameter" : "local",
    ...(root.kind === "local" ? { localId: input.localId } : { parameterId: input.parameterId! }),
  };
}

function sameMonoPlaceRoot(left: MonoPlaceRoot, right: MonoPlaceRoot): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "receiver":
    case "parameter":
      return String(left.parameterId) === String((right as typeof left).parameterId);
    case "local":
      return (
        String(left.localId.instanceId) === String((right as typeof left).localId.instanceId) &&
        String(left.localId.hirId) === String((right as typeof left).localId.hirId)
      );
    case "temporary":
      return left.ordinal === (right as typeof left).ordinal;
    case "imageDevice":
      return (
        String(left.imageId) === String((right as typeof left).imageId) &&
        String(left.fieldId) === String((right as typeof left).fieldId)
      );
    case "validationPayload":
      return (
        String(left.validationId.instanceId) ===
          String((right as typeof left).validationId.instanceId) &&
        String(left.validationId.hirId) === String((right as typeof left).validationId.hirId)
      );
    case "error":
      return true;
    default: {
      const unreachable: never = left;
      return unreachable;
    }
  }
}

function sameMonoProjection(
  left: readonly MonoPlaceProjection[],
  right: readonly MonoPlaceProjection[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((leftProjection, index) => {
    const rightProjection = right[index];
    if (rightProjection === undefined || leftProjection.kind !== rightProjection.kind) {
      return false;
    }
    switch (leftProjection.kind) {
      case "field": {
        if (rightProjection.kind !== "field") return false;
        return String(leftProjection.fieldId) === String(rightProjection.fieldId);
      }
      case "deref":
        return true;
      case "variant": {
        if (rightProjection.kind !== "variant") return false;
        return leftProjection.name === rightProjection.name;
      }
      default: {
        const unreachable: never = leftProjection;
        return unreachable;
      }
    }
  });
}

export function monoObjectPlace(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly expressionId: MonoExpressionId;
  readonly sourceOrigin: string;
}): MonoResourcePlace {
  const canonicalKey = `function:${String(input.functionInstanceId)}/object:${instantiatedHirIdKey(input.expressionId)}`;
  return {
    placeId: {
      owner: { kind: "function", instanceId: input.functionInstanceId },
      hirId: resourcePlaceId(1),
      instanceId: input.functionInstanceId,
    },
    canonicalKey,
    root: {
      kind: "local",
      localId: instantiatedHirId(input.functionInstanceId, hirLocalId(9_999)),
    },
    projection: [],
    type: {
      kind: "applied",
      constructor: { kind: "source", typeId: 1 as never },
      arguments: [],
      resourceKind: { kind: "concrete", value: "Copy" },
    } as never,
    resourceKind: "Copy",
    sourceOrigin: input.sourceOrigin,
    kind: "local",
    localId: instantiatedHirId(input.functionInstanceId, hirLocalId(9_999)),
  };
}
