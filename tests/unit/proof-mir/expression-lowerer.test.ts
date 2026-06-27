import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../src/proof-mir/draft/draft-builder-context";
import { createDraftGraphBuilder } from "../../../src/proof-mir/draft/draft-graph-builder";
import { createProofMirExpressionLowerer } from "../../../src/proof-mir/lower/expression-lowerer";
import {
  lowerProofMirExpressionForTest,
  type ExpressionLowererTestLocal,
} from "../../support/proof-mir/lower-harness/expression-lowerer-harness";
import {
  createProofMirLoweringContext,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
  type ProofMirScopePlaceLowerer,
} from "../../../src/proof-mir/lower/lowering-context";
import {
  createProofMirScopePlaceLowerer,
  type ProofMirFunctionScopePlaceLowerer as ScopePlaceLowererImpl,
} from "../../../src/proof-mir/lower/scope-place-lowerer";
import { createProofMirValidatedBufferReadLowerer } from "../../../src/proof-mir/lower/validated-buffer-read-lowerer";
import {
  validatedBufferReadLowererFixture,
  validatedBufferTagMemberExpressionForFixture,
} from "./validated-buffer-read-lowerer.test";

function scalarLocal(name: string): ExpressionLowererTestLocal {
  return { name, type: "u8", storage: "scalarSsa" };
}

function placeBackedLocal(name: string, type = "Packet"): ExpressionLowererTestLocal {
  return { name, type, storage: "placeBacked" };
}

function scopePlaceLowererAdapter(input: {
  readonly scopePlaceLowerer: ScopePlaceLowererImpl;
}): ProofMirScopePlaceLowerer {
  return {
    functionInstanceId: input.scopePlaceLowerer.functionInstanceId,
    lowerMonoPlace(placeInput) {
      const lowered = input.scopePlaceLowerer.lowerMonoPlace({
        monoPlace: placeInput.monoPlace,
        originKey: placeInput.originKey,
      });
      if (lowered.kind !== "ok") {
        return lowered;
      }
      return { kind: "ok", value: lowered.value.placeKey };
    },
  };
}

