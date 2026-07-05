import { describe, expect, test } from "bun:test";
import { attemptId, hirExpressionId, resourcePlaceId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import type { MonoAttempt, MonoExpression, MonoResourcePlace } from "../../../src/mono/mono-hir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import type { ProofMirExpressionLowerer } from "../../../src/proof-mir/lower/lowering-context";
import {
  attemptWithBranchyFallibleExpressionFixture,
  lowerProofMirAttemptForTest,
  lowerProofMirAttemptValueForTest,
} from "../../support/proof-mir/lower-harness/attempt-lowerer-harness";

const functionInstanceId = monoInstanceId("fn:main");

function expressionId(value: number) {
  return instantiatedHirId(functionInstanceId, hirExpressionId(value));
}

function literalExpression(ordinal: number): MonoExpression {
  return {
    expressionId: expressionId(ordinal),
    kind: { kind: "literal", literal: { kind: "integer", text: String(ordinal) } },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:literal:${ordinal}`,
  };
}

function branchyFallibleExpression(ordinal: number): MonoExpression {
  return {
    expressionId: expressionId(ordinal),
    kind: {
      kind: "binary",
      operator: "+",
      left: {
        expressionId: expressionId(ordinal * 10 + 1),
        kind: {
          kind: "comparison",
          operator: ">",
          left: literalExpression(ordinal * 10 + 2),
          right: literalExpression(ordinal * 10 + 3),
        },
        type: { kind: "primitive", name: "bool" } as never,
        resourceKind: "Copy",
        sourceOrigin: `source:branchy:left:${ordinal}`,
      },
      right: literalExpression(ordinal * 10 + 4),
    },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:branchy:${ordinal}`,
  };
}

function monoInputPlace(localOrdinal: number): MonoResourcePlace {
  const localId = instantiatedHirId(functionInstanceId, localOrdinal as never);
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(localOrdinal),
      instanceId: functionInstanceId,
    },
    canonicalKey: `function:${String(functionInstanceId)}/local:${localOrdinal}`,
    root: { kind: "local", localId },
    projection: [],
    type: { kind: "primitive", name: "Handle" } as never,
    resourceKind: "Affine",
    sourceOrigin: `source:place:${localOrdinal}`,
    kind: "local",
    localId,
  };
}

function attemptFixture(input: {
  readonly ordinal: number;
  readonly fallibleExpression: MonoExpression;
  readonly alternative?: MonoExpression;
  readonly declaredInputPlaces?: readonly MonoResourcePlace[];
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly functionInstanceId?: MonoInstanceId;
}): {
  readonly attempt: MonoAttempt;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly functionInstanceId: MonoInstanceId;
} {
  const owner = input.functionInstanceId ?? functionInstanceId;
  const attempt: MonoAttempt = {
    attemptId: {
      owner: { kind: "function", instanceId: owner },
      hirId: attemptId(input.ordinal),
      instanceId: owner,
    },
    attemptExpressionId: expressionId(input.ordinal),
    fallibleExpression: input.fallibleExpression,
    ...(input.alternative === undefined ? {} : { alternativeExpression: input.alternative }),
    declaredInputPlaces: input.declaredInputPlaces ?? [],
    sourceOrigin: `source:attempt:${input.ordinal}`,
  };

  return {
    attempt,
    expressionLowerer: input.expressionLowerer,
    functionInstanceId: owner,
  };
}

import type { DraftProofMirStatementKind } from "../../../src/proof-mir/draft/draft-statement";

function attemptStatementKind(
  kind: DraftProofMirStatementKind | undefined,
): Extract<DraftProofMirStatementKind, { readonly kind: "attempt" }> | undefined {
  if (kind?.kind !== "attempt") {
    return undefined;
  }
  return kind;
}

