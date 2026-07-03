import { describe, expect, test, beforeEach } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirCallId, proofMirOriginId } from "../../../src/proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../../src/proof-mir/model/calls";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  buildCheckedFunctionSummary,
  checkSourceCallTransfer,
  resetCheckedFunctionSummaryCertificateIdsForTest,
  resetCheckedSummaryInstantiationCertificateIdsForTest,
  sourceCallIdForTest,
  type CheckedSourceCallTransferInput,
} from "../../../src/proof-check/domains/source-calls";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { proofCheckBinderSubstitutionForTest } from "../../../src/proof-check/model/fact-environment";
import { normalizeProofCheckTerm } from "../../../src/proof-check/model/fact-language";
import {
  calleePrecedesCallerInOrder,
  runProofCheckWholeImageDriver,
} from "../../../src/proof-check/kernel/whole-image-driver";
import {
  createProofCheckFunctionRegistryArtifacts,
  finalizeProofCheckFunctionRegistryArtifacts,
} from "../../../src/proof-check/kernel/registry/registry-effects";
import { emptyProofCheckOperationTransferRegistryForTest } from "./operation-dispatch.test";
import {
  activeFactForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";
import { checkedFunctionForTest, summaryFactForTest } from "./source-call-summaries.test";

const callerFunctionInstanceId = monoInstanceId("caller");
const calleeFunctionInstanceId = monoInstanceId("callee");

function sourceFunctionCallForTest(
  overrides: Partial<ProofMirCallGraphEdge> = {},
): ProofMirCallGraphEdge {
  return {
    callId: sourceCallIdForTest(callerFunctionInstanceId, proofMirCallId(1)),
    target: {
      kind: "sourceFunction",
      functionInstanceId: calleeFunctionInstanceId,
      abi: {
        kind: "functionAbi",
        functionInstanceId: calleeFunctionInstanceId,
      },
    },
    origin: proofMirOriginId(1),
    ...overrides,
  };
}

function calleeSummaryForTest(input: {
  readonly requiredFact?: ReturnType<typeof comparisonTerm>;
  readonly returnedFact?: ReturnType<typeof comparisonTerm>;
  readonly divergence?: readonly {
    readonly divergenceKey: string;
    readonly behavior: "mayDiverge" | "mustDiverge";
  }[];
}) {
  const requiredFact =
    input.requiredFact ?? comparisonTerm(valueTerm("argument:0"), "lt", literalInt(4n));
  const returnedFact =
    input.returnedFact ?? comparisonTerm(valueTerm("result"), "le", valueTerm("argument:0"));
  const checked = checkedFunctionForTest({
    functionInstanceId: calleeFunctionInstanceId,
    declaredRequirements: [requiredFact],
    normalReturnExitStates: [
      proofCheckStateForTest({
        facts: [activeFactForTest(normalizeProofCheckTerm(returnedFact).key)],
      }),
    ],
    returnFactCandidates: [
      summaryFactForTest({
        key: normalizeProofCheckTerm(returnedFact).key,
        dependsOnParameter: 0,
        dependsOnResult: true,
      }),
    ],
    divergence: input.divergence,
  });
  const result = buildCheckedFunctionSummary(checked);
  if (result.kind !== "ok") {
    throw new Error("calleeSummaryForTest failed to build summary");
  }
  return {
    summary: result.summary,
    requiredFact,
    returnedFact,
  };
}

export function proofCheckProgramWithSourceCall(input: {
  readonly calleeRequiredFact?: ReturnType<typeof comparisonTerm>;
  readonly callerFacts?: readonly ReturnType<typeof activeFactForTest>[];
  readonly callerFactTerms?: readonly ReturnType<typeof comparisonTerm>[];
  readonly callRequirements?: CheckedSourceCallTransferInput["callRequirements"];
  readonly returnedFact?: ReturnType<typeof comparisonTerm>;
  readonly summary?: CheckedSourceCallTransferInput["summary"] | null;
  readonly divergence?: readonly {
    readonly divergenceKey: string;
    readonly behavior: "mayDiverge" | "mustDiverge";
  }[];
}): CheckedSourceCallTransferInput {
  const callee = calleeSummaryForTest({
    requiredFact: input.calleeRequiredFact,
    returnedFact: input.returnedFact,
    divergence: input.divergence,
  });
  return {
    state: proofCheckStateForTest({
      facts: [...(input.callerFacts ?? [])],
      places: [ownedPlaceForTest("argument:0"), ownedPlaceForTest("result")],
    }),
    call: sourceFunctionCallForTest(),
    summary: input.summary === null ? undefined : (input.summary ?? callee.summary),
    substitution: proofCheckBinderSubstitutionForTest({
      arguments: { 0: 100 as never },
      result: 101 as never,
    }),
    requirementTerms: [callee.requiredFact],
    returnedFactTerms: [callee.returnedFact],
    activeFactTerms: input.callerFactTerms ?? [],
    callRequirements: input.callRequirements,
    operandBindings: {
      arguments: [{ placeKey: "argument:0", resourceKind: "Copy" }],
      result: { placeKey: "result", resourceKind: "Copy" },
      placeKeys: new Map([
        ["argument:0", "argument:0"],
        ["result", "result"],
      ]),
    },
    operationOriginKey: "test:source-call",
  };
}

beforeEach(() => {
  resetCheckedFunctionSummaryCertificateIdsForTest();
  resetCheckedSummaryInstantiationCertificateIdsForTest();
  resetProofCheckCoreCertificateIdsForTest();
});

describe("checkSourceCallTransfer", () => {
  test("source call requires callee preconditions before importing return facts", () => {
    const transferInput = proofCheckProgramWithSourceCall({
      calleeRequiredFact: comparisonTerm(valueTerm("argument:0"), "lt", literalInt(4n)),
      callerFacts: [],
    });

    const result = checkSourceCallTransfer(transferInput);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
    );
  });

  test("imports substituted returned facts after requirement discharge", () => {
    const requiredFact = comparisonTerm(valueTerm("argument:0"), "lt", literalInt(8n));
    const returnedFact = comparisonTerm(valueTerm("result"), "le", valueTerm("argument:0"));
    const transferInput = proofCheckProgramWithSourceCall({
      calleeRequiredFact: requiredFact,
      returnedFact,
      callerFactTerms: [requiredFact],
    });

    const result = checkSourceCallTransfer(transferInput);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.doesNotReturnNormally).toBe(false);
    expect(result.patches.some((patch) => patch.kind === "fact" && patch.action === "add")).toBe(
      true,
    );
    expect(
      result.certificates.some((certificate) => certificate.kind === "summaryInstantiation"),
    ).toBe(true);
  });

  test("missing accepted callee summary produces source-call diagnostic", () => {
    const transferInput = proofCheckProgramWithSourceCall({
      summary: null,
    });

    const result = checkSourceCallTransfer(transferInput);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH"),
    );
  });

  test("observed inputs without call-site bindings are rejected", () => {
    const requiredFact = comparisonTerm(valueTerm("argument:0"), "lt", literalInt(8n));
    const transferInput = proofCheckProgramWithSourceCall({
      calleeRequiredFact: requiredFact,
      callerFactTerms: [requiredFact],
    });
    if (transferInput.summary === undefined) throw new Error("expected test summary");

    const result = checkSourceCallTransfer({
      ...transferInput,
      summary: {
        ...transferInput.summary,
        observedInputs: [
          ...transferInput.summary.observedInputs,
          { kind: "observes", place: { kind: "argument", index: 1 } },
        ],
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toBe("missing-operand-binding:argument:1");
  });

  test("mustDiverge callee summary makes successor source code unreachable", () => {
    const requiredFact = comparisonTerm(valueTerm("argument:0"), "lt", literalInt(8n));
    const transferInput = proofCheckProgramWithSourceCall({
      calleeRequiredFact: requiredFact,
      callerFactTerms: [requiredFact],
      divergence: [{ divergenceKey: "call:panic", behavior: "mustDiverge" }],
    });

    const result = checkSourceCallTransfer(transferInput);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.doesNotReturnNormally).toBe(true);
    expect(result.patches.some((patch) => patch.kind === "divergence")).toBe(true);
    expect(result.patches.some((patch) => patch.kind === "fact" && patch.action === "add")).toBe(
      false,
    );
  });

  test("mayDiverge callee summary preserves normal-return import path", () => {
    const requiredFact = comparisonTerm(valueTerm("argument:0"), "lt", literalInt(8n));
    const transferInput = proofCheckProgramWithSourceCall({
      calleeRequiredFact: requiredFact,
      callerFactTerms: [requiredFact],
      divergence: [{ divergenceKey: "call:may-panic", behavior: "mayDiverge" }],
    });

    const result = checkSourceCallTransfer(transferInput);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.doesNotReturnNormally).toBe(false);
    expect(result.patches.some((patch) => patch.kind === "divergence")).toBe(true);
    expect(result.patches.some((patch) => patch.kind === "fact" && patch.action === "add")).toBe(
      true,
    );
  });
});

