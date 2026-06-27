import { instantiatedHirIdKey } from "../../mono/ids";
import type {
  MonoExpression,
  MonoLiteralValue,
  MonoLocalId,
  MonoObjectField,
  MonoResourcePlace,
} from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import { proofMirSsaLocalKey } from "../domains/graph-ssa";
import { draftLocalKey } from "../draft/draft-keys";
import type {
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirStatementKind,
} from "../draft/draft-statement";
import { type ProofMirPlaceId, type ProofMirValueId } from "../ids";
import type { ProofMirDraftOperand, ProofMirDraftPlaceOperand } from "./lowering-operands";
import {
  type ProofMirCallLowerer,
  type ProofMirExpressionLoweringInput,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringResult,
  type ProofMirValidatedBufferReadLowerer,
} from "./lowering-context";
import { syncLoweredPlaceToFunctionDraft } from "./lowering-place-sync";
import { shouldLowerMemberAsValidatedBufferRead } from "../domains/validated-buffer-read-detection";

export type { ProofMirLoweringResult };

export interface CreateProofMirExpressionLowererInput {
  readonly validatedBufferRead?: ProofMirValidatedBufferReadLowerer;
  readonly call?: ProofMirCallLowerer;
}

import {
  createLoweringIdAllocator,
  invalidStatementOperatorDiagnostic,
  invalidValueResourceKindDiagnostic,
  mapBinaryOperator,
  mapComparisonOperator,
  mapUnaryOperator,
  monoPlaceForLocal,
  originForExpression,
  type RecordedProofMirStatement,
  loweringError,
  loweringOk,
  unlowerableExpressionDiagnostic,
} from "./expression-lowerer-helpers";

