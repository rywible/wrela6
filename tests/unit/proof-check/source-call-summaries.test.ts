import { describe, expect, test, beforeEach } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  buildCheckedFunctionSummary,
  resetCheckedFunctionSummaryCertificateIdsForTest,
  type BuildCheckedFunctionSummaryInput,
  type CheckedSummaryFactDependency,
  type CheckedSummaryReturnFactCandidate,
} from "../../../src/proof-check/domains/source-calls";
import { normalizeProofCheckTerm } from "../../../src/proof-check/model/fact-language";
import {
  activeFactForTest,
  exclusiveLoanForTest,
  obligationStateForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";

const defaultFunctionInstanceId = monoInstanceId("1");

export function summaryFactForTest(input: {
  readonly key: string;
  readonly dependsOnInternalLocal?: boolean;
  readonly dependsOnParameter?: number;
  readonly dependsOnReceiver?: boolean;
  readonly dependsOnResult?: boolean;
  readonly dependsOnProducedCapability?: string;
  readonly dependsOnLiveLoan?: string;
}): CheckedSummaryReturnFactCandidate {
  const dependencies: CheckedSummaryFactDependency[] = [];
  if (input.dependsOnInternalLocal === true) {
    dependencies.push({ kind: "internalLocal", key: "local:tmp" });
  }
  if (input.dependsOnReceiver === true) {
    dependencies.push({ kind: "receiver" });
  }
  if (input.dependsOnParameter !== undefined) {
    dependencies.push({ kind: "parameter", index: input.dependsOnParameter });
  }
  if (input.dependsOnResult === true) {
    dependencies.push({ kind: "result" });
  }
  if (input.dependsOnProducedCapability !== undefined) {
    dependencies.push({
      kind: "producedCapability",
      key: input.dependsOnProducedCapability,
    });
  }
  if (input.dependsOnLiveLoan !== undefined) {
    dependencies.push({ kind: "liveLoan", key: input.dependsOnLiveLoan });
  }
  return {
    termKey: input.key,
    dependencies,
  };
}

export function checkedFunctionForTest(
  input: Partial<BuildCheckedFunctionSummaryInput> & {
    readonly returnFacts?: readonly CheckedSummaryReturnFactCandidate[];
  } = {},
): BuildCheckedFunctionSummaryInput {
  const requirement = comparisonTerm(valueTerm("argument:0"), "le", literalInt(8n));
  const exportableFactKey = normalizeProofCheckTerm(
    comparisonTerm(valueTerm("result"), "le", literalInt(8n)),
  ).key;

  return {
    functionInstanceId: input.functionInstanceId ?? defaultFunctionInstanceId,
    declaredRequirements: input.declaredRequirements ?? [requirement],
    normalReturnExitStates: input.normalReturnExitStates ?? [
      proofCheckStateForTest({
        facts: [
          activeFactForTest(exportableFactKey),
          ...(input.returnFacts ?? []).map((candidate) => activeFactForTest(candidate.termKey)),
        ],
      }),
    ],
    returnFactCandidates: input.returnFactCandidates ?? input.returnFacts ?? [],
    observedInputs: input.observedInputs,
    consumedInputs: input.consumedInputs,
    mutatedInputs: input.mutatedInputs,
    producedPlaces: input.producedPlaces,
    invalidatedFacts: input.invalidatedFacts,
    privateStateEffects: input.privateStateEffects,
    producedCapabilities: input.producedCapabilities,
    terminalEffects: input.terminalEffects,
    divergence: input.divergence,
    packetEntries: input.packetEntries,
    acceptance: input.acceptance,
  };
}

beforeEach(() => {
  resetCheckedFunctionSummaryCertificateIdsForTest();
});

describe("buildCheckedFunctionSummary", () => {
  test("source summary does not export internal local refinement facts", () => {
    const checked = checkedFunctionForTest({
      returnFacts: [summaryFactForTest({ key: "local:tmp > 0", dependsOnInternalLocal: true })],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.returnedFacts).toEqual([]);
  });

  test("requiredFacts are the callee declared symbolic requirements", () => {
    const requirement = comparisonTerm(valueTerm("argument:0"), "le", literalInt(4n));
    const checked = checkedFunctionForTest({
      declaredRequirements: [requirement],
      returnFactCandidates: [],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.requiredFacts).toEqual([
      { termKey: normalizeProofCheckTerm(requirement, "sourceRequirement").key },
    ]);
  });

  test("returnedFacts include exportable facts present on every normal return path", () => {
    const exportableKey = "ensures:result <= 8";
    const checked = checkedFunctionForTest({
      normalReturnExitStates: [
        proofCheckStateForTest({ facts: [activeFactForTest(exportableKey)] }),
        proofCheckStateForTest({ facts: [activeFactForTest(exportableKey)] }),
      ],
      returnFactCandidates: [summaryFactForTest({ key: exportableKey, dependsOnResult: true })],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.returnedFacts).toEqual([{ termKey: exportableKey }]);
  });

  test("returnedFacts drop facts that are not true on every normal return path", () => {
    const sharedKey = "ensures:shared";
    const branchOnlyKey = "ensures:branch-only";
    const checked = checkedFunctionForTest({
      normalReturnExitStates: [
        proofCheckStateForTest({
          facts: [activeFactForTest(sharedKey), activeFactForTest(branchOnlyKey)],
        }),
        proofCheckStateForTest({ facts: [activeFactForTest(sharedKey)] }),
      ],
      returnFactCandidates: [
        summaryFactForTest({ key: sharedKey, dependsOnParameter: 0 }),
        summaryFactForTest({ key: branchOnlyKey, dependsOnParameter: 0 }),
      ],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.returnedFacts).toEqual([{ termKey: sharedKey }]);
  });

  test("summary effects over-approximate observed and consumed place effects", () => {
    const checked = checkedFunctionForTest({
      returnFactCandidates: [],
      observedInputs: [{ kind: "observes", placeKey: "argument:0", borrowMode: "shared" }],
      consumedInputs: [{ kind: "consumes", placeKey: "argument:1" }],
      producedPlaces: [{ kind: "produces", placeKey: "result", resourceKind: "Copy" }],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.observedInputs).toEqual([
      {
        kind: "observes",
        place: { kind: "argument", index: 0 },
        borrowMode: "shared",
      },
    ]);
    expect(result.summary.consumedInputs).toEqual([
      { kind: "consumes", place: { kind: "argument", index: 1 } },
    ]);
    expect(result.summary.producedPlaces).toEqual([
      { kind: "produces", place: { kind: "result" }, resourceKind: "Copy" },
    ]);
  });

  test("summary export rejects live loans at normal return exits", () => {
    const checked = checkedFunctionForTest({
      normalReturnExitStates: [
        proofCheckStateForTest({
          loans: [exclusiveLoanForTest("buffer")],
        }),
      ],
      returnFactCandidates: [],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_LOAN"));
  });

  test("summary export rejects open obligations at normal return exits", () => {
    const checked = checkedFunctionForTest({
      normalReturnExitStates: [
        proofCheckStateForTest({
          obligations: [obligationStateForTest("obligation:buffer")],
        }),
      ],
      returnFactCandidates: [],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_OBLIGATION"),
    );
  });

  test("summary export rejects when exit acceptance is missing", () => {
    const checked = checkedFunctionForTest({
      acceptance: { exits: false },
      returnFactCandidates: [],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("exits");
  });

  test("summary includes accepted divergence behavior", () => {
    const checked = checkedFunctionForTest({
      returnFactCandidates: [],
      divergence: [{ divergenceKey: "divergence:may-panic", behavior: "mayDiverge" }],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.divergence).toEqual([
      { divergenceKey: "divergence:may-panic", behavior: "mayDiverge" },
    ]);
  });

  test("returnedFacts drop candidates with non-exportable live-loan dependencies", () => {
    const factKey = "ensures:result <= 8";
    const checked = checkedFunctionForTest({
      normalReturnExitStates: [proofCheckStateForTest({ facts: [activeFactForTest(factKey)] })],
      returnFactCandidates: [
        summaryFactForTest({
          key: factKey,
          dependsOnResult: true,
          dependsOnLiveLoan: "loan:buffer",
        }),
      ],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.returnedFacts).toEqual([]);
  });
});