describe("ProofMirAttemptLowerer", () => {
  test("attempt records arbitrary lowered fallible expression operand", () => {
    const lowered = lowerProofMirAttemptForTest(attemptWithBranchyFallibleExpressionFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statement?.kind).toMatchObject({
      kind: "attempt",
      attempt: expect.objectContaining({
        fallible: expect.objectContaining({ kind: "observe", placeKey: expect.any(String) }),
      }),
    });
    expect(lowered.successEdge?.kind).toBe("attemptSuccess");
    expect(lowered.errorEdge?.kind).toBe("attemptError");
  });

  test("lowers fallible expression through dependency-injected expression lowerer", () => {
    const fallibleExpression = branchyFallibleExpression(3);
    let loweredFallible: MonoExpression | undefined;
    const expressionLowerer: ProofMirExpressionLowerer = {
      lowerExpression(input) {
        loweredFallible = input.expression;
        return {
          kind: "ok",
          value: { kind: "value", value: proofMirCanonicalKey("test:attempt:fallible:7") },
        };
      },
      lowerExpressionAsPlace: () => ({
        kind: "error",
        diagnostics: [],
      }),
    };

    const lowered = lowerProofMirAttemptForTest(
      attemptFixture({
        ordinal: 3,
        fallibleExpression,
        expressionLowerer,
      }),
    );

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(loweredFallible).toBe(fallibleExpression);
    const attemptKind = attemptStatementKind(lowered.statement?.kind);
    expect(attemptKind?.attempt.fallible).toEqual(
      expect.objectContaining({
        kind: "observe",
        expressionId: fallibleExpression.expressionId,
        placeKey: expect.any(String),
      }),
    );
  });

  test("records alternative expression operand when present", () => {
    const alternativeExpression = literalExpression(99);
    const expressionLowerer: ProofMirExpressionLowerer = {
      lowerExpression(input) {
        if (input.expression === alternativeExpression) {
          return {
            kind: "ok",
            value: { kind: "value", value: proofMirCanonicalKey("test:attempt:alternative:11") },
          };
        }
        return {
          kind: "ok",
          value: { kind: "value", value: proofMirCanonicalKey("test:attempt:fallible:10") },
        };
      },
      lowerExpressionAsPlace: () => ({
        kind: "error",
        diagnostics: [],
      }),
    };

    const lowered = lowerProofMirAttemptForTest(
      attemptFixture({
        ordinal: 4,
        fallibleExpression: literalExpression(98),
        alternative: alternativeExpression,
        expressionLowerer,
      }),
    );

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    const attemptKind = attemptStatementKind(lowered.statement?.kind);
    expect(attemptKind?.attempt.alternative).toEqual(
      expect.objectContaining({
        kind: "value",
        expressionId: alternativeExpression.expressionId,
        placeKey: expect.any(String),
      }),
    );
  });

  test("allocates pending result place deterministically from attempt id", () => {
    const expressionLowerer: ProofMirExpressionLowerer = {
      lowerExpression: () => ({
        kind: "ok",
        value: { kind: "value", value: proofMirCanonicalKey("test:attempt:pending:1") },
      }),
      lowerExpressionAsPlace: () => ({
        kind: "error",
        diagnostics: [],
      }),
    };

    const first = lowerProofMirAttemptForTest(
      attemptFixture({
        ordinal: 1,
        fallibleExpression: literalExpression(1),
        expressionLowerer,
      }),
    );
    const second = lowerProofMirAttemptForTest(
      attemptFixture({
        ordinal: 1,
        fallibleExpression: literalExpression(1),
        expressionLowerer,
      }),
    );

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    expect(first.statement?.kind.kind).toBe("attempt");
    expect(second.statement?.kind.kind).toBe("attempt");
    const firstAttempt = attemptStatementKind(first.statement?.kind);
    const secondAttempt = attemptStatementKind(second.statement?.kind);
    expect(firstAttempt?.attempt.pendingResultPlaceKey).toBe(
      secondAttempt?.attempt.pendingResultPlaceKey,
    );
    expect(first.pendingResultPlaceKey).toBe(second.pendingResultPlaceKey);
  });

  test("success and error edges consume pending result and declared inputs on success", () => {
    const inputPlace = monoInputPlace(1);
    const expressionLowerer: ProofMirExpressionLowerer = {
      lowerExpression: () => ({
        kind: "ok",
        value: { kind: "value", value: proofMirCanonicalKey("test:attempt:inputs:2") },
      }),
      lowerExpressionAsPlace: () => ({
        kind: "error",
        diagnostics: [],
      }),
    };

    const lowered = lowerProofMirAttemptForTest(
      attemptFixture({
        ordinal: 5,
        fallibleExpression: literalExpression(5),
        declaredInputPlaces: [inputPlace],
        expressionLowerer,
      }),
    );

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.successEdge?.effects.map((effect) => effect.kind)).toEqual([
      "consumePlace",
      "consumePlace",
    ]);
    expect(lowered.errorEdge?.effects.map((effect) => effect.kind)).toEqual(["consumePlace"]);
  });

  test("attempt value lowering rejoins success with a value and returns mapped error alternative", () => {
    const inputPlace = monoInputPlace(2);
    const alternativeExpression = literalExpression(42);
    const expressionLowerer: ProofMirExpressionLowerer = {
      lowerExpression(input) {
        if (input.expression === alternativeExpression) {
          return {
            kind: "ok",
            value: { kind: "value", value: proofMirCanonicalKey("test:attempt:alternative:42") },
          };
        }
        return {
          kind: "ok",
          value: { kind: "value", value: proofMirCanonicalKey("test:attempt:fallible:42") },
        };
      },
      lowerExpressionAsPlace: () => ({
        kind: "error",
        diagnostics: [],
      }),
    };

    const lowered = lowerProofMirAttemptValueForTest(
      attemptFixture({
        ordinal: 8,
        fallibleExpression: literalExpression(8),
        alternative: alternativeExpression,
        declaredInputPlaces: [inputPlace],
        expressionLowerer,
      }),
    );

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.successContinuation?.blockKey).toBeDefined();
    expect(lowered.successValueKey).toBeDefined();
    expect(lowered.successEdge?.effects.map((effect) => effect.kind)).toEqual([
      "consumePlace",
      "consumePlace",
    ]);
    expect(lowered.errorEdge?.effects.map((effect) => effect.kind)).toEqual(["consumePlace"]);
    expect(lowered.errorTerminator?.kind).toBe("return");
  });

  test("attempt record does not enumerate producer calls", () => {
    const lowered = lowerProofMirAttemptForTest(attemptWithBranchyFallibleExpressionFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const attemptKind = attemptStatementKind(lowered.statement?.kind);
    expect(attemptKind).toBeDefined();
    expect(Object.keys(attemptKind as object)).not.toContain("producerCalls");
    expect(Object.keys(attemptKind as object)).not.toContain("calls");
  });

  test("missing attempt operand returns invalid attempt operand", () => {
    const expressionLowerer: ProofMirExpressionLowerer = {
      lowerExpression: () => ({
        kind: "ok",
        value: { kind: "place", place: proofMirCanonicalKey("test:attempt:invalid-place") },
      }),
      lowerExpressionAsPlace: () => ({
        kind: "ok",
        value: { kind: "place", place: proofMirCanonicalKey("test:attempt:invalid-place") },
      }),
    };

    const lowered = lowerProofMirAttemptForTest(
      attemptFixture({
        ordinal: 6,
        fallibleExpression: literalExpression(6),
        expressionLowerer,
      }),
    );

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_ATTEMPT_OPERAND"),
    );
  });

  test("matchAttempt terminator references success and error targets", () => {
    const lowered = lowerProofMirAttemptForTest(attemptWithBranchyFallibleExpressionFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.terminator?.kind).toBe("matchAttempt");
    if (lowered.terminator?.kind !== "matchAttempt") return;
    expect(lowered.successEdge).toBeDefined();
    expect(lowered.errorEdge).toBeDefined();
    expect(lowered.terminator.match.successTarget.edge).toBe(lowered.successEdge!.key);
    expect(lowered.terminator.match.errorTarget.edge).toBe(lowered.errorEdge!.key);
  });
});
