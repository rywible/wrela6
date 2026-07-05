import { describe, expect, test } from "bun:test";
import { hirExpressionId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import type {
  MonoCallExpression,
  MonoCheckedType,
  MonoExpression,
  MonomorphizedHirProgram,
} from "../../../src/mono/mono-hir";
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
  type ProofMirBlockTrackingRefs,
  type ProofMirCallLowerer,
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
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { targetId } from "../../../src/semantic/ids";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog-types";

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

function boolMonoType(): MonoCheckedType {
  return { kind: "core", coreTypeId: "bool" } as MonoCheckedType;
}

function boolLiteralExpression(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly expressionIndex: number;
  readonly value: boolean;
}): MonoExpression {
  return {
    expressionId: instantiatedHirId(
      input.functionInstanceId,
      hirExpressionId(input.expressionIndex),
    ),
    kind: { kind: "literal", literal: { kind: "bool", value: input.value } },
    type: boolMonoType(),
    resourceKind: "Copy",
    sourceOrigin: `source:expr:bool:${input.value}`,
  };
}

function sideEffectCallExpression(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly expressionIndex: number;
}): MonoExpression {
  const callee: MonoExpression = {
    expressionId: instantiatedHirId(
      input.functionInstanceId,
      hirExpressionId(input.expressionIndex + 1),
    ),
    kind: { kind: "name", name: "side_effect" },
    type: boolMonoType(),
    resourceKind: "Copy",
    sourceOrigin: "source:expr:callee",
  };
  const call: MonoCallExpression = {
    callee,
    ownerTypeArguments: [],
    ownerTypeArgumentSource: "none",
    arguments: [],
    typeArguments: [],
    sourceOrigin: "source:expr:side-effect-call",
  };
  return {
    expressionId: instantiatedHirId(
      input.functionInstanceId,
      hirExpressionId(input.expressionIndex),
    ),
    kind: { kind: "call", call },
    type: boolMonoType(),
    resourceKind: "Copy",
    sourceOrigin: "source:expr:side-effect-call",
  };
}

function logicalExpression(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly operator: "and" | "or";
  readonly leftValue: boolean;
}): MonoExpression {
  return {
    expressionId: instantiatedHirId(input.functionInstanceId, hirExpressionId(1)),
    kind: {
      kind: "binary",
      operator: input.operator,
      left: boolLiteralExpression({
        functionInstanceId: input.functionInstanceId,
        expressionIndex: 2,
        value: input.leftValue,
      }),
      right: sideEffectCallExpression({
        functionInstanceId: input.functionInstanceId,
        expressionIndex: 3,
      }),
    },
    type: boolMonoType(),
    resourceKind: "Copy",
    sourceOrigin: `source:expr:${input.operator}`,
  };
}

function emptyProgramForShortCircuitTest(): MonomorphizedHirProgram {
  return {
    functions: {
      entries: () => [],
      get: () => undefined,
    },
    proofMetadata: {
      validations: { entries: () => [], get: () => undefined },
      attempts: { entries: () => [], get: () => undefined },
      brands: { entries: () => [], get: () => undefined },
      obligations: { entries: () => [], get: () => undefined },
      sessions: { entries: () => [], get: () => undefined },
      privateStateTransitions: { entries: () => [], get: () => undefined },
      callSiteRequirements: { entries: () => [], get: () => undefined },
      platformContractEdges: { entries: () => [], get: () => undefined },
      resourcePlaces: { entries: () => [], get: () => undefined },
    },
  } as unknown as MonomorphizedHirProgram;
}

function shortCircuitTargetForTest(): {
  readonly targetId: ReturnType<typeof targetId>;
  readonly features: readonly string[];
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
} {
  const id = targetId("x64-test");
  return {
    targetId: id,
    features: [],
    runtimeCatalog: {
      targetId: id,
      features: [],
      entries: () => [],
      get: () => undefined,
    },
  };
}

