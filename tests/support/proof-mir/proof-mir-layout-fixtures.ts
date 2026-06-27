import type { TypedHirProgram } from "../../../src/hir/hir";
import {
  validatedBufferProgramFixture,
  platformEdgeProgramFixture,
} from "../layout/layout-fixtures";
import { lowerTypedHirForTest } from "../hir/typed-hir-fixtures";
import {
  defaultProofMirLayoutTarget,
  monoAndLayoutForTypedHirProgram,
  proofMirBuildInputFromMonoLayout,
  requireLayoutFacts,
  type ProofMirBuildInput,
  type ValidatedBufferProofMirLayoutFixture,
  type ValidatedBufferProofMirLayoutFixtureInput,
} from "./proof-mir-build-input";

export type { ValidatedBufferProofMirLayoutFixture, ValidatedBufferProofMirLayoutFixtureInput };

export function validatedBufferProofMirLayoutFixture(
  input: ValidatedBufferProofMirLayoutFixtureInput,
): ValidatedBufferProofMirLayoutFixture {
  const layoutTarget = input.layoutTarget ?? defaultProofMirLayoutTarget();
  const fixtureInput = validatedBufferProgramFixture({
    layoutSource: input.layoutSource,
    ...(input.deriveSource !== undefined ? { deriveSource: input.deriveSource } : {}),
    target: layoutTarget,
  });
  const layout = requireLayoutFacts({
    program: fixtureInput.program,
    target: layoutTarget,
  });

  const buffer = layout.validatedBuffers.entries()[0];
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
    layout,
    bufferInstanceId: buffer.instanceId,
    tagFieldId: tagField.fieldId,
    payloadFieldId: payloadField.fieldId,
  };
}

export function platformCallProofMirFixture(): ProofMirBuildInput {
  const layoutTarget = defaultProofMirLayoutTarget();
  const fixtureInput = platformEdgeProgramFixture({ layoutTarget });
  const layout = requireLayoutFacts({
    program: fixtureInput.program,
    target: fixtureInput.target,
  });
  return proofMirBuildInputFromMonoLayout({
    program: fixtureInput.program,
    layout,
    layoutTarget: fixtureInput.target,
  });
}

export function validatedBufferReadProofMirFixture(): ProofMirBuildInput {
  const layoutFixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ tag + 1 len source.len - tag - 1"],
  });
  const layoutTarget = defaultProofMirLayoutTarget();
  return proofMirBuildInputFromMonoLayout({
    program: layoutFixture.program,
    layout: layoutFixture.layout,
    layoutTarget,
  });
}

function readTagWorkedExampleSource(): string {
  return [
    "validated buffer Packet:",
    "    params:",
    "        limits: u16",
    "    layout:",
    "        tag: u8 @ 0",
    "        payload: u8 @ 1 len source.len - 1",
    "    require:",
    "        source.len >= 2",
    "",
    "fn read_tag(packet: Packet) -> u8:",
    "    return packet.tag",
    "",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");
}

function readTagWorkedExampleTypedHirProgram(): TypedHirProgram {
  const source = readTagWorkedExampleSource();
  const program = lowerTypedHirForTest([["main.wr", source]]).program;
  const readTag = program.functions
    .entries()
    .find((func) => func.signature.parameters.length === 1);
  if (readTag === undefined) {
    throw new Error("read tag worked example fixture is missing read_tag function");
  }

  return {
    ...program,
    monoClosure: {
      ...program.monoClosure,
      externalEntryRoots: [
        ...program.monoClosure.externalEntryRoots,
        {
          functionId: readTag.functionId,
          ownerTypeArguments: [],
          functionTypeArguments: [],
          reason: "targetRequired",
          sourceOrigin: readTag.sourceOrigin,
        },
      ],
    },
  };
}

export function readTagWorkedExampleFixture(): ProofMirBuildInput {
  const layoutTarget = defaultProofMirLayoutTarget();
  const monoLayout = monoAndLayoutForTypedHirProgram(readTagWorkedExampleTypedHirProgram(), {
    layoutTarget,
  });
  return proofMirBuildInputFromMonoLayout({
    program: monoLayout.program,
    layout: monoLayout.layout,
    layoutTarget,
  });
}
