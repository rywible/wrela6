import { describe, expect, test } from "bun:test";
import { hirExpressionId, hirLocalId, hirStatementId, resourcePlaceId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoExpression,
  MonoExpressionId,
  MonoLocal,
  MonoResourcePlace,
  MonoStatementId,
} from "../../../src/mono/mono-hir";
import {
  monoExpressionIdFor,
  monoStatementIdFor,
} from "../../../src/mono/function-instantiator-shell";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import type { ProofMirExpressionLowerer } from "../../../src/proof-mir/lower/lowering-context";
import {
  createProofMirStatementLowerer,
  type DraftRecordedProofMirStatement,
} from "../../../src/proof-mir/lower/statement-lowerer";
import {
  lowerProofMirStatementForTest,
  lowerProofMirStatementsForTest,
} from "../../support/proof-mir/lower-harness/statement-lowerer-harness";

const functionInstanceId = monoInstanceId("fn:main");

function statementId(ordinal: number): MonoStatementId {
  return monoStatementIdFor(functionInstanceId, hirStatementId(ordinal));
}

function expressionId(ordinal: number): MonoExpressionId {
  return monoExpressionIdFor(functionInstanceId, hirExpressionId(ordinal));
}

function scalarLocal(ordinal: number, name: string): MonoLocal {
  const localId = instantiatedHirId(functionInstanceId, hirLocalId(ordinal));
  return {
    localId,
    name,
    type: { kind: "core", coreTypeId: "u8" } as never,
    resourceKind: "Copy",
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: `source:local:${name}`,
  };
}

function placeBackedLocal(ordinal: number, name: string): MonoLocal {
  return {
    ...scalarLocal(ordinal, name),
    resourceKind: "Affine",
    type: {
      kind: "applied",
      constructor: { kind: "source", typeId: 1 as never },
      arguments: [],
      resourceKind: { kind: "concrete", value: "Affine" },
    } as never,
  };
}

