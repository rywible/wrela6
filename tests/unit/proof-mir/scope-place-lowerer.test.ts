import { describe, expect, test } from "bun:test";
import {
  hirExpressionId,
  hirLocalId,
  hirStatementId,
  attemptId,
  resourcePlaceId,
  validationId,
} from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoAttempt,
  MonoBlock,
  MonoExpression,
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoMatchArm,
  MonoResourcePlace,
  MonoStatement,
  MonoStatementId,
  MonoValidation,
} from "../../../src/mono/mono-hir";
import {
  monoExpressionIdFor,
  monoStatementIdFor,
} from "../../../src/mono/function-instantiator-shell";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { draftScopeKey } from "../../../src/proof-mir/draft/draft-keys";
import { createProofMirOriginMap } from "../../../src/proof-mir/domains/origin-map";
import {
  createProofMirScopePlaceLowerer,
  type ProofMirScopeKind,
  type ProofMirScopeEntry,
} from "../../../src/proof-mir/lower/scope-place-lowerer";
import {
  buildProofMirScopeTreeForTest,
  collectLoopBoundaryInputsForTest,
  lowerProofMirPlaceForTest,
} from "../../support/proof-mir/lower-harness/scope-place-lowerer-harness";
import { fieldId, parameterId } from "../../../src/semantic/ids";

const functionInstanceId = monoInstanceId("fn:main");

function statementId(ordinal: number): MonoStatementId {
  return monoStatementIdFor(functionInstanceId, hirStatementId(ordinal));
}

function expressionId(ordinal: number): MonoExpressionId {
  return monoExpressionIdFor(functionInstanceId, hirExpressionId(ordinal));
}

function literalExpression(ordinal: number): MonoExpression {
  return {
    expressionId: expressionId(ordinal),
    kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: "source:1",
  };
}

function blockStatement(input: {
  readonly ordinal: number;
  readonly inner: readonly MonoStatement[];
}): MonoStatement {
  return {
    statementId: statementId(input.ordinal),
    kind: {
      kind: "block",
      block: {
        statements: input.inner,
        sourceOrigin: `source:block:${input.ordinal}`,
      },
    },
    sourceOrigin: `source:stmt:block:${input.ordinal}`,
  };
}

function loopStatement(input: {
  readonly ordinal: number;
  readonly body: readonly MonoStatement[];
}): MonoStatement {
  return {
    statementId: statementId(input.ordinal),
    kind: {
      kind: "loop",
      body: {
        statements: input.body,
        sourceOrigin: `source:loop:${input.ordinal}`,
      },
    },
    sourceOrigin: `source:stmt:loop:${input.ordinal}`,
  };
}

function whileStatement(input: {
  readonly ordinal: number;
  readonly body: readonly MonoStatement[];
}): MonoStatement {
  return {
    statementId: statementId(input.ordinal),
    kind: {
      kind: "while",
      statement: {
        condition: literalExpression(input.ordinal * 10),
        body: {
          statements: input.body,
          sourceOrigin: `source:while:${input.ordinal}`,
        },
      },
    },
    sourceOrigin: `source:stmt:while:${input.ordinal}`,
  };
}

function matchArm(input: {
  readonly patternText: string;
  readonly body: readonly MonoStatement[];
  readonly ordinal: number;
}): MonoMatchArm {
  return {
    patternText: input.patternText,
    body: {
      statements: input.body,
      sourceOrigin: `source:arm:${input.ordinal}`,
    },
    bindingLocals: [],
    sourceOrigin: `source:arm:${input.ordinal}`,
  };
}

function matchStatement(input: {
  readonly ordinal: number;
  readonly arms: readonly MonoMatchArm[];
}): MonoStatement {
  return {
    statementId: statementId(input.ordinal),
    kind: {
      kind: "match",
      statement: {
        scrutinee: literalExpression(input.ordinal * 10),
        arms: input.arms,
      },
    },
    sourceOrigin: `source:stmt:match:${input.ordinal}`,
  };
}

