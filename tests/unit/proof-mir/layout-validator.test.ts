import { describe, expect, test } from "bun:test";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import type { FieldId } from "../../../src/semantic/ids";
import type { MonoProofMetadata } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirFactId,
  proofMirLayoutTermBindingId,
  proofMirLayoutTermId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirStatementId,
  proofMirTerminatorId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import type { ProofMirFunction } from "../../../src/proof-mir/model/graph";
import type { ProofMirLayoutTermRecord } from "../../../src/proof-mir/model/layout-bindings";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import { validateProofMirLayout } from "../../../src/proof-mir/validation/layout-validator";
import {
  layoutTargetWithUefiProfile,
  validatedBufferProgramFixture,
} from "../../support/layout/layout-fixtures";
import { functionId, itemId } from "../../../src/semantic/ids";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog-types";

function emptyTable<_Key, _Value>() {
  return {
    get: () => undefined,
    has: () => false,
    entries: () => [],
    keyOf: () => proofMirCanonicalKey("empty"),
    lookupKeyOf: () => proofMirCanonicalKey("empty"),
  };
}

function validatedBufferLayoutFixture(): {
  readonly layout: LayoutFactProgram;
  readonly bufferInstanceId: ReturnType<typeof monoInstanceId>;
  readonly payloadFieldId: FieldId;
} {
  const fixtureInput = validatedBufferProgramFixture({
    layoutSource: ["header: u8 @ 0 len 14", "body: u8 @ 14 len source.len - 14"],
  });
  const layoutResult = computeRepresentationLayoutFacts({
    program: fixtureInput.program,
    target: layoutTargetWithUefiProfile(),
  });
  if (layoutResult.kind !== "ok") {
    throw new Error("layout fixture failed");
  }
  const buffer = layoutResult.facts.validatedBuffers.entries()[0];
  const payloadField =
    buffer?.layoutFields.find((field) => field.name === "body") ?? buffer?.layoutFields[1];
  if (buffer === undefined || payloadField === undefined) {
    throw new Error("validated buffer fixture missing fields");
  }
  return {
    layout: layoutResult.facts,
    bufferInstanceId: buffer.instanceId,
    payloadFieldId: payloadField.fieldId,
  };
}

function layoutTermRecord(input: {
  readonly termId: ReturnType<typeof proofMirLayoutTermId>;
  readonly bufferInstanceId: ReturnType<typeof monoInstanceId>;
  readonly fieldId: FieldId;
  readonly slot: "offset" | "end";
}): ProofMirLayoutTermRecord {
  return {
    termId: input.termId,
    path: {
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: input.bufferInstanceId,
        fieldId: input.fieldId,
        slot: input.slot,
      },
      childPath: [],
    },
    unit: input.slot === "offset" ? "byteOffset" : "byteLength",
    origin: proofMirOriginId(0),
  };
}