function literalExpression(ordinal: number): MonoExpression {
  return {
    expressionId: expressionId(ordinal),
    kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
    type: { kind: "core", coreTypeId: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:expr:${ordinal}`,
  };
}

function nameExpression(local: MonoLocal): MonoExpression {
  return {
    expressionId: expressionId(Number(String(local.localId.hirId))),
    kind: { kind: "name", name: local.name, localId: local.localId },
    type: local.type,
    resourceKind: local.resourceKind,
    sourceOrigin: local.sourceOrigin,
  };
}

function monoLocalPlace(local: MonoLocal): MonoResourcePlace {
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(Number(String(local.localId.hirId))),
      instanceId: functionInstanceId,
    },
    canonicalKey: `function:main/root:local:${local.name}`,
    root: { kind: "local", localId: local.localId },
    projection: [],
    type: local.type,
    resourceKind: local.resourceKind,
    sourceOrigin: local.sourceOrigin,
    kind: "local",
    localId: local.localId,
  };
}

function expressionLowererReturningValue(
  valueKeyFactory: (expression: MonoExpression) => unknown,
): ProofMirExpressionLowerer {
  return {
    lowerExpression: (input) => ({
      kind: "ok",
      value: { kind: "value", value: valueKeyFactory(input.expression) as never },
    }),
    lowerExpressionAsPlace: () => ({
      kind: "error",
      diagnostics: [],
    }),
  };
}

function expressionLowererReturningPlace(
  placeKeyFactory: (expression: MonoExpression) => unknown,
): ProofMirExpressionLowerer {
  return {
    lowerExpression: (input) => ({
      kind: "ok",
      value: { kind: "place", place: placeKeyFactory(input.expression) as never },
    }),
    lowerExpressionAsPlace: (input) => ({
      kind: "ok",
      value: { kind: "place", place: placeKeyFactory(input.expression) as never },
    }),
  };
}

function statementKinds(recorded: readonly DraftRecordedProofMirStatement[] | undefined): string[] {
  return (recorded ?? []).map((entry) => entry.kind);
}

describe("ProofMirStatementLowerer", () => {
  test("let with scalar SSA target records a current value definition", () => {
    const local = scalarLocal(1, "x");
    const lowered = lowerProofMirStatementForTest({
      functionInstanceId,
      locals: [local],
      expression: expressionLowererReturningValue(() => "value:literal:1" as never),
      statement: {
        statementId: statementId(1),
        kind: {
          kind: "let",
          statement: {
            local,
            value: literalExpression(1),
          },
        },
        sourceOrigin: "source:stmt:let:1",
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(statementKinds(lowered.recordedStatements)).toContain("defineScalar");
    expect(lowered.ssaDefinitions).toHaveLength(1);
  });

  test("let to place-backed target emits store for copy value operand", () => {
    const local = placeBackedLocal(2, "handle");
    const lowered = lowerProofMirStatementForTest({
      functionInstanceId,
      locals: [local],
      expression: expressionLowererReturningValue(() => "value:copy:1" as never),
      statement: {
        statementId: statementId(2),
        kind: {
          kind: "let",
          statement: {
            local,
            value: literalExpression(2),
          },
        },
        sourceOrigin: "source:stmt:let:2",
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(statementKinds(lowered.recordedStatements)).toContain("store");
  });

  test("assignment to place-backed target emits movePlace for place operand", () => {
    const target = placeBackedLocal(3, "left");
    const source = placeBackedLocal(4, "right");
    const lowered = lowerProofMirStatementForTest({
      functionInstanceId,
      locals: [target, source],
      expression: expressionLowererReturningPlace(() => "place:right" as never),
      statement: {
        statementId: statementId(3),
        kind: {
          kind: "assignment",
          statement: {
            target: nameExpression(target),
            value: nameExpression(source),
            targetPlace: monoLocalPlace(target),
          },
        },
        sourceOrigin: "source:stmt:assign:3",
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(statementKinds(lowered.recordedStatements)).toContain("movePlace");
  });

  test("assignment with consumed place operand emits consumePlace", () => {
    const target = placeBackedLocal(5, "dest");
    const source = placeBackedLocal(6, "src");
    const lowered = lowerProofMirStatementForTest({
      functionInstanceId,
      locals: [target, source],
      expression: {
        lowerExpression: () => ({
          kind: "ok",
          value: {
            kind: "valueAndPlace",
            value: "value:src" as never,
            place: "place:src" as never,
          },
        }),
        lowerExpressionAsPlace: () => ({
          kind: "error",
          diagnostics: [],
        }),
      },
      statement: {
        statementId: statementId(4),
        kind: {
          kind: "assignment",
          statement: {
            target: nameExpression(target),
            value: literalExpression(99),
            targetPlace: monoLocalPlace(target),
          },
        },
        sourceOrigin: "source:stmt:assign:4",
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(statementKinds(lowered.recordedStatements)).toContain("consumePlace");
    expect(statementKinds(lowered.recordedStatements)).toContain("store");
  });

  test("expression statement lowers expression and discards unused result", () => {
    let expressionLowered = false;
    const lowered = lowerProofMirStatementForTest({
      functionInstanceId,
      expression: {
        lowerExpression: (_input) => {
          expressionLowered = true;
          return {
            kind: "ok",
            value: { kind: "value", value: "value:discarded" as never },
          };
        },
        lowerExpressionAsPlace: () => ({
          kind: "error",
          diagnostics: [],
        }),
      },
      statement: {
        statementId: statementId(5),
        kind: {
          kind: "expression",
          expression: literalExpression(5),
        },
        sourceOrigin: "source:stmt:expr:5",
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(expressionLowered).toBe(true);
    expect(lowered.recordedStatements).toHaveLength(0);
    expect(lowered.graphStatements).toHaveLength(0);
  });

  test("block statement lowers nested statements in order", () => {
    const local = scalarLocal(7, "counter");
    const lowered = lowerProofMirStatementForTest({
      functionInstanceId,
      locals: [local],
      expression: expressionLowererReturningValue(() => "value:zero" as never),
      statement: {
        statementId: statementId(6),
        kind: {
          kind: "block",
          block: {
            sourceOrigin: "source:block:6",
            statements: [
              {
                statementId: statementId(7),
                kind: {
                  kind: "let",
                  statement: {
                    local,
                    value: literalExpression(7),
                  },
                },
                sourceOrigin: "source:stmt:let:7",
              },
            ],
          },
        },
        sourceOrigin: "source:stmt:block:6",
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(statementKinds(lowered.recordedStatements)).toContain("defineScalar");
    expect(lowered.scopes.some((scope) => scope.role.startsWith("block:"))).toBe(true);
  });

  test("scalar let from place-backed name plus place assignment emits only one load", () => {
    const handle = placeBackedLocal(1, "handle");
    const scratch = placeBackedLocal(2, "scratch");
    const read = scalarLocal(4, "read");
    const lowered = lowerProofMirStatementsForTest({
      functionInstanceId,
      locals: [handle, scratch, read],
      statements: [
        {
          statementId: statementId(10),
          kind: {
            kind: "let",
            statement: { local: handle, value: literalExpression(10) },
          },
          sourceOrigin: "source:stmt:let:10",
        },
        {
          statementId: statementId(11),
          kind: {
            kind: "let",
            statement: { local: read, value: nameExpression(handle) },
          },
          sourceOrigin: "source:stmt:let:11",
        },
        {
          statementId: statementId(12),
          kind: {
            kind: "assignment",
            statement: {
              target: nameExpression(scratch),
              value: nameExpression(handle),
              targetPlace: monoLocalPlace(scratch),
            },
          },
          sourceOrigin: "source:stmt:assign:12",
        },
      ],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.graphStatementKinds.filter((kind) => kind === "load")).toHaveLength(1);
    expect(lowered.graphStatementKinds).toContain("movePlace");
  });

  test("createProofMirStatementLowerer rejects unsupported statement kinds", () => {
    const lowered = lowerProofMirStatementForTest({
      functionInstanceId,
      expression: expressionLowererReturningValue(() => "value:0" as never),
      lowerer: createProofMirStatementLowerer({
        expression: expressionLowererReturningValue(() => "value:0" as never),
      }),
      statement: {
        statementId: statementId(8),
        kind: { kind: "break" },
        sourceOrigin: "source:stmt:break:8",
      },
    });

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_STATEMENT"),
    );
  });
});