function createExpressionLowererImpl(implInput: {
  readonly statements: RecordedProofMirStatement[];
  readonly validatedBufferRead?: ProofMirValidatedBufferReadLowerer;
  readonly call?: ProofMirCallLowerer;
}): ProofMirExpressionLowerer {
  const { statements: recordedStatements, validatedBufferRead, call } = implInput;

  function recordStatement(
    statementKind: DraftProofMirStatementKind,
    originKey: ProofMirCanonicalKey,
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): void {
    const statementKey = loweringInput.context.graph.addStatement(loweringInput.blockKey, {
      origin: originKey,
    });
    const snapshot: DraftProofMirGraphStatementSnapshot = {
      statementKey,
      originKey,
      kind: statementKind,
    };
    recordedStatements.push(snapshot);
    loweringInput.context.graph.recordLoweredStatement(loweringInput.blockKey, snapshot);
    void expression;
  }

  function valueOperand(valueKey: ProofMirCanonicalKey): ProofMirDraftOperand {
    return { kind: "value", value: valueKey };
  }

  function placeOperand(placeKey: ProofMirCanonicalKey): ProofMirDraftPlaceOperand {
    return { kind: "place", place: placeKey };
  }

  function readScalarLocal(readInput: {
    readonly loweringInput: ProofMirExpressionLoweringInput;
    readonly localId: MonoLocalId;
    readonly sourceOrigin: string;
  }): ProofMirLoweringResult<ProofMirCanonicalKey> {
    const localKey = draftLocalKey({
      functionInstanceId: readInput.loweringInput.context.functionInstanceId,
      monoLocalId: readInput.localId,
    });
    const valueKey = readInput.loweringInput.context.ssa.readScalar({
      blockKey: readInput.loweringInput.blockKey,
      ssaKey: proofMirSsaLocalKey(localKey),
    });
    if (valueKey === undefined) {
      return loweringError([
        invalidValueResourceKindDiagnostic({
          functionInstanceId: readInput.loweringInput.context.functionInstanceId,
          stableDetail: `missing-scalar:${instantiatedHirIdKey(readInput.localId)}`,
          sourceOrigin: readInput.sourceOrigin,
        }),
      ]);
    }
    return loweringOk(valueKey);
  }

  function lowerPlaceFromMono(input: {
    readonly loweringInput: ProofMirExpressionLoweringInput;
    readonly monoPlace: MonoResourcePlace;
    readonly originKey: ProofMirCanonicalKey;
  }): ProofMirLoweringResult<ProofMirCanonicalKey> {
    const lowered = input.loweringInput.context.functionScopePlaceLowerer.lowerMonoPlace({
      monoPlace: input.monoPlace,
      originKey: input.originKey,
    });
    if (lowered.kind !== "ok") {
      return lowered;
    }
    return loweringOk(
      syncLoweredPlaceToFunctionDraft({
        context: input.loweringInput.context,
        lowered: lowered.value,
        monoPlace: input.monoPlace,
      }),
    );
  }

  function emitLoad(loadInput: {
    readonly loweringInput: ProofMirExpressionLoweringInput;
    readonly expression: MonoExpression;
    readonly placeKey: ProofMirCanonicalKey;
  }): ProofMirLoweringResult<ProofMirDraftOperand> {
    const resultKey = loadInput.loweringInput.context.graph.createValue({
      role: `load:${instantiatedHirIdKey(loadInput.expression.expressionId)}`,
      origin: originForExpression(loadInput.loweringInput.context, loadInput.expression),
      type: loadInput.expression.type,
      resourceKind: loadInput.expression.resourceKind,
    });
    recordStatement(
      {
        kind: "load",
        placeKey: loadInput.placeKey,
        resultKey,
      },
      originForExpression(loadInput.loweringInput.context, loadInput.expression),
      loadInput.loweringInput,
      loadInput.expression,
    );
    return loweringOk(valueOperand(resultKey));
  }

  function lowerLiteral(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
    literal: MonoLiteralValue,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    const originKey = originForExpression(loweringInput.context, expression);
    const valueKey = loweringInput.context.graph.createValue({
      role: `literal:${literal.kind}`,
      origin: originKey,
      type: expression.type,
      resourceKind: expression.resourceKind,
    });
    recordStatement(
      {
        kind: "literal",
        valueKey,
        literal,
      },
      originKey,
      loweringInput,
      expression,
    );
    return loweringOk(valueOperand(valueKey));
  }

  function lowerNameAsPlace(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftPlaceOperand> {
    if (expression.kind.kind !== "name" || expression.kind.localId === undefined) {
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "name:missing-local",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const storage = loweringInput.context.localClassifier.storageForLocal(expression.kind.localId);
    if (storage === undefined) {
      return loweringError([
        invalidValueResourceKindDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: `name:${expression.kind.name}`,
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const originKey = originForExpression(loweringInput.context, expression);
    if (expression.place !== undefined) {
      const placeKey = lowerPlaceFromMono({
        loweringInput,
        monoPlace: expression.place,
        originKey,
      });
      if (placeKey.kind !== "ok") {
        return placeKey;
      }
      return loweringOk(placeOperand(placeKey.value));
    }
    if (storage === "scalarSsa") {
      return loweringError([
        invalidValueResourceKindDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: `scalar-name-as-place:${expression.kind.name}`,
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const monoPlace = monoPlaceForLocal({
      functionInstanceId: loweringInput.context.functionInstanceId,
      localId: expression.kind.localId,
      parameterId: expression.kind.parameterId,
      type: expression.type,
      resourceKind: expression.resourceKind,
      sourceOrigin: expression.sourceOrigin,
    });
    const placeKey = lowerPlaceFromMono({
      loweringInput,
      monoPlace,
      originKey,
    });
    if (placeKey.kind !== "ok") {
      return placeKey;
    }
    return loweringOk(placeOperand(placeKey.value));
  }

  function lowerNameAsValue(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    if (expression.kind.kind !== "name" || expression.kind.localId === undefined) {
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "name:missing-local",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const storage = loweringInput.context.localClassifier.storageForLocal(expression.kind.localId);
    if (storage === undefined) {
      return loweringError([
        invalidValueResourceKindDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: `name:${expression.kind.name}`,
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    if (storage === "scalarSsa") {
      const valueKey = readScalarLocal({
        loweringInput,
        localId: expression.kind.localId,
        sourceOrigin: expression.sourceOrigin,
      });
      if (valueKey.kind !== "ok") {
        return valueKey;
      }
      return loweringOk(valueOperand(valueKey.value));
    }
    const placeResult = lowerNameAsPlace(loweringInput, expression);
    if (placeResult.kind !== "ok") {
      return placeResult;
    }
    const placeKey = loweringInput.context.effects.placeFromMono({
      monoPlace:
        expression.place ??
        monoPlaceForLocal({
          functionInstanceId: loweringInput.context.functionInstanceId,
          localId: expression.kind.localId,
          parameterId: expression.kind.parameterId,
          type: expression.type,
          resourceKind: expression.resourceKind,
          sourceOrigin: expression.sourceOrigin,
        }),
      originKey: originForExpression(loweringInput.context, expression),
    });
    return emitLoad({
      loweringInput,
      expression,
      placeKey,
    });
  }

  function lowerMemberAsPlace(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftPlaceOperand> {
    if (expression.kind.kind !== "member") {
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "member:shape",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    if (expression.kind.memberPlace !== undefined) {
      const originKey = originForExpression(loweringInput.context, expression);
      const placeKey = lowerPlaceFromMono({
        loweringInput,
        monoPlace: expression.kind.memberPlace,
        originKey,
      });
      if (placeKey.kind !== "ok") {
        return placeKey;
      }
      return loweringOk(placeOperand(placeKey.value));
    }
    return loweringError([
      invalidValueResourceKindDiagnostic({
        functionInstanceId: loweringInput.context.functionInstanceId,
        stableDetail: "member:missing-place",
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }

  function placeKeyForExpression(input: {
    readonly loweringInput: ProofMirExpressionLoweringInput;
    readonly expression: MonoExpression;
  }): ProofMirLoweringResult<ProofMirCanonicalKey> {
    const originKey = originForExpression(input.loweringInput.context, input.expression);
    if (input.expression.place !== undefined) {
      return lowerPlaceFromMono({
        loweringInput: input.loweringInput,
        monoPlace: input.expression.place,
        originKey,
      });
    }
    if (
      input.expression.kind.kind === "member" &&
      input.expression.kind.memberPlace !== undefined
    ) {
      return lowerPlaceFromMono({
        loweringInput: input.loweringInput,
        monoPlace: input.expression.kind.memberPlace,
        originKey,
      });
    }
    if (input.expression.kind.kind === "name" && input.expression.kind.localId !== undefined) {
      const monoPlace = monoPlaceForLocal({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        localId: input.expression.kind.localId,
        parameterId: input.expression.kind.parameterId,
        type: input.expression.type,
        resourceKind: input.expression.resourceKind,
        sourceOrigin: input.expression.sourceOrigin,
      });
      return lowerPlaceFromMono({
        loweringInput: input.loweringInput,
        monoPlace,
        originKey,
      });
    }
    return loweringError([
      invalidValueResourceKindDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: `place-key:${input.expression.kind.kind}`,
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  function lowerMemberAsValue(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    const memberPlace = expression.kind.kind === "member" ? expression.kind.memberPlace : undefined;
    if (
      validatedBufferRead !== undefined &&
      memberPlace !== undefined &&
      shouldLowerMemberAsValidatedBufferRead({
        program: loweringInput.context.program,
        layout: loweringInput.context.layout,
        memberPlace,
      })
    ) {
      const validatedRead = validatedBufferRead.lowerValidatedBufferRead({
        context: loweringInput.context,
        expression,
        blockKey: loweringInput.blockKey,
      });
      if (validatedRead.kind === "ok") {
        return validatedRead;
      }
      return validatedRead;
    }

    const placeResult = lowerMemberAsPlace(loweringInput, expression);
    if (placeResult.kind !== "ok") {
      return placeResult;
    }
    if (memberPlace === undefined) {
      return loweringError([
        invalidValueResourceKindDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "member:missing-place",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const placeKey = loweringInput.context.effects.placeFromMono({
      monoPlace: memberPlace,
      originKey: originForExpression(loweringInput.context, expression),
    });
    return emitLoad({
      loweringInput,
      expression,
      placeKey,
    });
  }

  function lowerBorrowUnary(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    if (expression.kind.kind !== "unary") {
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "unary:shape",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }

    const operandPlace = lowerExpressionAsPlace({
      ...loweringInput,
      expression: expression.kind.operand,
    });
    if (operandPlace.kind !== "ok") {
      return operandPlace;
    }

    const placeKey = placeKeyForExpression({
      loweringInput,
      expression: expression.kind.operand,
    });
    if (placeKey.kind !== "ok") {
      return placeKey;
    }

    const blockKey = loweringInput.blockKey;
    const scopeKey = loweringInput.context.graph.block(blockKey).scopeKey;
    const originKey = originForExpression(loweringInput.context, expression);
    const loanKey = loweringInput.context.effects.startLoan({
      mode: "shared",
      placeKey: placeKey.value,
      scopeKey,
      startOriginKey: originKey,
    });
    recordStatement(
      {
        kind: "borrowPlace",
        placeKey: placeKey.value,
        loanKey,
        mode: "shared",
        scopeKey,
        startOriginKey: originKey,
      },
      originKey,
      loweringInput,
      expression,
    );
    return loweringOk(operandPlace.value);
  }

  function lowerUnary(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    if (expression.kind.kind !== "unary") {
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "unary:shape",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    if (expression.kind.operator === "borrow") {
      return lowerBorrowUnary(loweringInput, expression);
    }
    const mapped = mapUnaryOperator(expression.kind.operator);
    if (mapped === undefined) {
      return loweringError([
        invalidStatementOperatorDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          operator: expression.kind.operator,
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const operand = lowerExpressionValue({
      loweringInput,
      expression: expression.kind.operand,
    });
    if (operand.kind !== "ok" || operand.value.kind !== "value") {
      return operand.kind === "error"
        ? operand
        : loweringError([
            invalidValueResourceKindDiagnostic({
              functionInstanceId: loweringInput.context.functionInstanceId,
              stableDetail: "unary:operand",
              sourceOrigin: expression.sourceOrigin,
            }),
          ]);
    }
    const originKey = originForExpression(loweringInput.context, expression);
    const resultKey = loweringInput.context.graph.createValue({
      role: `unary:${mapped}`,
      origin: originKey,
    });
    recordStatement(
      {
        kind: "unary",
        operator: mapped,
        operandKey: operand.value.value,
        resultKey,
      },
      originKey,
      loweringInput,
      expression,
    );
    return loweringOk(valueOperand(resultKey));
  }

  function lowerBinaryOrComparison(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    if (expression.kind.kind !== "binary" && expression.kind.kind !== "comparison") {
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "binary:shape",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const left = lowerExpressionValue({
      loweringInput,
      expression: expression.kind.left,
    });
    if (left.kind !== "ok" || left.value.kind !== "value") {
      return left.kind === "error"
        ? left
        : loweringError([
            invalidValueResourceKindDiagnostic({
              functionInstanceId: loweringInput.context.functionInstanceId,
              stableDetail: "binary:left",
              sourceOrigin: expression.sourceOrigin,
            }),
          ]);
    }
    const right = lowerExpressionValue({
      loweringInput,
      expression: expression.kind.right,
    });
    if (right.kind !== "ok" || right.value.kind !== "value") {
      return right.kind === "error"
        ? right
        : loweringError([
            invalidValueResourceKindDiagnostic({
              functionInstanceId: loweringInput.context.functionInstanceId,
              stableDetail: "binary:right",
              sourceOrigin: expression.sourceOrigin,
            }),
          ]);
    }
    const originKey = originForExpression(loweringInput.context, expression);
    const resultKey = loweringInput.context.graph.createValue({
      role: `${expression.kind.kind}:${expression.kind.operator}`,
      origin: originKey,
    });
    if (expression.kind.kind === "comparison") {
      const operator = mapComparisonOperator(expression.kind.operator);
      if (operator === undefined) {
        return loweringError([
          invalidStatementOperatorDiagnostic({
            functionInstanceId: loweringInput.context.functionInstanceId,
            operator: expression.kind.operator,
            sourceOrigin: expression.sourceOrigin,
          }),
        ]);
      }
      recordStatement(
        {
          kind: "comparison",
          operator,
          leftKey: left.value.value,
          rightKey: right.value.value,
          resultKey,
        },
        originKey,
        loweringInput,
        expression,
      );
      return loweringOk(valueOperand(resultKey));
    }
    const operator = mapBinaryOperator(expression.kind.operator);
    if (operator === undefined) {
      return loweringError([
        invalidStatementOperatorDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          operator: expression.kind.operator,
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    recordStatement(
      {
        kind: "binary",
        operator,
        leftKey: left.value.value,
        rightKey: right.value.value,
        resultKey,
      },
      originKey,
      loweringInput,
      expression,
    );
    return loweringOk(valueOperand(resultKey));
  }

  function objectNeedsPlace(expression: MonoExpression): boolean {
    if (expression.kind.kind !== "object") {
      return false;
    }
    if (expression.place !== undefined) {
      return true;
    }
    if (expression.resourceKind !== "Copy") {
      return true;
    }
    for (const field of expression.kind.fields) {
      if (field.value.resourceKind !== "Copy") {
        return true;
      }
      if (field.value.place !== undefined) {
        return true;
      }
      if (field.value.kind.kind === "name") {
        const localId = field.value.kind.localId;
        if (localId !== undefined) {
          // Field values that are already place-backed force aggregate storage.
          void localId;
        }
      }
    }
    return expression.kind.fields.some((field) => field.value.resourceKind !== "Copy");
  }

  function lowerObjectAsValue(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    if (expression.kind.kind !== "object") {
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: "object:shape",
          sourceOrigin: expression.sourceOrigin,
        }),
      ]);
    }
    const fieldValues: {
      readonly field: MonoObjectField;
      readonly operand: ProofMirDraftOperand;
    }[] = [];
    for (const field of expression.kind.fields) {
      const lowered = lowerExpressionValue({
        loweringInput,
        expression: field.value,
      });
      if (lowered.kind !== "ok") {
        return lowered;
      }
      fieldValues.push({ field, operand: lowered.value });
    }
    const needsPlace =
      objectNeedsPlace(expression) ||
      fieldValues.some(
        (entry) => entry.operand.kind === "place" || entry.operand.kind === "valueAndPlace",
      );
    const originKey = originForExpression(loweringInput.context, expression);
    if (!needsPlace) {
      const valueKey = loweringInput.context.graph.createValue({
        role: "object:copy-scalar",
        origin: originKey,
      });
      return loweringOk(valueOperand(valueKey));
    }
    const aggregateValueKey = loweringInput.context.graph.createValue({
      role: "object:aggregate",
      origin: originKey,
      type: expression.type,
      resourceKind: expression.resourceKind,
    });
    const placeKey =
      expression.place === undefined
        ? loweringOk(
            loweringInput.context.effects.placeFromRuntimeTemporary({
              valueKey: aggregateValueKey,
              originKey,
            }),
          )
        : lowerPlaceFromMono({
            loweringInput,
            monoPlace: expression.place,
            originKey,
          });
    if (placeKey.kind !== "ok") {
      return placeKey;
    }
    for (const entry of fieldValues) {
      if (entry.operand.kind === "value") {
        recordStatement(
          {
            kind: "store",
            placeKey: placeKey.value,
            valueKey: entry.operand.value,
          },
          originKey,
          loweringInput,
          expression,
        );
      }
    }
    return loweringOk({
      kind: "valueAndPlace",
      value: aggregateValueKey,
      place: placeKey.value,
    });
  }

  function lowerObjectAsPlace(
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ): ProofMirLoweringResult<ProofMirDraftPlaceOperand> {
    const valueResult = lowerObjectAsValue(loweringInput, expression);
    if (valueResult.kind !== "ok") {
      return valueResult;
    }
    if (valueResult.value.kind === "place") {
      return loweringOk(valueResult.value);
    }
    if (valueResult.value.kind === "valueAndPlace") {
      return loweringOk({ kind: "place", place: valueResult.value.place });
    }
    return loweringError([
      invalidValueResourceKindDiagnostic({
        functionInstanceId: loweringInput.context.functionInstanceId,
        stableDetail: "object:scalar-as-place",
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }

  function lowerExpressionValue(input: {
    readonly loweringInput: ProofMirExpressionLoweringInput;
    readonly expression: MonoExpression;
  }): ProofMirLoweringResult<ProofMirDraftOperand> {
    return lowerExpression({
      context: input.loweringInput.context,
      expression: input.expression,
      blockKey: input.loweringInput.blockKey,
      ...(input.loweringInput.expectedType === undefined
        ? {}
        : { expectedType: input.loweringInput.expectedType }),
    });
  }

  function lowerExpression(
    loweringInput: ProofMirExpressionLoweringInput,
  ): ProofMirLoweringResult<ProofMirDraftOperand> {
    const expression = loweringInput.expression;
    switch (expression.kind.kind) {
      case "literal":
        return lowerLiteral(loweringInput, expression, expression.kind.literal);
      case "name":
        return lowerNameAsValue(loweringInput, expression);
      case "member":
        return lowerMemberAsValue(loweringInput, expression);
      case "object":
        return lowerObjectAsValue(loweringInput, expression);
      case "unary":
        return lowerUnary(loweringInput, expression);
      case "binary":
      case "comparison":
        return lowerBinaryOrComparison(loweringInput, expression);
      case "call": {
        if (call === undefined) {
          return loweringError([
            proofMirDiagnostic({
              severity: "error",
              code: "PROOF_MIR_MISSING_LOWERER",
              message: "Missing call lowerer callback.",
              functionInstanceId: loweringInput.context.functionInstanceId,
              ownerKey: `function:${String(loweringInput.context.functionInstanceId)}`,
              rootCauseKey: "missing-call-lowerer",
              stableDetail: "expression:call",
            }),
          ]);
        }
        return call.lowerCall({
          context: loweringInput.context,
          call: expression.kind.call,
          monoExpressionId: expression.expressionId,
          blockKey: loweringInput.blockKey,
          resultType: expression.type,
          resultResourceKind: expression.resourceKind,
        });
      }
      case "attempt":
      case "validationCreation":
      case "error":
        return loweringError([
          unlowerableExpressionDiagnostic({
            functionInstanceId: loweringInput.context.functionInstanceId,
            stableDetail: expression.kind.kind,
            sourceOrigin: expression.sourceOrigin,
          }),
        ]);
      default: {
        const unreachable: never = expression.kind;
        return unreachable;
      }
    }
  }

  function lowerExpressionAsPlace(
    loweringInput: ProofMirExpressionLoweringInput,
  ): ProofMirLoweringResult<ProofMirDraftPlaceOperand> {
    const expression = loweringInput.expression;
    switch (expression.kind.kind) {
      case "name":
        return lowerNameAsPlace(loweringInput, expression);
      case "member":
        return lowerMemberAsPlace(loweringInput, expression);
      case "object":
        return lowerObjectAsPlace(loweringInput, expression);
      default:
        return loweringError([
          invalidValueResourceKindDiagnostic({
            functionInstanceId: loweringInput.context.functionInstanceId,
            stableDetail: `place:${expression.kind.kind}`,
            sourceOrigin: expression.sourceOrigin,
          }),
        ]);
    }
  }

  return {
    lowerExpression,
    lowerExpressionAsPlace,
  };
}

export function createProofMirExpressionLowerer(
  input: CreateProofMirExpressionLowererInput = {},
): ProofMirExpressionLowerer & {
  readonly statements: () => readonly DraftProofMirGraphStatementSnapshot[];
  readonly valueIdForKey: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
} {
  const idAllocator = createLoweringIdAllocator();
  const recorded: RecordedProofMirStatement[] = [];
  const lowerer = createExpressionLowererImpl({
    statements: recorded,
    validatedBufferRead: input.validatedBufferRead,
    call: input.call,
  });

  return {
    lowerExpression: lowerer.lowerExpression,
    lowerExpressionAsPlace: lowerer.lowerExpressionAsPlace,
    valueIdForKey(key) {
      return idAllocator.valueForKey(key);
    },
    placeIdForKey(key) {
      return idAllocator.placeForKey(key);
    },
    statements(): readonly DraftProofMirGraphStatementSnapshot[] {
      return recorded.slice();
    },
  };
}