describe("runProofCheckWholeImageDriver", () => {
  test("checks reachable source functions in topological order with callees before callers", () => {
    const leaf = monoInstanceId("leaf");
    const root = monoInstanceId("root");
    const order = [leaf, root];

    expect(
      calleePrecedesCallerInOrder({
        order,
        calleeFunctionInstanceId: leaf,
        callerFunctionInstanceId: root,
      }),
    ).toBe(true);

    const checkedOrder: string[] = [];
    const result = runProofCheckWholeImageDriver({
      mir: {
        functions: new Map(),
        reachableFunctions: new Map(),
        callGraph: new Map(),
      } as never,
      validatedInput: {
        diagnostics: [],
        reachableFunctionOrder: order,
        sourceCallGraph: {
          edges: [
            {
              callerFunctionInstanceId: root,
              calleeFunctionInstanceId: leaf,
              callId: sourceCallIdForTest(root, proofMirCallId(1)),
            },
          ],
          successors: new Map([[String(root), [leaf]]]),
        },
        deadFunctionIds: [],
      },
      registry: emptyProofCheckOperationTransferRegistryForTest(),
      checkFunction: (input) => {
        checkedOrder.push(String(input.functionInstanceId));
        return {
          kernelResult: {
            kind: "ok",
            acceptedBlockStates: [],
            summaries: [],
            packetEntries: [],
            explicitOrigins: [],
            diagnostics: [],
            debug: { suppressionCandidates: [] },
            registryArtifacts: finalizeProofCheckFunctionRegistryArtifacts(
              createProofCheckFunctionRegistryArtifacts(),
            ),
          },
          summaryResult: buildCheckedFunctionSummary(
            checkedFunctionForTest({ functionInstanceId: input.functionInstanceId }),
          ),
        };
      },
    });

    expect(result.kind).toBe("ok");
    expect(checkedOrder).toEqual([String(leaf), String(root)]);
    expect(result.summaries.has(leaf)).toBe(true);
    expect(result.summaries.has(root)).toBe(true);
  });

  test("rejects whole-image checking when input validation reports source-call cycle", () => {
    const result = runProofCheckWholeImageDriver({
      mir: {
        functions: new Map(),
        reachableFunctions: new Map(),
        callGraph: new Map(),
      } as never,
      validatedInput: {
        diagnostics: [
          {
            severity: "error",
            code: proofCheckDiagnosticCode("PROOF_CHECK_SOURCE_CALL_CYCLE"),
          } as never,
        ],
        reachableFunctionOrder: [],
        sourceCallGraph: { edges: [], successors: new Map() },
        deadFunctionIds: [],
      },
      registry: emptyProofCheckOperationTransferRegistryForTest(),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_SOURCE_CALL_CYCLE"),
    );
  });
});