function validationProofId(
  value: number,
): MonoInstantiatedProofId<ReturnType<typeof validationId>> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId: validationId(value),
    instanceId: functionInstanceId,
  };
}

function validationMatchStatement(input: {
  readonly ordinal: number;
  readonly okBody: readonly MonoStatement[];
  readonly errBody: readonly MonoStatement[];
}): MonoStatement {
  const validation: MonoValidation = {
    validationId: validationProofId(input.ordinal),
    validationExpressionId: expressionId(input.ordinal * 10 + 1),
    sourcePlace: monoLocalPlaceFake({
      canonicalKey: "function:main/root:local:1",
      localOrdinal: 1,
    }),
    pendingResultPlace: monoLocalPlaceFake({
      canonicalKey: "function:main/root:local:2",
      localOrdinal: 2,
    }),
    validatedBufferTypeId: 0 as never,
    okPayloadType: { kind: "primitive", name: "u8" } as never,
    errPayloadType: { kind: "primitive", name: "u8" } as never,
    sourceOrigin: `source:validation:${input.ordinal}`,
  };

  return {
    statementId: statementId(input.ordinal),
    kind: {
      kind: "validationMatch",
      statement: {
        validationMatchId: validationProofId(input.ordinal),
        scrutinee: literalExpression(input.ordinal * 10),
        validation,
        okArm: matchArm({
          patternText: "ok",
          body: input.okBody,
          ordinal: input.ordinal * 100,
        }),
        errArm: matchArm({
          patternText: "err",
          body: input.errBody,
          ordinal: input.ordinal * 100 + 1,
        }),
        sourceOrigin: `source:stmt:validationMatch:${input.ordinal}`,
      },
    },
    sourceOrigin: `source:stmt:validationMatch:${input.ordinal}`,
  };
}

function attemptProofId(value: number): MonoInstantiatedProofId<ReturnType<typeof attemptId>> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId: attemptId(value),
    instanceId: functionInstanceId,
  };
}

function attemptExpression(input: {
  readonly ordinal: number;
  readonly alternative?: MonoExpression;
}): MonoExpression {
  const attempt: MonoAttempt = {
    attemptId: attemptProofId(input.ordinal),
    attemptExpressionId: expressionId(input.ordinal),
    fallibleExpression: literalExpression(input.ordinal * 10),
    ...(input.alternative === undefined ? {} : { alternativeExpression: input.alternative }),
    declaredInputPlaces: [],
    sourceOrigin: `source:attempt:${input.ordinal}`,
  };

  return {
    expressionId: expressionId(input.ordinal),
    kind: { kind: "attempt", attempt },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:expr:attempt:${input.ordinal}`,
  };
}

function takeStatement(input: {
  readonly ordinal: number;
  readonly body: readonly MonoStatement[];
}): MonoStatement {
  return {
    statementId: statementId(input.ordinal),
    kind: {
      kind: "take",
      statement: {
        operand: {
          kind: "place",
          place: monoLocalPlaceFake({
            canonicalKey: "function:main/root:local:3",
            localOrdinal: 3,
          }),
          expression: literalExpression(input.ordinal * 10),
        },
        takeKind: { kind: "error" },
        body: {
          statements: input.body,
          sourceOrigin: `source:take:${input.ordinal}`,
        },
        sourceOrigin: `source:stmt:take:${input.ordinal}`,
      },
    },
    sourceOrigin: `source:stmt:take:${input.ordinal}`,
  };
}

function monoLocalPlaceFake(input: {
  readonly canonicalKey: string;
  readonly localOrdinal: number;
  readonly projection?: MonoResourcePlace["projection"];
}): MonoResourcePlace {
  const localId = instantiatedHirId(functionInstanceId, hirLocalId(input.localOrdinal));
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(input.localOrdinal),
      instanceId: functionInstanceId,
    },
    canonicalKey: input.canonicalKey,
    root: { kind: "local", localId },
    projection: input.projection ?? [],
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:place:${input.localOrdinal}`,
    kind: "local",
    localId,
  };
}

