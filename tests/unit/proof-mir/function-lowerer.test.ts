import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionInstance } from "../../../src/mono/mono-hir";
import { proofMirDiagnostic, proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  monoFunctionInstanceForClassifierTest,
  type LocalClassifierTestBinding,
} from "../../support/proof-mir/lower-harness/local-classifier-harness";
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
import {
  lowerProofMirFunctionForTest,
  proofMirFunctionLowererFixture,
  type ProofMirFunctionLowererFixture,
} from "../../support/proof-mir/function-lowerer-fixtures";
import { createProofMirExtensionLowerer } from "../../../src/proof-mir/lower/extension-lowerer";
import { hirExpressionId, hirStatementId } from "../../../src/hir/ids";
import { instantiatedHirId } from "../../../src/mono/ids";

function completeRegistryInput(overrides?: {
  readonly statement?: ProofMirStatementLowerer;
  readonly controlFlow?: ProofMirControlFlowLowerer;
  readonly terminal?: ProofMirTerminalLowerer;
}) {
  return {
    expression: {
      lowerExpression: () => ({ kind: "ok" as const, value: { kind: "value", value: 0 as never } }),
      lowerExpressionAsPlace: () => ({
        kind: "ok" as const,
        value: { kind: "place", place: 0 as never },
      }),
    } satisfies ProofMirExpressionLowerer,
    statement:
      overrides?.statement ??
      ({
        lowerStatement: () => ({ kind: "ok" as const, value: undefined }),
      } satisfies ProofMirStatementLowerer),
    controlFlow:
      overrides?.controlFlow ??
      ({
        lowerControlFlowStatement: () => ({ kind: "ok" as const, value: undefined }),
      } satisfies ProofMirControlFlowLowerer),
    call: {
      lowerCall: () => ({ kind: "ok" as const, value: { kind: "value", value: 0 as never } }),
      lowerCompilerRuntimeCall: () => ({
        kind: "ok" as const,
        value: { kind: "value", value: 0 as never },
      }),
    } satisfies ProofMirCallLowerer,
    validation: {
      lowerValidation: () => ({ kind: "ok" as const, value: undefined }),
    } satisfies ProofMirValidationLowerer,
    attempt: {
      lowerAttempt: () => ({ kind: "ok" as const, value: undefined }),
    } satisfies ProofMirAttemptLowerer,
    take: {
      lowerTake: () => ({ kind: "ok" as const, value: undefined }),
    } satisfies ProofMirTakeLowerer,
    terminal:
      overrides?.terminal ??
      ({
        lowerReturn: () => ({ kind: "ok" as const, value: undefined }),
        lowerPanic: () => ({ kind: "ok" as const, value: undefined }),
        lowerReachableMonoError: () => ({ kind: "ok" as const, value: undefined }),
      } satisfies ProofMirTerminalLowerer),
    validatedBufferRead: {
      lowerValidatedBufferRead: () => ({
        kind: "ok" as const,
        value: { kind: "value", value: 0 as never },
      }),
    } satisfies ProofMirValidatedBufferReadLowerer,
    iterator: {
      lowerFor: () => ({ kind: "ok" as const, value: undefined }),
    } satisfies ProofMirIteratorLowerer,
    extension: createProofMirExtensionLowerer(),
  };
}

function fixtureForFunctionInstance(
  functionInstance: MonoFunctionInstance,
  registryOverrides?: Parameters<typeof completeRegistryInput>[0],
): ProofMirFunctionLowererFixture {
  return proofMirFunctionLowererFixture({
    source: [],
    programFunctions: [functionInstance],
    registryInput: completeRegistryInput(registryOverrides),
  });
}

function lowerFunctionInstance(
  fixture: ProofMirFunctionLowererFixture,
  functionInstance: MonoFunctionInstance,
) {
  return lowerProofMirFunctionForTest(fixture, functionInstance.instanceId, {
    functionInstance,
  });
}

function functionInstanceForTest(input: {
  readonly functionInstanceId?: ReturnType<typeof monoInstanceId>;
  readonly bodyStatus?: MonoFunctionInstance["bodyStatus"];
  readonly parameters?: readonly LocalClassifierTestBinding[];
  readonly bodyLines?: readonly string[];
}): MonoFunctionInstance {
  return monoFunctionInstanceForClassifierTest({
    functionInstanceId: input.functionInstanceId,
    bodyStatus: input.bodyStatus,
    parameters: input.parameters,
    bodyLines: input.bodyLines,
  });
}

