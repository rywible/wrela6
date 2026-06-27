import { describe, expect, test } from "bun:test";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../src/proof-mir/domains/call-targets";
import { createProofMirFactRecorder } from "../../../src/proof-mir/domains/fact-recording";
import { createProofMirLayoutBindingIndex } from "../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../src/proof-mir/draft/draft-builder-context";
import {
  createProofMirLoweringContext,
  createProofMirLoweringRegistry,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
  reportProofMirLoweringDiagnostic,
  type ProofMirAttemptLowerer,
  type ProofMirCallLowerer,
  type ProofMirControlFlowLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirExtensionLowerer,
  type ProofMirIteratorLowerer,
  type ProofMirLocalClassifier,
  type ProofMirScopePlaceLowerer,
  type ProofMirStatementLowerer,
  type ProofMirTakeLowerer,
  type ProofMirTerminalLowerer,
  type ProofMirValidatedBufferReadLowerer,
  type ProofMirValidationLowerer,
} from "../../../src/proof-mir/lower/lowering-context";
import type { ProofMirFunctionScopePlaceLowerer } from "../../../src/proof-mir/lower/scope-place-lowerer";
import { targetId } from "../../../src/semantic/ids";

const FUNCTION_INSTANCE_ID = monoInstanceId("fn:main");

