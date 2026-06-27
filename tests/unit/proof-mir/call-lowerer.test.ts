import { describe, expect, test } from "bun:test";
import { hirExpressionId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import type { MonoCallExpression, MonoExpression } from "../../../src/mono/mono-hir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import type { ProofMirExpressionLowerer } from "../../../src/proof-mir/lower/lowering-context";
import type { ProofMirDraftOperand } from "../../../src/proof-mir/lower/lowering-operands";
import {
  lowerProofMirCallForTest,
  lowerProofMirCompilerRuntimeCallForTest,
  platformCallLowererFixture,
  runtimeCatalogForFixture,
  runtimeOperationForFixture,
  sourceCallLowererFixture,
} from "../../support/proof-mir/lower-harness/call-lowerer-harness";
import {
  proofMirCallId,
  proofMirOwnedCallId,
  proofMirRuntimeCallId,
  proofMirRuntimeOperationId,
} from "../../../src/proof-mir/ids";
import { targetId } from "../../../src/semantic/ids";

const observeValueOperand = {
  kind: "value" as const,
  value: proofMirCanonicalKey("test:operand:value:1"),
};

const observePlaceOperand = {
  kind: "place" as const,
  place: proofMirCanonicalKey("test:operand:place:2"),
};

const observeValueAndPlaceOperand = {
  kind: "valueAndPlace" as const,
  value: proofMirCanonicalKey("test:operand:value:3"),
  place: proofMirCanonicalKey("test:operand:place:4"),
};

const consumePlaceOperand = {
  kind: "place" as const,
  place: proofMirCanonicalKey("test:operand:place:5"),
};

function expressionLowererReturning(operand: ProofMirDraftOperand): ProofMirExpressionLowerer {
  return {
    lowerExpression: () => ({ kind: "ok", value: operand }),
    lowerExpressionAsPlace: () => ({
      kind: "ok",
      value:
        operand.kind === "place"
          ? operand
          : operand.kind === "valueAndPlace"
            ? { kind: "place", place: operand.place }
            : { kind: "place", place: proofMirCanonicalKey("test:operand:place:99") },
    }),
  };
}

describe("ProofMirCallLowerer", () => {
  test("certified platform call keeps contract edge and ABI reference", () => {
    const fixture = platformCallLowererFixture();
    const lowered = lowerProofMirCallForTest(fixture);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.call.target).toMatchObject({ kind: "certifiedPlatform" });
    expect(lowered.platformEdges).toHaveLength(1);
    expect(lowered.callGraphEdges[0]?.target).toEqual(lowered.call.target);
  });

  test("source function call references matching function ABI", () => {
    const fixture = sourceCallLowererFixture();
    const lowered = lowerProofMirCallForTest(fixture);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.call.target).toEqual({
      kind: "sourceFunction",
      functionInstanceId: fixture.calleeFunctionInstanceId!,
      abi: { kind: "functionAbi", functionInstanceId: fixture.calleeFunctionInstanceId! },
    });
    expect(lowered.callGraphEdges[0]?.target).toEqual(lowered.call.target);
    expect(lowered.platformEdges).toHaveLength(0);
  });

  test("observe arguments accept value, place, and value-and-place operands", () => {
    const baseFixture = platformCallLowererFixture();
    let argumentIndex = 0;
    const operands = [observeValueOperand, observePlaceOperand, observeValueAndPlaceOperand];
    const countingExpressionLowerer: ProofMirExpressionLowerer = {
      lowerExpression: () => ({
        kind: "ok",
        value: operands[argumentIndex++] ?? observeValueOperand,
      }),
      lowerExpressionAsPlace: () => ({
        kind: "ok",
        value: { kind: "place", place: proofMirCanonicalKey("test:operand:place:99") },
      }),
    };
    const fixture = platformCallLowererFixture({
      call: callWithArguments(baseFixture.call, baseFixture.callerFunctionInstanceId, [
        { mode: "observe" },
        { mode: "observe" },
        { mode: "observe" },
      ]),
      expressionLowerer: countingExpressionLowerer,
    });

    const lowered = lowerProofMirCallForTest(fixture);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.call.arguments.map((argument) => argument.mode)).toEqual([
      "observe",
      "observe",
      "observe",
    ]);
    expect(lowered.call.arguments.map((argument) => argument.operand.kind)).toEqual([
      "value",
      "place",
      "valueAndPlace",
    ]);
  });

  test("consume arguments require place or value-and-place operands", () => {
    const baseFixture = platformCallLowererFixture();
    const fixture = platformCallLowererFixture({
      call: callWithArguments(baseFixture.call, baseFixture.callerFunctionInstanceId, [
        { mode: "consume" },
      ]),
      expressionLowerer: expressionLowererReturning(observeValueOperand),
    });

    const lowered = lowerProofMirCallForTest(fixture);

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALUE_RESOURCE_KIND"),
    );
  });

  test("consume arguments accept place-backed operands", () => {
    const baseFixture = platformCallLowererFixture();
    const fixture = platformCallLowererFixture({
      call: callWithArguments(baseFixture.call, baseFixture.callerFunctionInstanceId, [
        { mode: "consume" },
      ]),
      expressionLowerer: expressionLowererReturning(consumePlaceOperand),
    });

    const lowered = lowerProofMirCallForTest(fixture);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.call.arguments[0]).toMatchObject({
      mode: "consume",
      operand: consumePlaceOperand,
    });
  });

  test("call-site requirement IDs are preserved from mono proof metadata", () => {
    const fixture = platformCallLowererFixture({ includeCallSiteRequirement: true });
    const lowered = lowerProofMirCallForTest(fixture);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.call.requirements).toHaveLength(1);
    expect(lowered.call.requirements[0]).toEqual(fixture.callSiteRequirementId);
  });

  test("platform ensured facts become trusted axioms with platform-edge dependency", () => {
    const fixture = platformCallLowererFixture({ includePlatformEnsuredFact: true });
    const lowered = lowerProofMirCallForTest(fixture);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.ensuredFacts).toHaveLength(1);
    expect(lowered.ensuredFacts[0]).toMatchObject({
      role: "trustedAxiom",
      kind: { kind: "platformEnsured" },
      dependsOn: [{ kind: "platformEdge", edgeId: fixture.platformEdgeId }],
    });
  });

  test("compiler runtime call checks target availability and records contract", () => {
    const functionInstanceId = monoInstanceId("fn:runtime-caller");
    const callKey = proofMirOwnedCallId(functionInstanceId, proofMirCallId(0));
    const lowered = lowerProofMirCompilerRuntimeCallForTest({
      functionInstanceId,
      runtimeId: proofMirRuntimeOperationId(1),
      runtimeCallId: proofMirRuntimeCallId(1),
      arguments: [],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.call.target).toMatchObject({ kind: "compilerRuntime" });
    expect(lowered.runtimeCalls).toHaveLength(1);
    expect(lowered.runtimeCalls[0]?.callId).toEqual(callKey);
    expect(lowered.callGraphEdges[0]?.target).toEqual(lowered.call.target);
  });

  test("unavailable runtime operation returns PROOF_MIR_RUNTIME_TARGET_UNAVAILABLE", () => {
    const functionInstanceId = monoInstanceId("fn:runtime-unavailable");
    const unavailableRuntimeId = proofMirRuntimeOperationId(99);
    const lowered = lowerProofMirCompilerRuntimeCallForTest({
      functionInstanceId,
      runtimeId: unavailableRuntimeId,
      runtimeCallId: proofMirRuntimeCallId(99),
      arguments: [],
      runtimeCatalog: runtimeCatalogForFixture([
        runtimeOperationForFixture({
          runtimeId: unavailableRuntimeId,
          name: "other_target_only",
          targetAvailability: { kind: "target", targetId: targetId("other-target") },
        }),
      ]),
    });

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_RUNTIME_TARGET_UNAVAILABLE"),
    );
  });
});

function callWithArguments(
  base: MonoCallExpression,
  callerFunctionInstanceId: MonoInstanceId,
  arguments_: readonly {
    readonly mode: "observe" | "consume";
  }[],
): MonoCallExpression {
  return {
    ...base,
    arguments: arguments_.map(
      (argument: { readonly mode: "observe" | "consume" }, index: number) => ({
        expression: {
          expressionId: instantiatedHirId(callerFunctionInstanceId, hirExpressionId(index + 10)),
          kind: { kind: "literal", literal: { kind: "integer", text: String(index) } },
          type: { kind: "core", coreTypeId: "u8" } as never,
          resourceKind: "Copy",
          sourceOrigin: `source:arg:${index}`,
        } satisfies MonoExpression,
        mode: argument.mode,
        sourceOrigin: `source:arg:${index}`,
      }),
    ),
  };
}