function functionBody(statements: readonly MonoStatement[]): MonoBlock {
  return {
    statements,
    sourceOrigin: "source:function",
  };
}

function scopeKinds(entries: readonly ProofMirScopeEntry[]): ProofMirScopeKind[] {
  return entries.map((entry) => entry.kind);
}

function scopeRoles(entries: readonly ProofMirScopeEntry[]): string[] {
  return entries.map((entry) => entry.role);
}

describe("ProofMirScopePlaceLowerer scope tree", () => {
  test("creates function, block, loop, match-arm, validation-arm, attempt-arm, and take scopes", () => {
    const body = functionBody([
      blockStatement({ ordinal: 1, inner: [loopStatement({ ordinal: 2, body: [] })] }),
      matchStatement({
        ordinal: 3,
        arms: [matchArm({ patternText: "a", body: [], ordinal: 1 })],
      }),
      validationMatchStatement({ ordinal: 4, okBody: [], errBody: [] }),
      takeStatement({ ordinal: 5, body: [] }),
      {
        statementId: statementId(6),
        kind: { kind: "expression", expression: attemptExpression({ ordinal: 7 }) },
        sourceOrigin: "source:stmt:expr:6",
      },
    ]);

    const built = buildProofMirScopeTreeForTest({ functionInstanceId, body });
    expect(built.kind).toBe("ok");
    if (built.kind !== "ok") return;

    expect(scopeKinds(built.value.scopeEntries)).toEqual(
      expect.arrayContaining([
        "function",
        "block",
        "loop",
        "matchArm",
        "validationArm",
        "validationArm",
        "take",
        "attemptArm",
      ]),
    );
  });

  test("scope parent links are acyclic and preserve source nesting", () => {
    const body = functionBody([
      whileStatement({
        ordinal: 1,
        body: [blockStatement({ ordinal: 2, inner: [] })],
      }),
    ]);
    const built = buildProofMirScopeTreeForTest({ functionInstanceId, body });
    expect(built.kind).toBe("ok");
    if (built.kind !== "ok") return;

    const tree = built.value.scopeTree;
    const loopRole = scopeRoles(built.value.scopeEntries).find((role) => role.startsWith("loop:"));
    const blockRole = scopeRoles(built.value.scopeEntries).find(
      (role) => role.startsWith("block:") && !role.endsWith(":then") && !role.endsWith(":else"),
    );
    expect(loopRole).toBeDefined();
    expect(blockRole).toBeDefined();
    if (loopRole === undefined || blockRole === undefined) return;

    expect(tree.parentRole(blockRole)).toBe(loopRole);
    expect(tree.parentRole(loopRole)).toBe("function");
    expect(tree.scopeStack(blockRole)).toEqual([blockRole, loopRole, "function"]);
  });

  test("scope keys are deterministic canonical keys", () => {
    const body = functionBody([loopStatement({ ordinal: 1, body: [] })]);
    const first = buildProofMirScopeTreeForTest({ functionInstanceId, body });
    const second = buildProofMirScopeTreeForTest({ functionInstanceId, body });
    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    const loopRole = scopeRoles(first.value.scopeEntries).find((role) => role.startsWith("loop:"));
    expect(loopRole).toBeDefined();
    if (loopRole === undefined) return;

    expect(first.value.scopeTree.scopeKey(loopRole)).toBe(
      second.value.scopeTree.scopeKey(loopRole),
    );
    expect(first.value.scopeTree.scopeKey(loopRole)).toBe(
      draftScopeKey({
        functionInstanceId,
        role: loopRole,
        parentScopeKey: draftScopeKey({ functionInstanceId, role: "function" }),
      }),
    );
  });
});

