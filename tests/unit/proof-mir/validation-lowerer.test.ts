import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import type { DraftGraphEdgeView } from "../../../src/proof-mir/draft/draft-graph-builder";
import {
  lowerProofMirValidationCreationForTest,
  lowerProofMirValidationMatchForTest,
} from "../../support/proof-mir/lower-harness/validation-lowerer-harness";
import { validationLowererFixture } from "../../support/proof-mir/validation-lowerer-fixtures";

describe("ProofMirValidationLowerer", () => {
  test("validation ok edge consumes source and introduces packet", () => {
    const lowered = lowerProofMirValidationMatchForTest(validationLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.okEdge.effects.map((effect) => effect.kind)).toEqual([
      "consumePlace",
      "consumePlace",
      "introducePlace",
    ]);
    expect(lowered.errEdge.effects.map((effect) => effect.kind)).toEqual(["consumePlace"]);
  });

  test("validation creation records validation metadata and layout reference", () => {
    const fixture = validationLowererFixture();
    const lowered = lowerProofMirValidationCreationForTest({
      context: fixture.context,
      blockKey: fixture.blockKey,
      validation: fixture.validation,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statement.kind).toMatchObject({
      kind: "validate",
      validation: {
        validationId: fixture.validation.validationId,
        okPayloadType: fixture.validation.okPayloadType,
        errPayloadType: fixture.validation.errPayloadType,
        validatedBufferInstanceId: fixture.bufferInstanceId,
        layout: {
          kind: "validatedBuffer",
          instanceId: fixture.bufferInstanceId,
        },
      },
    });
    expect(lowered.statement.kind.kind).toBe("validate");
    if (lowered.statement.kind.kind !== "validate") return;
    expect(lowered.statement.kind.validation.sourcePlaceKey).toBeDefined();
    expect(lowered.statement.kind.validation.pendingResultPlaceKey).toBeDefined();
    expect(lowered.statement.kind.validation.okPacketPlaceKey).toBeDefined();
    expect(lowered.statement.kind.validation.originKey).toBeDefined();
  });

  test("validation match lowers to matchValidation terminator with distinct targets", () => {
    const lowered = lowerProofMirValidationMatchForTest(validationLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.terminator?.kind).toBe("matchValidation");
    if (lowered.terminator?.kind !== "matchValidation") return;

    expect(lowered.terminator.okTarget.block).not.toEqual(lowered.terminator.errTarget.block);
    expect(lowered.terminator.validationId).toEqual(lowered.validation.validationId);
  });

  test("ok edge carries validation evidence facts", () => {
    const lowered = lowerProofMirValidationMatchForTest(validationLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.okEdge.factKeys.length).toBeGreaterThan(0);
    expect(lowered.errEdge.factKeys).toEqual([]);
  });

  test("ok arm bindings are visible only on the ok edge", () => {
    const lowered = lowerProofMirValidationMatchForTest(validationLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.terminator?.kind).toBe("matchValidation");
    if (lowered.terminator?.kind !== "matchValidation") return;

    expect(lowered.terminator.okBindings).toHaveLength(1);
    expect(lowered.terminator.okBindings[0]?.bindingKind).toBe("packet");
    expect(lowered.terminator.errBindings).toEqual([]);
    expect(bindingVisibleOnEdge(lowered.okEdge, lowered.terminator.okBindings[0])).toBe(true);
    expect(bindingVisibleOnEdge(lowered.errEdge, lowered.terminator.okBindings[0])).toBe(false);
  });

  test("err edge introduces error payload only when materialized", () => {
    const lowered = lowerProofMirValidationMatchForTest(
      validationLowererFixture({ errBindingName: "errorPayload" }),
    );

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.errEdge.effects.map((effect) => effect.kind)).toEqual([
      "consumePlace",
      "introducePlace",
    ]);
    expect(lowered.terminator?.kind).toBe("matchValidation");
    if (lowered.terminator?.kind !== "matchValidation") return;
    expect(lowered.terminator.errBindings).toHaveLength(1);
    expect(lowered.terminator.errBindings[0]?.bindingKind).toBe("error");
  });

  test("missing validation arm metadata returns invalid binding diagnostic", () => {
    const fixture = validationLowererFixture({ omitOkArm: true });
    const lowered = lowerProofMirValidationMatchForTest(fixture);

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;

    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALIDATION_BINDING"),
    );
  });

  test("missing validation metadata returns invalid edge effects diagnostic", () => {
    const fixture = validationLowererFixture({ omitValidationMetadata: true });
    const lowered = lowerProofMirValidationMatchForTest(fixture);

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;

    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALIDATION_EDGE_EFFECTS"),
    );
  });
});

function bindingVisibleOnEdge(
  edge: DraftGraphEdgeView,
  binding:
    | {
        readonly operandValueKey?: string;
        readonly operandPlaceKey?: string;
      }
    | undefined,
): boolean {
  if (binding === undefined) {
    return false;
  }
  if (binding.operandValueKey === undefined) {
    return binding.operandPlaceKey !== undefined;
  }
  return edge.argumentKeys.includes(binding.operandValueKey as never);
}