describe("ProofMirFunctionLowerer", () => {
  test("copy scalar parameters become entry block parameters", () => {
    const functionInstance = functionInstanceForTest({
      functionInstanceId: monoInstanceId("fn:add_one"),
      parameters: [{ name: "value", type: "u8" }],
      bodyLines: ["return value"],
    });
    const fixture = fixtureForFunctionInstance(functionInstance);
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(
      lowered.function.entry.parameters.map((parameter) => parameter.parameterKind.kind),
    ).toEqual(["copyScalar"]);
  });

  test("source-bodied functions receive root scope and entry block", () => {
    const functionInstance = functionInstanceForTest({
      functionInstanceId: monoInstanceId("fn:source"),
      parameters: [{ name: "value", type: "u8" }],
      bodyLines: ["return value"],
    });
    const fixture = fixtureForFunctionInstance(functionInstance);
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.function.rootScope.role).toBe("function");
    expect(lowered.function.entry.role).toBe("entry");
    expect(fixture.buildContext.functionDraft(functionInstance.instanceId)).toBeDefined();
  });

  test("certified platform functions do not receive Proof MIR bodies", () => {
    const functionInstance = functionInstanceForTest({
      functionInstanceId: monoInstanceId("fn:platform"),
      bodyStatus: "certifiedPlatform",
      parameters: [],
      bodyLines: [],
    });
    const fixture = fixtureForFunctionInstance(functionInstance);
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("skipped");
    if (lowered.kind !== "skipped") return;
    expect(lowered.reason).toBe("certifiedPlatform");
    expect(fixture.buildContext.functionDraft(functionInstance.instanceId)).toBeUndefined();
  });

  test("certified platform functions with source body metadata are rejected", () => {
    const functionInstance = monoFunctionInstanceForClassifierTest({
      functionInstanceId: monoInstanceId("fn:platform-with-body"),
      bodyStatus: "certifiedPlatform",
      monoBody: {
        statements: [],
        sourceOrigin: "source:platform-body",
      },
    });
    const fixture = fixtureForFunctionInstance(functionInstance);
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_CERTIFIED_PLATFORM_HAS_BODY"),
    );
  });

  test("bodylessRecovery functions produce missing function body", () => {
    const functionInstance = functionInstanceForTest({
      functionInstanceId: monoInstanceId("fn:recovery"),
      bodyStatus: "bodylessRecovery",
      parameters: [],
      bodyLines: [],
    });
    const fixture = fixtureForFunctionInstance(functionInstance);
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY"),
    );
  });

  test("place-backed parameters become place roots without entry scalar parameters", () => {
    const functionInstance = functionInstanceForTest({
      functionInstanceId: monoInstanceId("fn:packet"),
      parameters: [{ name: "packet", type: "&Packet" }],
      bodyLines: ["let view = borrow packet.payload", "return view.len"],
    });
    const fixture = fixtureForFunctionInstance(functionInstance);
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.function.entry.parameters).toHaveLength(0);
    expect(lowered.function.placeRoots.some((place) => place.root.kind === "parameter")).toBe(true);
  });

  test("dispatches body statements through registry callbacks", () => {
    let returnDispatched = false;
    const functionInstance = functionInstanceForTest({
      functionInstanceId: monoInstanceId("fn:dispatch"),
      parameters: [{ name: "value", type: "u8" }],
      bodyLines: ["return value"],
    });
    const fixture = fixtureForFunctionInstance(functionInstance, {
      terminal: {
        lowerReturn: () => {
          returnDispatched = true;
          return { kind: "ok", value: undefined };
        },
        lowerPanic: () => ({ kind: "ok", value: undefined }),
        lowerReachableMonoError: () => ({ kind: "ok", value: undefined }),
      },
    });
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(returnDispatched).toBe(true);
  });

  test("failed body statement abandons the function draft", () => {
    const functionInstance = functionInstanceForTest({
      functionInstanceId: monoInstanceId("fn:fail"),
      parameters: [{ name: "value", type: "u8" }],
      bodyLines: ["return value"],
    });
    const fixture = fixtureForFunctionInstance(functionInstance, {
      terminal: {
        lowerReturn: () => ({
          kind: "error",
          diagnostics: [
            proofMirDiagnostic({
              severity: "error",
              code: proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_STATEMENT"),
              message: "statement lowering failed",
              ownerKey: "test",
              rootCauseKey: "test",
              stableDetail: "test",
            }),
          ],
        }),
        lowerPanic: () => ({ kind: "ok", value: undefined }),
        lowerReachableMonoError: () => ({ kind: "ok", value: undefined }),
      },
    });
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(fixture.buildContext.functionDraft(functionInstance.instanceId)).toBeUndefined();
    expect(fixture.buildContext.isFunctionFailed(functionInstance.instanceId)).toBe(true);
  });

  test("yield is rejected when coroutine semantics are not enabled", () => {
    const functionInstanceId = monoInstanceId("fn:yield");
    const functionInstance = monoFunctionInstanceForClassifierTest({
      functionInstanceId,
      parameters: [],
      bodyLines: [],
      monoBody: {
        statements: [
          {
            statementId: instantiatedHirId(functionInstanceId, hirStatementId(1)),
            kind: {
              kind: "yield",
              expression: {
                expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(1)),
                kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
                type: { kind: "core", coreTypeId: "u8" } as never,
                resourceKind: "Copy",
                sourceOrigin: "source:yield:value",
              },
            },
            sourceOrigin: "source:yield",
          },
        ],
        sourceOrigin: "source:function:body",
      },
    });
    const fixture = fixtureForFunctionInstance(functionInstance);
    const lowered = lowerFunctionInstance(fixture, functionInstance);

    expect(lowered.kind).toBe("error");
    if (lowered.kind !== "error") return;
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
    );
  });
});