function lowerLogicalExpressionForShortCircuitTest(input: {
  readonly operator: "and" | "or";
  readonly leftValue: boolean;
}) {
  const functionInstanceId = monoInstanceId(
    `fn:short-circuit-${input.operator}-${input.leftValue}`,
  );
  const program = emptyProgramForShortCircuitTest();
  const layout = {} as LayoutFactProgram;
  const target = shortCircuitTargetForTest();
  const originMap = createProofMirOriginMap();
  const effects = createProofMirEffectsResources({ functionInstanceId });
  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId,
    body: { statements: [], sourceOrigin: "source:test" },
    originMap,
    effectsResources: effects,
  });
  if (scopePlaceLowererResult.kind === "error") {
    throw new Error("short-circuit test scope lowerer failed");
  }
  const graph = createDraftGraphBuilder({ functionInstanceId });
  const origin = graph.allocateSyntheticOrigin("entry");
  const entryBlock = graph.createBlock({
    role: "entry",
    scope: graph.rootScopeKey(),
    origin,
  });
  const ssa = createProofMirGraphSsa({
    functionInstanceId,
    ownerKey: `function:${String(functionInstanceId)}`,
  });
  ssa.registerBlock(entryBlock, { sealed: true });
  const blockTracking: ProofMirBlockTrackingRefs = {
    currentBlockRef: { blockKey: entryBlock },
    continuationBlockRef: {},
  };
  const context = createProofMirLoweringContext({
    program,
    layout,
    target,
    buildContext: createDraftProofMirBuildContext({ program, layout, target }),
    functionInstanceId,
    originMap,
    layoutBindingIndex: createProofMirLayoutBindingIndex({ layout }),
    callTargetIndex: createProofMirCallTargetIndex({
      program,
      layout,
      target,
      callerFunctionInstanceId: functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: {
      functionInstanceId,
      storageForLocal: () => undefined,
      storageForParameter: () => undefined,
      collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
      placeBackedLocals: emptyPlaceBackedLocals,
    },
    scopePlaceLowerer: {
      functionInstanceId,
      lowerMonoPlace(placeInput) {
        const lowered = scopePlaceLowererResult.value.lowerMonoPlace({
          monoPlace: placeInput.monoPlace,
          originKey: placeInput.originKey,
        });
        if (lowered.kind !== "ok") {
          return lowered;
        }
        return { kind: "ok", value: lowered.value.placeKey };
      },
    },
    functionScopePlaceLowerer: scopePlaceLowererResult.value,
    graph,
    ssa,
    effects,
    blockTracking,
  });
  const callBlocks: string[] = [];
  const callLowerer: ProofMirCallLowerer = {
    lowerCall(callInput) {
      callBlocks.push(String(callInput.blockKey));
      const callOrigin = callInput.context.graph.allocateSyntheticOrigin("test:call-result");
      return {
        kind: "ok",
        value: {
          kind: "value",
          value: callInput.context.graph.createValue({
            role: `call-result:${String(callInput.monoExpressionId)}`,
            origin: callOrigin,
            type: callInput.resultType,
            resourceKind: callInput.resultResourceKind,
          }),
        },
      };
    },
    lowerCompilerRuntimeCall(callInput) {
      const callOrigin = callInput.context.graph.allocateSyntheticOrigin(
        "test:runtime-call-result",
      );
      return {
        kind: "ok",
        value: {
          kind: "value",
          value: callInput.context.graph.createValue({
            role: `runtime-call-result:${String(callInput.monoExpressionId)}`,
            origin: callOrigin,
            type: callInput.resultType,
            resourceKind: callInput.resultResourceKind,
          }),
        },
      };
    },
  };
  const expressionLowerer = createProofMirExpressionLowerer({
    call: callLowerer,
    currentBlockRef: blockTracking.currentBlockRef,
  });
  const expression = logicalExpression({
    functionInstanceId,
    operator: input.operator,
    leftValue: input.leftValue,
  });
  const lowered = expressionLowerer.lowerExpression({
    context,
    expression,
    blockKey: entryBlock,
  });
  return {
    lowered,
    graph,
    entryBlock,
    callBlocks,
    blockTracking,
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
    const binaryStatement = lowered.statements.find(
      (statement) => statement.kind.kind === "binary",
    );
    if (binaryStatement?.kind.kind !== "binary") throw new Error("expected binary statement");
    const binaryResultKey = binaryStatement.kind.resultKey;
    expect(lowered.values.find((value) => value.key === binaryResultKey)).toMatchObject({
      type: { kind: "core", coreTypeId: "u8" },
      resourceKind: "Copy",
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
    const unaryStatement = lowered.statements.find((statement) => statement.kind.kind === "unary");
    if (unaryStatement?.kind.kind !== "unary") throw new Error("expected unary statement");
    const unaryResultKey = unaryStatement.kind.resultKey;
    expect(lowered.values.find((value) => value.key === unaryResultKey)).toMatchObject({
      type: { kind: "core", coreTypeId: "bool" },
      resourceKind: "Copy",
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

  test.each([
    { operator: "and" as const, leftValue: false, rightBranch: "whenTrue" as const },
    { operator: "or" as const, leftValue: true, rightBranch: "whenFalse" as const },
  ])(
    "$operator lowers through a short-circuit branch and join parameter",
    ({ operator, leftValue, rightBranch }) => {
      const lowered = lowerLogicalExpressionForShortCircuitTest({ operator, leftValue });

      expect(lowered.lowered.kind).toBe("ok");
      if (lowered.lowered.kind !== "ok") return;
      expect(lowered.lowered.value.kind).toBe("value");
      if (lowered.lowered.value.kind !== "value") return;

      const snapshot = lowered.graph.exportGraphSnapshot();
      const entry = snapshot.blocks.find((block) => block.key === lowered.entryBlock);
      expect(entry?.terminator?.kind).toBe("branch");
      if (entry?.terminator?.kind !== "branch") return;

      const rightBlockKey =
        rightBranch === "whenTrue"
          ? entry.terminator.whenTrue.block
          : entry.terminator.whenFalse.block;
      const joinBlockKey =
        rightBranch === "whenTrue"
          ? entry.terminator.whenFalse.block
          : entry.terminator.whenTrue.block;
      expect(lowered.callBlocks).toEqual([String(rightBlockKey)]);

      const rightBlock = snapshot.blocks.find((block) => block.key === rightBlockKey);
      expect(rightBlock?.terminator?.kind).toBe("goto");
      if (rightBlock?.terminator?.kind !== "goto") return;
      expect(rightBlock.terminator.target.block).toBe(joinBlockKey);

      const joinBlock = snapshot.blocks.find((block) => block.key === joinBlockKey);
      expect(joinBlock?.parameters?.map((parameter) => parameter.valueKey)).toEqual([
        lowered.lowered.value.value,
      ]);
      expect(lowered.blockTracking.currentBlockRef.blockKey).toBe(joinBlockKey);
    },
  );

  test("object expressions allocate a place for proof-relevant values", () => {
    const lowered = lowerProofMirExpressionForTest("{ handle: source }", {
      locals: [{ name: "source", type: "Handle", storage: "placeBacked", resourceKind: "Affine" }],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(["place", "valueAndPlace"]).toContain(lowered.operand.kind);
    expect(lowered.statements.some((statement) => statement.kind.kind === "constructObject")).toBe(
      true,
    );
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
    expect(
      lowered.statements.find((statement) => statement.kind.kind === "constructObject"),
    ).toMatchObject({
      kind: {
        kind: "constructObject",
        fields: [
          { name: "tag", valueKey: expect.any(String) },
          { name: "len", valueKey: expect.any(String) },
        ],
      },
    });
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