describe("ProofMirScopePlaceLowerer place lowering", () => {
  test("field projection keeps layout field reference", () => {
    const packetPlace = monoLocalPlaceFake({
      canonicalKey: "function:main/root:local:9/packet",
      localOrdinal: 9,
      projection: [{ kind: "field", fieldId: fieldId(3) }],
    });
    const lowered = lowerProofMirPlaceForTest({
      functionInstanceId,
      sourcePlace: "packet.payload",
      places: { "packet.payload": packetPlace },
      layoutField: {
        kind: "validatedBufferField",
        instanceId: monoInstanceId("type:Packet"),
        fieldId: fieldId(3),
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.place.projections[0]).toMatchObject({
      kind: "field",
      layout: { kind: "validatedBufferField" },
    });
  });

  test("mono structured places preserve locals, parameters, and projections", () => {
    const localPlace = monoLocalPlaceFake({
      canonicalKey: "function:main/root:local:4",
      localOrdinal: 4,
      projection: [{ kind: "field", fieldId: fieldId(1) }],
    });
    const parameterPlace: MonoResourcePlace = {
      ...monoLocalPlaceFake({ canonicalKey: "function:main/root:parameter:0", localOrdinal: 0 }),
      root: { kind: "parameter", parameterId: parameterId(0) },
      kind: "parameter",
      parameterId: parameterId(0),
    };

    const localLowered = lowerProofMirPlaceForTest({
      functionInstanceId,
      monoPlace: localPlace,
    });
    const parameterLowered = lowerProofMirPlaceForTest({
      functionInstanceId,
      monoPlace: parameterPlace,
    });

    expect(localLowered.kind).toBe("ok");
    expect(parameterLowered.kind).toBe("ok");
    if (localLowered.kind !== "ok" || parameterLowered.kind !== "ok") return;

    expect(localLowered.place.root).toEqual({ kind: "local", localId: localPlace.localId! });
    expect(localLowered.place.projections[0]?.kind).toBe("field");
    expect(parameterLowered.place.root).toEqual({
      kind: "parameter",
      parameterId: parameterId(0),
    });
  });

  test("unsupported or missing place metadata returns invalid value resource kind", () => {
    const result = lowerProofMirPlaceForTest({
      functionInstanceId,
      sourcePlace: "missing.place",
      places: {},
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALUE_RESOURCE_KIND"),
    );
  });
});

describe("ProofMirScopePlaceLowerer loop boundary sets", () => {
  test("loop boundary-set inputs sort resources by canonical key", () => {
    const body = functionBody([
      loopStatement({
        ordinal: 1,
        body: [
          {
            statementId: statementId(2),
            kind: {
              kind: "assignment",
              statement: {
                target: literalExpression(20),
                value: literalExpression(21),
                targetPlace: monoLocalPlaceFake({
                  canonicalKey: "function:main/root:local:20",
                  localOrdinal: 20,
                }),
              },
            },
            sourceOrigin: "source:stmt:assign:2",
          },
        ],
      }),
    ]);

    const built = createProofMirScopePlaceLowerer({
      functionInstanceId,
      body,
      originMap: createProofMirOriginMap(),
    });
    expect(built.kind).toBe("ok");
    if (built.kind !== "ok") return;

    const loopRole = scopeRoles(built.value.scopeEntries).find((role) => role.startsWith("loop:"));
    expect(loopRole).toBeDefined();
    if (loopRole === undefined) return;

    const inputs = collectLoopBoundaryInputsForTest({
      lowerer: built.value,
      loopRole,
      places: [
        built.value.lowerMonoPlace({
          monoPlace: monoLocalPlaceFake({
            canonicalKey: "function:main/root:local:20",
            localOrdinal: 20,
          }),
          originKey: built.value.allocateSyntheticOrigin("boundary.place"),
        }),
        built.value.lowerMonoPlace({
          monoPlace: monoLocalPlaceFake({
            canonicalKey: "function:main/root:local:10",
            localOrdinal: 10,
          }),
          originKey: built.value.allocateSyntheticOrigin("boundary.place"),
        }),
      ],
    });
    expect(inputs.kind).toBe("ok");
    if (inputs.kind !== "ok") return;

    const boundary = built.value.collectLoopBoundarySet({
      loopRole,
      ...inputs.value,
    });
    expect(boundary.places.length).toBe(2);
    expect(boundary.places[0]! < boundary.places[1]!).toBe(true);
  });
});