describe("ProofMirExpressionLowerer", () => {
  test("comparison expression records closed operator and result value", () => {
    const lowered = lowerProofMirExpressionForTest("value >= 2", {
      locals: [scalarLocal("value")],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toContain("comparison");
    expect(
      lowered.statements.find((statement) => statement.kind.kind === "comparison"),
    ).toMatchObject({
      kind: { kind: "comparison", operator: "ge" },
    });
    expect(lowered.operand.kind).toBe("value");
  });

  test("literal allocates fresh SSA value and literal statement", () => {
    const lowered = lowerProofMirExpressionForTest("42");

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual(["literal"]);
    expect(lowered.statements[0]?.kind).toMatchObject({
      kind: "literal",
      literal: { kind: "integer", text: "42" },
    });
    expect(lowered.operand.kind).toBe("value");
  });

  test("scalar SSA names read current SSA values without load", () => {
    const lowered = lowerProofMirExpressionForTest("value", {
      locals: [scalarLocal("value")],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual([]);
    expect(lowered.operand.kind).toBe("value");
  });

  test("place-backed names emit load when a scalar value is required", () => {
    const lowered = lowerProofMirExpressionForTest("packet", {
      locals: [placeBackedLocal("packet")],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual(["load"]);
    expect(lowered.operand.kind).toBe("value");
  });

  test("place-backed names return place operands without load", () => {
    const lowered = lowerProofMirExpressionForTest("packet", {
      locals: [placeBackedLocal("packet")],
      asPlace: true,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual([]);
    expect(lowered.operand.kind).toBe("place");
  });

  test("member expressions preserve field-sensitive places", () => {
    const lowered = lowerProofMirExpressionForTest("packet.payload", {
      locals: [placeBackedLocal("packet")],
      asPlace: true,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual([]);
    expect(lowered.operand.kind).toBe("place");
  });

  test("member expressions emit load only when a scalar value is required", () => {
    const lowered = lowerProofMirExpressionForTest("packet.payload", {
      locals: [placeBackedLocal("packet")],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual(["load"]);
    expect(lowered.operand.kind).toBe("value");
  });

  test("binary operators map to closed Proof MIR operator enums", () => {
    const lowered = lowerProofMirExpressionForTest("left + right", {
      locals: [scalarLocal("left"), scalarLocal("right")],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.find((statement) => statement.kind.kind === "binary")).toMatchObject({
      kind: { kind: "binary", operator: "add" },
    });
  });

  test("unary operators map to closed Proof MIR operator enums", () => {
    const lowered = lowerProofMirExpressionForTest("!flag", {
      locals: [{ name: "flag", type: "bool", storage: "scalarSsa" }],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.statements.find((statement) => statement.kind.kind === "unary")).toMatchObject({
      kind: { kind: "unary", operator: "logicalNot" },
    });
  });

  test("unknown source operator spelling returns invalid statement operator", () => {
    const lowered = lowerProofMirExpressionForTest("value ** 2", {
      locals: [scalarLocal("value")],
    });

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_STATEMENT_OPERATOR"),
    );
  });

  test("object expressions allocate a place for proof-relevant values", () => {
    const lowered = lowerProofMirExpressionForTest("{ handle: source }", {
      locals: [{ name: "source", type: "Handle", storage: "placeBacked", resourceKind: "Affine" }],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(["place", "valueAndPlace"]).toContain(lowered.operand.kind);
    expect(lowered.statements.some((statement) => statement.kind.kind === "store")).toBe(true);
  });

  test("pure copy scalar object fragments can remain value operands", () => {
    const lowered = lowerProofMirExpressionForTest("{ tag: one, len: two }", {
      locals: [scalarLocal("one"), scalarLocal("two")],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.operand.kind).toBe("value");
    expect(lowered.statements.map((statement) => statement.kind.kind)).not.toContain("store");
  });

  test("borrow unary emits borrowPlace and returns a place operand", () => {
    const lowered = lowerProofMirExpressionForTest("borrow packet", {
      locals: [placeBackedLocal("packet")],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.operand.kind).toBe("place");
    expect(lowered.statements.map((statement) => statement.kind.kind)).toEqual(["borrowPlace"]);
    expect(lowered.statements[0]?.kind).toMatchObject({
      kind: "borrowPlace",
      mode: "shared",
      placeKey: expect.any(String),
      loanKey: expect.any(String),
    });
  });

  test("validated-buffer member reads delegate to validated-buffer read lowerer", () => {
    const fixture = validatedBufferReadLowererFixture();
    const functionInstanceId = fixture.functionInstanceId;
    const expression = validatedBufferTagMemberExpressionForFixture(fixture);
    const body = { statements: [], sourceOrigin: "source:function" };
    const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
      functionInstanceId,
      body,
      originMap: createProofMirOriginMap(),
      layoutBindingIndex: createProofMirLayoutBindingIndex({
        layout: fixture.layout,
      }),
    });
    expect(scopePlaceLowererResult.kind).toBe("ok");
    if (scopePlaceLowererResult.kind !== "ok") return;

    const graph = createDraftGraphBuilder({ functionInstanceId });
    const origin = graph.allocateSyntheticOrigin("entry");
    const entryBlock = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });
    const validatedBufferRead = createProofMirValidatedBufferReadLowerer();
    const expressionLowerer = createProofMirExpressionLowerer({ validatedBufferRead });
    graph.createPlace({
      monoPlaceCanonicalKey:
        expression.kind.kind === "member" && expression.kind.memberPlace !== undefined
          ? expression.kind.memberPlace.canonicalKey.slice(
              0,
              expression.kind.memberPlace.canonicalKey.indexOf("/field:"),
            )
          : "missing",
      origin,
    });

    const loweringContext = createProofMirLoweringContext({
      program: fixture.program,
      layout: fixture.layout,
      target: fixture.target,
      buildContext: createDraftProofMirBuildContext({
        program: fixture.program,
        layout: fixture.layout,
        target: {
          targetId: fixture.target.targetId,
          features: fixture.target.features,
          runtimeCatalog: fixture.target.runtimeCatalog,
        },
      }),
      functionInstanceId,
      originMap: createProofMirOriginMap(),
      layoutBindingIndex: createProofMirLayoutBindingIndex({
        layout: fixture.layout,
      }),
      callTargetIndex: createProofMirCallTargetIndex({
        program: fixture.program,
        layout: fixture.layout,
        target: fixture.target,
        callerFunctionInstanceId: functionInstanceId,
      }),
      factRecorder: createProofMirFactRecorder(),
      localClassifier: {
        functionInstanceId,
        storageForLocal: () => "placeBacked",
        storageForParameter: () => undefined,
        collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
        placeBackedLocals: emptyPlaceBackedLocals,
      },
      scopePlaceLowerer: scopePlaceLowererAdapter({
        scopePlaceLowerer: scopePlaceLowererResult.value,
      }),
      functionScopePlaceLowerer: scopePlaceLowererResult.value,
      graph,
      ssa: createProofMirGraphSsa({
        functionInstanceId,
        ownerKey: `function:${String(functionInstanceId)}`,
      }),
      effects: createProofMirEffectsResources({ functionInstanceId }),
    });

    const lowered = expressionLowerer.lowerExpression({
      context: loweringContext,
      expression,
      blockKey: entryBlock,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const statements = [...expressionLowerer.statements(), ...validatedBufferRead.statements()];
    expect(statements.some((statement) => statement.kind.kind === "readValidatedBufferField")).toBe(
      true,
    );
    expect(statements.some((statement) => statement.kind.kind === "load")).toBe(false);
    expect(lowered.value.kind).toBe("value");
  });
});
