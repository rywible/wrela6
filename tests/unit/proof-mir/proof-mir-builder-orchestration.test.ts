import { describe, expect, test } from "bun:test";
import type { LayoutFactProgram, LayoutFunctionAbiFact } from "../../../src/layout/layout-program";
import { layoutFunctionKeyString } from "../../../src/layout/layout-fact-builder-support";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import { monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionInstance, MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { proofMirDiagnostic, proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  buildProofMirDraftProgramForTest,
  createProofMirLoweringRegistryForTest,
  type BuildProofMirDraftProgramInput,
} from "../../../src/proof-mir/internal";
import type { ProofMirCallLoweringRecorder } from "../../../src/proof-mir/lower/call-lowerer";
import type { ResolvedLoweringRegistryResult } from "../../../src/proof-mir/lower/lowering-registry-wiring";
import type {
  ProofMirAttemptLowerer,
  ProofMirCallLowerer,
  ProofMirControlFlowLowerer,
  ProofMirExpressionLowerer,
  ProofMirIteratorLowerer,
  ProofMirStatementLowerer,
  ProofMirTakeLowerer,
  ProofMirTerminalLowerer,
  ProofMirValidatedBufferReadLowerer,
  ProofMirValidationLowerer,
} from "../../../src/proof-mir/lower/lowering-context";
import { createProofMirLoweringRegistry } from "../../../src/proof-mir/lower/lowering-context";
import { coreTypeId, functionId, targetId } from "../../../src/semantic/ids";
import {
  closedProofMirFixture,
  type ProofMirBuildInput,
} from "../../support/proof-mir/proof-mir-fixtures";
import { monoFunctionInstanceForClassifierTest } from "../../support/proof-mir/lower-harness/local-classifier-harness";

const FIXTURE_SOURCE_ORIGIN = "proof-mir-builder-orchestration.test";

function minimalLayoutFunctionAbiFact(functionInstanceId: MonoInstanceId): LayoutFunctionAbiFact {
  const neverLayout = {
    key: { kind: "core" as const, coreTypeId: coreTypeId("Never") },
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized" as const, reason: "unit" as const },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
  return {
    functionInstanceId,
    sourceFunctionId: functionId(1),
    hiddenParameters: [],
    parameters: [],
    returnValue: {
      type: neverLayout.key,
      layout: neverLayout,
      shape: { kind: "none", reason: "never", proofCarrying: false },
      sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function withExtraFunctionAbiFacts(
  layout: LayoutFactProgram,
  extraFunctionIds: readonly MonoInstanceId[],
): LayoutFactProgram {
  const mergedFacts = [...layout.functions.entries()];
  for (const functionInstanceId of extraFunctionIds) {
    if (layout.functions.has(functionInstanceId)) {
      continue;
    }
    mergedFacts.push(minimalLayoutFunctionAbiFact(functionInstanceId));
  }

  return {
    ...layout,
    functions: layoutDeterministicTable({
      entries: mergedFacts,
      keyOf: (entry) => entry.functionInstanceId,
      keyString: layoutFunctionKeyString,
    }),
  };
}

function replaceProgramFunctions(
  input: ProofMirBuildInput,
  functions: readonly MonoFunctionInstance[],
): BuildProofMirDraftProgramInput {
  const program = {
    ...input.program,
    functions: {
      entries: () => functions,
      get: (id: MonoInstanceId) => functions.find((entry) => entry.instanceId === id),
    },
  } as MonomorphizedHirProgram;

  return {
    program,
    layout: input.layout,
    target: input.target,
  };
}

function completeRegistryInput(overrides?: { readonly statement?: ProofMirStatementLowerer }): {
  readonly expression: ProofMirExpressionLowerer;
  readonly statement: ProofMirStatementLowerer;
  readonly controlFlow: ProofMirControlFlowLowerer;
  readonly call: ProofMirCallLowerer;
  readonly validation: ProofMirValidationLowerer;
  readonly attempt: ProofMirAttemptLowerer;
  readonly take: ProofMirTakeLowerer;
  readonly terminal: ProofMirTerminalLowerer;
  readonly validatedBufferRead: ProofMirValidatedBufferReadLowerer;
  readonly iterator: ProofMirIteratorLowerer;
} {
  return {
    expression: {
      lowerExpression: () => ({ kind: "ok" as const, value: { kind: "value", value: 0 as never } }),
      lowerExpressionAsPlace: () => ({
        kind: "ok" as const,
        value: { kind: "place", place: 0 as never },
      }),
    },
    statement:
      overrides?.statement ??
      ({
        lowerStatement: () => ({ kind: "ok" as const, value: undefined }),
      } satisfies ProofMirStatementLowerer),
    controlFlow: {
      lowerControlFlowStatement: () => ({ kind: "ok" as const, value: undefined }),
    },
    call: {
      lowerCall: () => ({ kind: "ok" as const, value: { kind: "value", value: 0 as never } }),
      lowerCompilerRuntimeCall: () => ({
        kind: "ok" as const,
        value: { kind: "value", value: 0 as never },
      }),
    },
    validation: {
      lowerValidation: () => ({ kind: "ok" as const, value: undefined }),
    },
    attempt: {
      lowerAttempt: () => ({ kind: "ok" as const, value: undefined }),
    },
    take: {
      lowerTake: () => ({ kind: "ok" as const, value: undefined }),
    },
    terminal: {
      lowerReturn: () => ({ kind: "ok" as const, value: undefined }),
      lowerPanic: () => ({ kind: "ok" as const, value: undefined }),
      lowerReachableMonoError: () => ({ kind: "ok" as const, value: undefined }),
    },
    validatedBufferRead: {
      lowerValidatedBufferRead: () => ({
        kind: "ok" as const,
        value: { kind: "value", value: 0 as never },
      }),
    },
    iterator: {
      lowerFor: () => ({ kind: "ok" as const, value: undefined }),
    },
  };
}

function failingStatementLowererForOrchestrationTest(
  failureAtByFunctionId: ReadonlyMap<string, number>,
): ProofMirStatementLowerer {
  const statementCountByFunction = new Map<string, number>();

  return {
    lowerStatement(input) {
      const functionKey = String(input.context.functionInstanceId);
      const nextCount = (statementCountByFunction.get(functionKey) ?? 0) + 1;
      statementCountByFunction.set(functionKey, nextCount);

      const failureAt = failureAtByFunctionId.get(functionKey);
      if (failureAt === nextCount) {
        const functionName = functionKey.startsWith("fn:") ? functionKey.slice(3) : functionKey;
        return {
          kind: "error",
          diagnostics: [
            proofMirDiagnostic({
              severity: "error",
              code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
              message: "Orchestration test statement failure.",
              functionInstanceId: input.context.functionInstanceId,
              ownerKey: `function:${functionName}`,
              rootCauseKey: "orchestration-test",
              stableDetail: `function:${functionName}:statement:${String(nextCount)}`,
            }),
          ],
        };
      }

      return { kind: "ok", value: undefined };
    },
  };
}

function registryFactoryForOrchestrationTest(
  overrides?: Parameters<typeof completeRegistryInput>[0],
): (input: {
  readonly callRecorder: ProofMirCallLoweringRecorder;
}) => ResolvedLoweringRegistryResult {
  return (input) => {
    const registryResult = createProofMirLoweringRegistry(completeRegistryInput(overrides));
    if (registryResult.kind === "error") {
      return registryResult;
    }
    return {
      kind: "ok",
      registry: registryResult.registry,
      callRecorder: input.callRecorder,
    };
  };
}

function expressionStatementBodyLines(count: number, expression = "seed"): readonly string[] {
  return Array.from({ length: count }, () => expression);
}

function twoFailingFunctionsProofMirFixture(): {
  readonly buildInput: BuildProofMirDraftProgramInput;
  readonly registryFactory: (input: {
    readonly callRecorder: ProofMirCallLoweringRecorder;
  }) => ResolvedLoweringRegistryResult;
  readonly firstFunctionId: MonoInstanceId;
  readonly secondFunctionId: MonoInstanceId;
} {
  const base = closedProofMirFixture();
  const entryFunctionInstanceId = base.program.image.entryFunctionInstanceId;
  if (entryFunctionInstanceId === undefined) {
    throw new RangeError("closed fixture is missing image entry function instance.");
  }
  const main = base.program.functions.get(entryFunctionInstanceId);
  if (main === undefined) {
    throw new RangeError("closed fixture is missing entry function metadata.");
  }

  const firstFunctionId = monoInstanceId("fn:first");
  const secondFunctionId = monoInstanceId("fn:second");
  const first = monoFunctionInstanceForClassifierTest({
    functionInstanceId: firstFunctionId,
    locals: [{ name: "seed", type: "u8" }],
    bodyLines: expressionStatementBodyLines(3),
  });
  const second = monoFunctionInstanceForClassifierTest({
    functionInstanceId: secondFunctionId,
    locals: [{ name: "seed", type: "u8" }],
    bodyLines: expressionStatementBodyLines(7),
  });

  const buildInput: BuildProofMirDraftProgramInput = {
    ...replaceProgramFunctions(base, [main, first, second]),
    layout: withExtraFunctionAbiFacts(base.layout, [firstFunctionId, secondFunctionId]),
  };

  return {
    buildInput,
    registryFactory: registryFactoryForOrchestrationTest({
      statement: failingStatementLowererForOrchestrationTest(
        new Map<string, number>([
          [String(firstFunctionId), 3],
          [String(secondFunctionId), 7],
        ]),
      ),
    }),
    firstFunctionId,
    secondFunctionId,
  };
}

describe("buildProofMirDraftProgramForTest", () => {
  test("function draft failure does not stop later function diagnostics", () => {
    const fixture = twoFailingFunctionsProofMirFixture();
    const result = buildProofMirDraftProgramForTest(fixture.buildInput, {
      registryFactory: fixture.registryFactory,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "function:first:statement:3",
      "function:second:statement:7",
    ]);
    expect(result.traceContext.functionDraft(fixture.firstFunctionId)).toBeUndefined();
    expect(result.traceContext.functionDraft(fixture.secondFunctionId)).toBeUndefined();
  });

  test("validates input compatibility before function lowering", () => {
    const input = closedProofMirFixture();
    const result = buildProofMirDraftProgramForTest({
      ...input,
      target: {
        ...input.target,
        targetId: targetId("different-target"),
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"),
    );
    for (const functionInstance of input.program.functions.entries()) {
      expect(result.traceContext.functionDraft(functionInstance.instanceId)).toBeUndefined();
    }
  });

  test("certified platform functions are skipped without abandoning later functions", () => {
    const base = closedProofMirFixture();
    const entryFunctionInstanceId = base.program.image.entryFunctionInstanceId;
    if (entryFunctionInstanceId === undefined) {
      throw new RangeError("closed fixture is missing image entry function instance.");
    }
    const main = base.program.functions.get(entryFunctionInstanceId);
    if (main === undefined) {
      throw new RangeError("closed fixture is missing entry function metadata.");
    }

    const platformFunctionId = monoInstanceId("fn:platform");
    const platform = monoFunctionInstanceForClassifierTest({
      functionInstanceId: platformFunctionId,
      bodyStatus: "certifiedPlatform",
      bodyLines: [],
    });

    const buildInput: BuildProofMirDraftProgramInput = {
      ...replaceProgramFunctions(base, [platform, main]),
      layout: withExtraFunctionAbiFacts(base.layout, [platformFunctionId]),
    };

    const result = buildProofMirDraftProgramForTest(buildInput, {
      registryFactory: registryFactoryForOrchestrationTest({
        statement: {
          lowerStatement: () => ({ kind: "ok", value: undefined }),
        },
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.buildContext.functionDraft(platformFunctionId)).toBeUndefined();
    expect(result.buildContext.functionDraft(main.instanceId)).toBeDefined();
  });

  test("wired lowering registry includes every required lowerer slot", () => {
    const registryResult = createProofMirLoweringRegistryForTest();

    expect(registryResult.kind).toBe("ok");
    if (registryResult.kind !== "ok") return;
    expect(registryResult.registry.expression).toBeDefined();
    expect(registryResult.registry.statement).toBeDefined();
    expect(registryResult.registry.controlFlow).toBeDefined();
    expect(registryResult.registry.call).toBeDefined();
    expect(registryResult.registry.validation).toBeDefined();
    expect(registryResult.registry.attempt).toBeDefined();
    expect(registryResult.registry.take).toBeDefined();
    expect(registryResult.registry.terminal).toBeDefined();
    expect(registryResult.registry.validatedBufferRead).toBeDefined();
    expect(registryResult.registry.iterator).toBeDefined();
  });

  test("successful lowering returns a usable draft program", () => {
    const input = closedProofMirFixture();
    const result = buildProofMirDraftProgramForTest(input, {
      registryFactory: registryFactoryForOrchestrationTest({
        statement: {
          lowerStatement: () => ({ kind: "ok", value: undefined }),
        },
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.programDraft).toBeDefined();
    const entryFunctionInstanceId = input.program.image.entryFunctionInstanceId;
    if (entryFunctionInstanceId === undefined) {
      throw new RangeError("closed fixture is missing image entry function instance.");
    }
    expect(result.buildContext.functionDraft(entryFunctionInstanceId)).toBeDefined();
  });
});
