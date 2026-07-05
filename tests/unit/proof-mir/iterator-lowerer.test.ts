import { describe, expect, test } from "bun:test";
import type { MonoExpression, MonoFunctionInstance } from "../../../src/mono/mono-hir";
import { monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { allocateIteratorSyntheticExpressionIds } from "../../../src/proof-mir/lower/iterator-lowering/synthetic-origin-ids";
import { lowerProofMirOrdinaryForForTest } from "../../support/proof-mir/lower-harness/iterator-lowerer-harness";
import { ordinaryIteratorProtocolProofMirBuildInputParts } from "../../support/proof-mir/lower-harness/iterator-lowerer-integration-parts";
import { expressionIdFor } from "../../support/proof-mir/lower-harness/iterator-lowerer-harness-bindings";

describe("ProofMirIteratorLowerer", () => {
  test("ordinary iterator for lowers next result into item and finished edges", () => {
    const lowered = lowerProofMirOrdinaryForForTest({
      source: ["for byte in packet.bytes():", "    sum = sum + byte", "return sum"],
      iteratorProtocol: "checkedIterator",
      scalarLocals: ["sum", "byte"],
      loopCarriedLocals: ["sum"],
      placeBackedLocals: ["packet"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.kind).toBe("loopHeader");
    expect(lowered.nextCall.target.kind).toBe("sourceFunction");
    expect(lowered.itemEdge.effects.map((effect) => effect.kind)).toContain("introducePlace");
    expect(lowered.finishedEdge.facts.map((fact) => fact.kind.kind)).toContain("runtimeEnsured");
  });

  test("stream for remains gated in the core lowerer", () => {
    const result = lowerProofMirOrdinaryForForTest({
      source: ["for event in packets.bytes():", "    take event"],
      iteratorProtocol: "stream",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
    );
  });

  test("stream for lowers when streamLoop feature is enabled and records header session boundary", () => {
    const lowered = lowerProofMirOrdinaryForForTest({
      source: ["for event in packets.bytes():", "    take event"],
      iteratorProtocol: "stream",
      placeBackedLocals: ["packets"],
      targetFeatures: ["streamLoop"],
    });

    expect(lowered.kind, lowered.kind === "error" ? JSON.stringify(lowered.diagnostics) : "").toBe(
      "ok",
    );
    if (lowered.kind !== "ok") return;

    expect(lowered.header.kind).toBe("loopHeader");
    expect(lowered.header.boundaryResources?.sessionMembers).toHaveLength(1);
    expect(lowered.header.boundaryResources?.sessionMembers[0]?.placeKey).toBeDefined();
  });

  test("iterator state stays in boundary resources not header parameters", () => {
    const lowered = lowerProofMirOrdinaryForForTest({
      source: ["for byte in packet.bytes():", "    sum = sum + byte", "return sum"],
      iteratorProtocol: "checkedIterator",
      scalarLocals: ["sum", "byte"],
      loopCarriedLocals: ["sum"],
      placeBackedLocals: ["packet"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.parameters).toHaveLength(1);
    expect(lowered.header.boundaryResources?.places.length).toBeGreaterThan(0);
  });

  test("iterator synthetic expression ids skip occupied function ids", () => {
    const functionInstanceId = monoInstanceId("fn:iterator-protocol");
    const parts = ordinaryIteratorProtocolProofMirBuildInputParts();
    const functionInstance = parts.program.functions.get(functionInstanceId);
    const nextRequirement = parts.program.proofMetadata.callSiteRequirements
      .entries()
      .find((requirement) => Number(requirement.callExpressionId.hirId) === 100);
    const bodyIndex = functionInstance?.bodyIndex;

    expect(functionInstance).toBeDefined();
    expect(nextRequirement).toBeDefined();
    expect(bodyIndex).toBeDefined();
    if (
      functionInstance === undefined ||
      nextRequirement === undefined ||
      bodyIndex === undefined
    ) {
      return;
    }

    const occupiedExpression = (ordinal: number): MonoExpression =>
      ({ expressionId: expressionIdFor(functionInstanceId, ordinal) }) as MonoExpression;
    const occupiedFunction: MonoFunctionInstance = {
      ...functionInstance,
      bodyIndex: {
        ...bodyIndex,
        expressions: {
          entries: () => [
            ...bodyIndex.expressions.entries(),
            occupiedExpression(101),
            occupiedExpression(102),
          ],
          get: (key) => bodyIndex.expressions.get(key),
        },
      },
    };
    const functions = parts.program.functions
      .entries()
      .map((entry) => (entry.instanceId === functionInstanceId ? occupiedFunction : entry));
    const program = {
      ...parts.program,
      functions: {
        entries: () => functions,
        get: (instanceId: MonoInstanceId) =>
          functions.find((entry) => entry.instanceId === instanceId),
      },
    };

    const ids = allocateIteratorSyntheticExpressionIds({
      program,
      functionInstanceId,
      callExpressionId: nextRequirement.callExpressionId,
    });

    expect(Number(ids.nextCalleeExpressionId.hirId)).toBe(105);
    expect(Number(ids.finishExpressionId.hirId)).toBe(106);
  });
});