function buildContextDependenciesForTest() {
  const program = {} as MonomorphizedHirProgram;
  const layout = {} as LayoutFactProgram;
  const target = {
    targetId: targetId("x64-test"),
    features: [] as readonly string[],
    runtimeCatalog: {
      targetId: targetId("x64-test"),
      features: [] as readonly string[],
      get: () => undefined,
      entries: () => [],
    },
  };

  return {
    program,
    layout,
    target,
    buildContext: createDraftProofMirBuildContext({ program, layout, target }),
    originMap: createProofMirOriginMap(),
    layoutBindingIndex: createProofMirLayoutBindingIndex({ layout }),
    callTargetIndex: createProofMirCallTargetIndex({
      program,
      layout,
      target,
      callerFunctionInstanceId: FUNCTION_INSTANCE_ID,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: localClassifierForRegistryTest(),
    scopePlaceLowerer: scopePlaceLowererForRegistryTest(),
    functionScopePlaceLowerer: functionScopePlaceLowererForRegistryTest(),
  };
}

function functionScopePlaceLowererForRegistryTest(): ProofMirFunctionScopePlaceLowerer {
  return {
    functionInstanceId: FUNCTION_INSTANCE_ID,
    scopeTree: {
      scopeKey: () => "scope:test" as never,
      parentRole: () => undefined,
      scopeStack: () => [],
    },
    scopeEntries: [],
    effectsResources: {} as ProofMirFunctionScopePlaceLowerer["effectsResources"],
    scopeKind: () => undefined,
    allocateSyntheticOrigin: () => "origin:test" as never,
    lowerMonoPlace: () => ({ kind: "ok", value: { placeKey: "place:test" as never } as never }),
    collectLoopBoundarySet: () => ({
      places: [],
      loans: [],
      obligations: [],
      sessionMembers: [],
      privateStateGenerations: [],
    }),
  };
}

function localClassifierForRegistryTest(): ProofMirLocalClassifier {
  return {
    functionInstanceId: FUNCTION_INSTANCE_ID,
    storageForLocal: () => "scalarSsa",
    storageForParameter: () => "scalarSsa",
    collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
    placeBackedLocals: emptyPlaceBackedLocals,
  };
}

function scopePlaceLowererForRegistryTest(): ProofMirScopePlaceLowerer {
  return {
    functionInstanceId: FUNCTION_INSTANCE_ID,
    lowerMonoPlace: () => ({ kind: "ok", value: "place:test" as never }),
  };
}

function expressionLowererForRegistryTest(): ProofMirExpressionLowerer {
  return {
    lowerExpression: () => ({ kind: "ok", value: { kind: "value", value: 0 as never } }),
    lowerExpressionAsPlace: () => ({ kind: "ok", value: { kind: "place", place: 0 as never } }),
  };
}

function statementLowererForRegistryTest(): ProofMirStatementLowerer {
  return {
    lowerStatement: () => ({ kind: "ok", value: undefined }),
  };
}

function controlFlowLowererForRegistryTest(): ProofMirControlFlowLowerer {
  return {
    lowerControlFlowStatement: () => ({ kind: "ok", value: undefined }),
  };
}

function callLowererForRegistryTest(): ProofMirCallLowerer {
  return {
    lowerCall: () => ({ kind: "ok", value: { kind: "value", value: 0 as never } }),
    lowerCompilerRuntimeCall: () => ({ kind: "ok", value: { kind: "value", value: 0 as never } }),
  };
}

function validationLowererForRegistryTest(): ProofMirValidationLowerer {
  return {
    lowerValidation: () => ({ kind: "ok", value: undefined }),
  };
}

function attemptLowererForRegistryTest(): ProofMirAttemptLowerer {
  return {
    lowerAttempt: () => ({ kind: "ok", value: undefined }),
  };
}

function takeLowererForRegistryTest(): ProofMirTakeLowerer {
  return {
    lowerTake: () => ({ kind: "ok", value: undefined }),
  };
}

function terminalLowererForRegistryTest(): ProofMirTerminalLowerer {
  return {
    lowerReturn: () => ({ kind: "ok", value: undefined }),
    lowerPanic: () => ({ kind: "ok", value: undefined }),
    lowerReachableMonoError: () => ({ kind: "ok", value: undefined }),
  };
}

function validatedBufferReadLowererForRegistryTest(): ProofMirValidatedBufferReadLowerer {
  return {
    lowerValidatedBufferRead: () => ({ kind: "ok", value: { kind: "value", value: 0 as never } }),
  };
}

function iteratorLowererForRegistryTest(): ProofMirIteratorLowerer {
  return {
    lowerFor: () => ({ kind: "ok", value: undefined }),
  };
}

function extensionLowererForRegistryTest(): ProofMirExtensionLowerer {
  return {
    lowerExtension: () => ({ kind: "ok", value: undefined }),
  };
}

function completeRegistryInputForTest() {
  return {
    expression: expressionLowererForRegistryTest(),
    statement: statementLowererForRegistryTest(),
    controlFlow: controlFlowLowererForRegistryTest(),
    call: callLowererForRegistryTest(),
    validation: validationLowererForRegistryTest(),
    attempt: attemptLowererForRegistryTest(),
    take: takeLowererForRegistryTest(),
    terminal: terminalLowererForRegistryTest(),
    validatedBufferRead: validatedBufferReadLowererForRegistryTest(),
    iterator: iteratorLowererForRegistryTest(),
  };
}

describe("ProofMirLoweringContext", () => {
  test("createProofMirLoweringContext exposes program layout target and domain handles", () => {
    const dependencies = buildContextDependenciesForTest();
    const context = createProofMirLoweringContext({
      ...dependencies,
      functionInstanceId: FUNCTION_INSTANCE_ID,
    });

    expect(context.program).toBe(dependencies.program);
    expect(context.layout).toBe(dependencies.layout);
    expect(context.target).toBe(dependencies.target);
    expect(context.buildContext).toBe(dependencies.buildContext);
    expect(context.originMap).toBe(dependencies.originMap);
    expect(context.layoutBindingIndex).toBe(dependencies.layoutBindingIndex);
    expect(context.callTargetIndex).toBe(dependencies.callTargetIndex);
    expect(context.factRecorder).toBe(dependencies.factRecorder);
    expect(context.localClassifier).toBe(dependencies.localClassifier);
    expect(context.scopePlaceLowerer).toBe(dependencies.scopePlaceLowerer);
    expect(context.functionInstanceId).toBe(FUNCTION_INSTANCE_ID);
    expect(context.graph.rootScopeKey()).toBeDefined();
    expect(context.ssa).toBeDefined();
    expect(context.effects).toBeDefined();
  });

  test("reportProofMirLoweringDiagnostic appends to build context diagnostics", () => {
    const dependencies = buildContextDependenciesForTest();
    const context = createProofMirLoweringContext({
      ...dependencies,
      functionInstanceId: FUNCTION_INSTANCE_ID,
    });

    reportProofMirLoweringDiagnostic(context, {
      severity: "error",
      code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
      message: "Reachable mono statement cannot be lowered.",
      ownerKey: "function:fn:main",
      rootCauseKey: "mono-statement",
      stableDetail: "statement:17",
      sourceOrigin: "main.wr:3:9",
      functionInstanceId: FUNCTION_INSTANCE_ID,
    });

    expect(context.buildContext.diagnostics()).toHaveLength(1);
    expect(context.buildContext.diagnostics()[0]?.code).toBe(
      proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_STATEMENT"),
    );
  });
});

describe("createProofMirLoweringRegistry", () => {
  test("registry rejects missing expression lowerer before lowering", () => {
    const result = createProofMirLoweringRegistry({
      expression: undefined,
      statement: statementLowererForRegistryTest(),
      controlFlow: controlFlowLowererForRegistryTest(),
      call: callLowererForRegistryTest(),
      validation: validationLowererForRegistryTest(),
      attempt: attemptLowererForRegistryTest(),
      take: takeLowererForRegistryTest(),
      terminal: terminalLowererForRegistryTest(),
      validatedBufferRead: validatedBufferReadLowererForRegistryTest(),
      iterator: iteratorLowererForRegistryTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION"),
    );
  });

  test("registry rejects missing statement lowerer before lowering", () => {
    const result = createProofMirLoweringRegistry({
      ...completeRegistryInputForTest(),
      statement: undefined,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_STATEMENT"),
    );
  });

  test("registry accepts complete required lowerers and optional extension slot", () => {
    const result = createProofMirLoweringRegistry({
      ...completeRegistryInputForTest(),
      extension: extensionLowererForRegistryTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.registry.expression).toBeDefined();
    expect(result.registry.statement).toBeDefined();
    expect(result.registry.controlFlow).toBeDefined();
    expect(result.registry.call).toBeDefined();
    expect(result.registry.validation).toBeDefined();
    expect(result.registry.attempt).toBeDefined();
    expect(result.registry.take).toBeDefined();
    expect(result.registry.terminal).toBeDefined();
    expect(result.registry.validatedBufferRead).toBeDefined();
    expect(result.registry.iterator).toBeDefined();
    expect(result.registry.extension).toBeDefined();
  });

  test("registry accepts missing extension callback without rejecting registry creation", () => {
    const result = createProofMirLoweringRegistry(completeRegistryInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.registry.extension).toBeUndefined();
  });
});
