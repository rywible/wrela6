import { describe, expect, test } from "bun:test";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import { computeImageDeviceFacts } from "../../../src/layout/image-device-layout";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { layoutValidatedBufferKeyString } from "../../../src/layout/layout-fact-builder-support";
import { layoutFieldKeyString, layoutTypeKeyString } from "../../../src/layout/type-key";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { draftLayoutTermKey } from "../../../src/proof-mir/draft/draft-keys";
import {
  createProofMirLayoutBindingIndex,
  proofMirLayoutReferenceKey,
} from "../../../src/proof-mir/domains/layout-binding-index";
import type { ProofMirLayoutReference } from "../../../src/proof-mir/model/layout-bindings";
import {
  imageDeviceLayoutFixture,
  layoutTargetWithUefiProfile,
  platformEdgeProgramFixture,
  validatedBufferProgramFixture,
} from "../../support/layout/layout-fixtures";
import { targetId } from "../../../src/semantic/ids";

function validatedBufferProofMirLayoutFixture(input: {
  readonly layoutSource: readonly string[];
}): {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly bufferInstanceId: ReturnType<typeof monoInstanceId>;
  readonly tagFieldId: import("../../../src/semantic/ids").FieldId;
  readonly payloadFieldId: import("../../../src/semantic/ids").FieldId;
} {
  const fixtureInput = validatedBufferProgramFixture({ layoutSource: input.layoutSource });
  const layoutResult = computeRepresentationLayoutFacts({
    program: fixtureInput.program,
    target: layoutTargetWithUefiProfile(),
  });
  if (layoutResult.kind !== "ok") {
    throw new Error(
      `validatedBufferProofMirLayoutFixture failed: ${layoutResult.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }

  const buffer = layoutResult.facts.validatedBuffers.entries()[0];
  if (buffer === undefined) {
    throw new Error("expected validated buffer layout fact");
  }
  const tagField =
    buffer.layoutFields.find((field) => field.name === "tag") ??
    buffer.layoutFields.find((field) => field.name === "header") ??
    buffer.layoutFields[0];
  const payloadField =
    buffer.layoutFields.find((field) => field.name === "payload") ??
    buffer.layoutFields.find((field) => field.name === "body") ??
    buffer.layoutFields[1] ??
    tagField;
  if (tagField === undefined || payloadField === undefined) {
    throw new Error("expected validated-buffer layout fields");
  }

  return {
    program: fixtureInput.program,
    layout: layoutResult.facts,
    bufferInstanceId: buffer.instanceId,
    tagFieldId: tagField.fieldId,
    payloadFieldId: payloadField.fieldId,
  };
}

describe("ProofMirLayoutBindingIndex", () => {
  test("layout term paths distinguish read requirement operands", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["header: u8 @ 0 len 14", "body: u8 @ 14 len source.len - 14"],
    });
    const index = createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    });

    const left = index.resolveTerm({
      root: {
        kind: "validatedBufferReadRequirement",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.payloadFieldId,
        requirementIndex: 0,
        slot: "left",
      },
      childPath: [],
      expectedUnit: "elementCount",
    });
    const right = index.resolveTerm({
      root: {
        kind: "validatedBufferReadRequirement",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.payloadFieldId,
        requirementIndex: 0,
        slot: "right",
      },
      childPath: [],
      expectedUnit: "byteLength",
    });

    expect(left.kind).toBe("ok");
    expect(right.kind).toBe("ok");
    if (left.kind === "ok" && right.kind === "ok") {
      expect(left.key).not.toBe(right.key);
    }
  });

  test("resolves validated-buffer field offset terms through child paths", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0", "payload: u8 @ tag + 1"],
    });
    const index = createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    });

    const tagOperand = index.resolveTerm({
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.payloadFieldId,
        slot: "offset",
      },
      childPath: ["left"],
      expectedUnit: "byteOffset",
    });
    const constantOperand = index.resolveTerm({
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.payloadFieldId,
        slot: "offset",
      },
      childPath: ["right"],
      expectedUnit: "byteOffset",
    });

    expect(tagOperand.kind).toBe("ok");
    expect(constantOperand.kind).toBe("ok");
    if (tagOperand.kind === "ok" && constantOperand.kind === "ok") {
      expect(tagOperand.key).not.toBe(constantOperand.key);
    }
  });

  test("repeated term path resolution reuses the same draft term key", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0", "payload: u8 @ tag + 1"],
    });
    const index = createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    });
    const input = {
      root: {
        kind: "validatedBufferSourceLength" as const,
        instanceId: fixture.bufferInstanceId,
      },
      childPath: [] as const,
      expectedUnit: "byteLength" as const,
    };

    const first = index.resolveTerm(input);
    const second = index.resolveTerm(input);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind === "ok" && second.kind === "ok") {
      expect(first.key).toBe(second.key);
      expect(index.layoutTermRecords()).toHaveLength(1);
    }
  });

  test("resolves layout references for type, field, validated-buffer, and ABI facts", () => {
    const validatedBuffer = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0"],
    });

    const bufferFact = validatedBuffer.layout.validatedBuffers.entries()[0]!;
    const layoutFieldFact = validatedBuffer.layout.fields.entries()[0]!;
    const typeReference: ProofMirLayoutReference = {
      kind: "type",
      key: bufferFact.typeKey,
    };
    const fieldReference: ProofMirLayoutReference = {
      kind: "field",
      key: {
        owner: layoutFieldFact.owner,
        fieldId: layoutFieldFact.fieldId,
      },
    };
    const validatedBufferReference: ProofMirLayoutReference = {
      kind: "validatedBuffer",
      instanceId: validatedBuffer.bufferInstanceId,
    };
    const validatedBufferFieldReference: ProofMirLayoutReference = {
      kind: "validatedBufferField",
      instanceId: validatedBuffer.bufferInstanceId,
      fieldId: validatedBuffer.tagFieldId,
    };
    const functionInstance = validatedBuffer.program.functions.entries()[0]!;
    const functionAbiReference: ProofMirLayoutReference = {
      kind: "functionAbi",
      functionInstanceId: functionInstance.instanceId,
    };
    const imageEntryReference: ProofMirLayoutReference = {
      kind: "imageEntryAbi",
      imageInstanceId: validatedBuffer.program.image.instanceId,
    };

    const index = createProofMirLayoutBindingIndex({
      layout: validatedBuffer.layout,
    });

    expect(index.resolveReference(typeReference).kind).toBe("ok");
    expect(index.resolveReference(fieldReference).kind).toBe("ok");
    expect(index.resolveReference(validatedBufferReference).kind).toBe("ok");
    expect(index.resolveReference(validatedBufferFieldReference).kind).toBe("ok");
    expect(index.resolveReference(functionAbiReference).kind).toBe("ok");
    expect(index.resolveReference(imageEntryReference).kind).toBe("ok");

    expect(proofMirLayoutReferenceKey(typeReference)).toBe(layoutTypeKeyString(bufferFact.typeKey));
    expect(proofMirLayoutReferenceKey(validatedBufferReference)).toBe(
      layoutValidatedBufferKeyString(validatedBuffer.bufferInstanceId),
    );
  });

  test("resolves platform ABI layout references", () => {
    const platformInput = platformEdgeProgramFixture({
      layoutTarget: layoutTargetWithUefiProfile({ targetId: targetId("uefi-aarch64") }),
    });
    const platform = computeRepresentationLayoutFacts(platformInput);
    expect(platform.kind).toBe("ok");
    if (platform.kind !== "ok") {
      return;
    }

    const platformEdge = platform.facts.platformEdges.entries()[0];
    expect(platformEdge).toBeDefined();
    if (platformEdge === undefined) {
      return;
    }

    const index = createProofMirLayoutBindingIndex({
      layout: platform.facts,
    });
    expect(
      index.resolveReference({
        kind: "platformAbi",
        edgeId: platformEdge.edgeId,
      }).kind,
    ).toBe("ok");
  });

  test("resolves image-device layout references", () => {
    const imageDevice = imageDeviceLayoutFixture();
    const deviceFacts = computeImageDeviceFacts(imageDevice);
    expect(deviceFacts.kind).toBe("ok");
    if (deviceFacts.kind !== "ok") {
      return;
    }

    const device = deviceFacts.value.devices.entries()[0];
    expect(device).toBeDefined();
    if (device === undefined) {
      return;
    }

    const layout = {
      imageDevices: deviceFacts.value.devices,
    } as LayoutFactProgram;
    const index = createProofMirLayoutBindingIndex({
      layout,
    });
    const result = index.resolveReference({
      kind: "imageDevice",
      key: device.key,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.layoutReferenceKey).toBe(deviceFacts.value.devices.keyString(device.key));
    }
  });

  test("unsupported layout term paths return PROOF_MIR_INVALID_LAYOUT_TERM_PATH", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0"],
    });
    const index = createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    });

    const unsupportedChild = index.resolveTerm({
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.tagFieldId,
        slot: "offset",
      },
      childPath: ["left"],
      expectedUnit: "byteOffset",
    });
    const missingSlot = index.resolveTerm({
      root: {
        kind: "validatedBufferReadRequirement",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.tagFieldId,
        requirementIndex: 0,
        slot: "left",
      },
      childPath: [],
      expectedUnit: "byteOffset",
    });

    expect(unsupportedChild.kind).toBe("error");
    expect(missingSlot.kind).toBe("error");
    if (unsupportedChild.kind === "error") {
      expect(unsupportedChild.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_INVALID_LAYOUT_TERM_PATH"),
      );
    }
    if (missingSlot.kind === "error") {
      expect(missingSlot.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_INVALID_LAYOUT_TERM_PATH"),
      );
    }
  });

  test("layout term unit mismatches return PROOF_MIR_INVALID_LAYOUT_TERM_PATH", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0"],
    });
    const index = createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    });

    const result = index.resolveTerm({
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.tagFieldId,
        slot: "offset",
      },
      childPath: [],
      expectedUnit: "byteLength",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_INVALID_LAYOUT_TERM_PATH"),
      );
    }
  });

  test("missing layout references return the corresponding diagnostic code", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0"],
    });
    const index = createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    });
    const bufferFact = fixture.layout.validatedBuffers.entries()[0]!;

    const missingType = index.resolveReference({
      kind: "type",
      key: { kind: "source", instanceId: monoInstanceId("type:missing") },
    });
    const missingField = index.resolveReference({
      kind: "field",
      key: {
        owner: bufferFact.typeKey,
        fieldId: 999 as import("../../../src/semantic/ids").FieldId,
      },
    });
    const missingBuffer = index.resolveReference({
      kind: "validatedBuffer",
      instanceId: monoInstanceId("validated-buffer:missing"),
    });

    expect(missingType.kind).toBe("error");
    expect(missingField.kind).toBe("error");
    expect(missingBuffer.kind).toBe("error");
    if (missingType.kind === "error") {
      expect(missingType.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_MISSING_LAYOUT_TYPE_FACT"),
      );
    }
    if (missingField.kind === "error") {
      expect(missingField.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_MISSING_LAYOUT_FIELD_FACT"),
      );
    }
    if (missingBuffer.kind === "error") {
      expect(missingBuffer.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT"),
      );
    }
  });

  test("resolved layout terms use draftLayoutTermKey", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0"],
    });
    const index = createProofMirLayoutBindingIndex({
      layout: fixture.layout,
    });
    const result = index.resolveTerm({
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: fixture.bufferInstanceId,
        fieldId: fixture.tagFieldId,
        slot: "end",
      },
      childPath: [],
      expectedUnit: "byteOffset",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.key).toBe(
        draftLayoutTermKey({
          layoutReferenceKey: result.layoutReferenceKey,
          termPath: result.termPath,
        }),
      );
      expect(result.layoutReferenceKey).toBe(
        layoutValidatedBufferKeyString(fixture.bufferInstanceId),
      );
    }
  });

  test("field layout reference keys match layout field table keys", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0"],
    });
    const layoutFieldFact = fixture.layout.fields.entries()[0]!;
    const fieldKey = {
      owner: layoutFieldFact.owner,
      fieldId: layoutFieldFact.fieldId,
    };

    expect(
      proofMirLayoutReferenceKey({
        kind: "field",
        key: fieldKey,
      }),
    ).toBe(layoutFieldKeyString(fieldKey));
  });
});