function functionGraphForLayout(input: {
  readonly functionInstanceId: ReturnType<typeof monoInstanceId>;
  readonly statements: ProofMirFunction["blocks"] extends infer _Table
    ? _Table extends { entries(): readonly (infer Block)[] }
      ? Block extends { readonly statements: infer Statements }
        ? Statements
        : never
      : never
    : never;
  readonly terminator: ProofMirFunction["blocks"] extends infer _Table
    ? _Table extends { entries(): readonly (infer Block)[] }
      ? Block extends { readonly terminator: infer Terminator }
        ? Terminator
        : never
      : never
    : never;
}): ProofMirFunction {
  const origin = proofMirOriginId(0);
  const blockId = proofMirBlockId(0);
  const block = {
    blockId,
    scopeId: 0 as never,
    parameters: [],
    statements: input.statements,
    terminator: input.terminator,
    incomingEdges: [],
    origin,
  };
  const blocks = proofMirDeterministicTable({
    entries: [block],
    keyOf: (entry) => proofMirCanonicalKey(`block:${String(entry.blockId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`block:${String(id)}`),
    normalizePayload: (entry) => String(entry.blockId),
  });
  if (blocks.kind !== "ok") {
    throw new Error("block table failed");
  }
  return {
    functionInstanceId: input.functionInstanceId,
    sourceFunctionId: functionId(0),
    signature: {
      functionId: functionId(0),
      itemId: itemId(0),
      parameters: [],
      returnType: { kind: "primitive", name: "unit" } as never,
      returnKind: "Copy",
      modifiers: {
        isPlatform: false,
        isTerminal: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      sourceSpan: { start: 0, end: 0, length: 0 },
    },
    entryBlockId: blockId,
    blocks: blocks.table,
    edges: emptyTable(),
    values: emptyTable(),
    locals: emptyTable(),
    places: emptyTable(),
    scopes: emptyTable(),
    exits: [],
    origin,
  };
}

function programForLayout(input: {
  readonly layout: LayoutFactProgram;
  readonly functions: readonly ProofMirFunction[];
  readonly layoutTerms?: readonly ProofMirLayoutTermRecord[];
}): ProofMirProgram {
  const imageInstanceId = input.layout.imageEntry.imageInstanceId;
  const functions = proofMirDeterministicTable({
    entries: input.functions,
    keyOf: (entry) => proofMirCanonicalKey(`function:${String(entry.functionInstanceId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`function:${String(id)}`),
    normalizePayload: (entry) => String(entry.functionInstanceId),
  });
  const layoutTerms = proofMirDeterministicTable({
    entries: input.layoutTerms ?? [],
    keyOf: (entry) => proofMirCanonicalKey(`layout-term:${String(entry.termId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`layout-term:${String(id)}`),
    normalizePayload: (entry) => String(entry.termId),
  });
  if (functions.kind !== "ok" || layoutTerms.kind !== "ok") {
    throw new Error("program tables failed");
  }

  return {
    image: {
      imageInstanceId,
      entryFunctionInstanceId:
        input.functions[0]?.functionInstanceId ?? monoInstanceId("function:main"),
      externalRoots: [],
      layout: { kind: "imageEntryAbi", imageInstanceId },
      origin: proofMirOriginId(0),
    },
    functions: functions.table,
    layout: input.layout,
    proofMetadata: {} as MonoProofMetadata,
    origins: emptyTable(),
    facts: emptyTable(),
    layoutTerms: layoutTerms.table,
    privateStateGenerations: emptyTable(),
    callGraph: emptyTable(),
    platformEdges: emptyTable(),
    runtimeCatalog: {
      targetId: "x64-test" as never,
      features: [],
      get: () => undefined,
      entries: () => [],
    } satisfies ProofMirRuntimeCatalog,
    runtimeCalls: emptyTable(),
  };
}

describe("validateProofMirLayout", () => {
  test("missing layout reference is rejected", () => {
    const fixture = validatedBufferLayoutFixture();
    const functionInstanceId = monoInstanceId("function:main");
    const program = programForLayout({
      layout: fixture.layout,
      functions: [
        functionGraphForLayout({
          functionInstanceId,
          statements: [
            {
              statementId: proofMirStatementId(0),
              kind: {
                kind: "validate",
                validation: {
                  validationId: {
                    owner: { kind: "function", instanceId: functionInstanceId },
                    hirId: 0 as never,
                    instanceId: functionInstanceId,
                  },
                  sourcePlace: proofMirPlaceId(0),
                  pendingResultPlace: proofMirPlaceId(1),
                  okPacketPlace: proofMirPlaceId(2),
                  okPayloadType: { kind: "primitive", name: "unit" } as never,
                  errPayloadType: { kind: "primitive", name: "unit" } as never,
                  validatedBufferInstanceId: monoInstanceId("missing-buffer"),
                  layout: {
                    kind: "validatedBuffer",
                    instanceId: monoInstanceId("missing-buffer"),
                  },
                  origin: proofMirOriginId(0),
                },
              },
              origin: proofMirOriginId(0),
            },
          ],
          terminator: {
            terminatorId: proofMirTerminatorId(0),
            kind: { kind: "unreachable", reason: "unreachableSource" },
            outgoingEdges: [],
            origin: proofMirOriginId(0),
          },
        }),
      ],
    });

    const diagnostics = validateProofMirLayout(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT"),
    );
  });

  test("validated-buffer read missing term binding is rejected", () => {
    const fixture = validatedBufferLayoutFixture();
    const functionInstanceId = monoInstanceId("function:main");
    const offsetTermId = proofMirLayoutTermId(1);
    const endTermId = proofMirLayoutTermId(2);
    const program = programForLayout({
      layout: fixture.layout,
      layoutTerms: [
        layoutTermRecord({
          termId: offsetTermId,
          bufferInstanceId: fixture.bufferInstanceId,
          fieldId: fixture.payloadFieldId,
          slot: "offset",
        }),
        layoutTermRecord({
          termId: endTermId,
          bufferInstanceId: fixture.bufferInstanceId,
          fieldId: fixture.payloadFieldId,
          slot: "end",
        }),
      ],
      functions: [
        functionGraphForLayout({
          functionInstanceId,
          statements: [
            {
              statementId: proofMirStatementId(0),
              kind: {
                kind: "readValidatedBufferField",
                read: {
                  sourcePlace: proofMirPlaceId(0),
                  validatedBufferInstanceId: fixture.bufferInstanceId,
                  fieldId: fixture.payloadFieldId,
                  layoutField: {
                    kind: "validatedBufferField",
                    instanceId: fixture.bufferInstanceId,
                    fieldId: fixture.payloadFieldId,
                  },
                  offsetTerm: {
                    termId: offsetTermId,
                    unit: "byteOffset",
                    path: {
                      root: {
                        kind: "validatedBufferFieldTerm",
                        instanceId: fixture.bufferInstanceId,
                        fieldId: fixture.payloadFieldId,
                        slot: "offset",
                      },
                      childPath: [],
                    },
                  },
                  endTerm: {
                    termId: endTermId,
                    unit: "byteLength",
                    path: {
                      root: {
                        kind: "validatedBufferFieldTerm",
                        instanceId: fixture.bufferInstanceId,
                        fieldId: fixture.payloadFieldId,
                        slot: "end",
                      },
                      childPath: [],
                    },
                  },
                  termBindings: [proofMirLayoutTermBindingId(9)],
                  readRequires: [proofMirFactId(0)],
                  result: proofMirValueId(0),
                  origin: proofMirOriginId(0),
                },
              },
              origin: proofMirOriginId(0),
            },
          ],
          terminator: {
            terminatorId: proofMirTerminatorId(0),
            kind: { kind: "unreachable", reason: "unreachableSource" },
            outgoingEdges: [],
            origin: proofMirOriginId(0),
          },
        }),
      ],
    });

    const diagnostics = validateProofMirLayout(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_LAYOUT_TERM_BINDING"),
    );
  });

  test("validation ok binding not visible on ok edge is rejected", () => {
    const fixture = validatedBufferLayoutFixture();
    const functionInstanceId = monoInstanceId("function:main");
    const okEdgeId = proofMirControlEdgeId(0);
    const errEdgeId = proofMirControlEdgeId(1);
    const okValueId = proofMirValueId(3);
    const function_ = functionGraphForLayout({
      functionInstanceId,
      statements: [],
      terminator: {
        terminatorId: proofMirTerminatorId(0),
        kind: {
          kind: "matchValidation",
          match: {
            validationId: {
              owner: { kind: "function", instanceId: functionInstanceId },
              hirId: 0 as never,
              instanceId: functionInstanceId,
            },
            okTarget: { edgeId: okEdgeId, blockId: proofMirBlockId(1) },
            errTarget: { edgeId: errEdgeId, blockId: proofMirBlockId(2) },
            okBindings: [
              {
                bindingKind: "payload",
                operand: { kind: "value", value: okValueId },
                type: { kind: "primitive", name: "unit" } as never,
                origin: proofMirOriginId(0),
              },
            ],
            errBindings: [],
            origin: proofMirOriginId(0),
          },
        },
        outgoingEdges: [okEdgeId, errEdgeId],
        origin: proofMirOriginId(0),
      },
    });

    const edges = proofMirDeterministicTable({
      entries: [
        {
          edgeId: okEdgeId,
          fromBlockId: proofMirBlockId(0),
          toBlockId: proofMirBlockId(1),
          kind: "validationOk" as const,
          arguments: [],
          facts: [],
          effects: [],
          crossedScopes: [],
          origin: proofMirOriginId(0),
        },
        {
          edgeId: errEdgeId,
          fromBlockId: proofMirBlockId(0),
          toBlockId: proofMirBlockId(2),
          kind: "validationErr" as const,
          arguments: [],
          facts: [],
          effects: [],
          crossedScopes: [],
          origin: proofMirOriginId(0),
        },
      ],
      keyOf: (entry) => proofMirCanonicalKey(`edge:${String(entry.edgeId)}`),
      lookupKeyOf: (id) => proofMirCanonicalKey(`edge:${String(id)}`),
      normalizePayload: (entry) => String(entry.edgeId),
    });
    if (edges.kind !== "ok") {
      throw new Error("edge table failed");
    }

    const program = programForLayout({
      layout: fixture.layout,
      functions: [{ ...function_, edges: edges.table }],
    });

    const diagnostics = validateProofMirLayout(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALIDATION_BINDING"),
    );
  });

  test("attempt start missing lowered fallible operand is rejected", () => {
    const fixture = validatedBufferLayoutFixture();
    const functionInstanceId = monoInstanceId("function:main");
    const program = programForLayout({
      layout: fixture.layout,
      functions: [
        functionGraphForLayout({
          functionInstanceId,
          statements: [
            {
              statementId: proofMirStatementId(0),
              kind: {
                kind: "attempt",
                attempt: {
                  attemptId: {
                    owner: { kind: "function", instanceId: functionInstanceId },
                    hirId: 0 as never,
                    instanceId: functionInstanceId,
                  },
                  fallible: {
                    expressionId: 0 as never,
                    origin: proofMirOriginId(0),
                  },
                  pendingResultPlace: proofMirPlaceId(4),
                  inputPlaces: [],
                  origin: proofMirOriginId(0),
                },
              },
              origin: proofMirOriginId(0),
            },
          ],
          terminator: {
            terminatorId: proofMirTerminatorId(0),
            kind: { kind: "unreachable", reason: "unreachableSource" },
            outgoingEdges: [],
            origin: proofMirOriginId(0),
          },
        }),
      ],
    });

    const diagnostics = validateProofMirLayout(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_ATTEMPT_START"),
    );
  });

  test("unsupported extension statement is rejected", () => {
    const fixture = validatedBufferLayoutFixture();
    const functionInstanceId = monoInstanceId("function:main");
    const program = programForLayout({
      layout: fixture.layout,
      functions: [
        functionGraphForLayout({
          functionInstanceId,
          statements: [
            {
              statementId: proofMirStatementId(0),
              kind: {
                kind: "extension",
                extension: {
                  gate: "crossCoreOwnership",
                  kind: "concurrency",
                  operation: {
                    kind: "transferOwnership",
                    fromPlace: proofMirPlaceId(0),
                    toPlace: proofMirPlaceId(1),
                    origin: proofMirOriginId(0),
                  },
                },
              },
              origin: proofMirOriginId(0),
            },
          ],
          terminator: {
            terminatorId: proofMirTerminatorId(0),
            kind: { kind: "unreachable", reason: "unreachableSource" },
            outgoingEdges: [],
            origin: proofMirOriginId(0),
          },
        }),
      ],
    });

    const diagnostics = validateProofMirLayout(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD"),
    );
  });
});
