import { describe, expect, test } from "bun:test";

import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type {
  CheckProofAndResourcesInput,
  ProofCheckResourceLimits,
} from "../../../src/proof-check/input-contract";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { validateProofCheckInput } from "../../../src/proof-check/validation/input-validator";
import { buildWholeImageTerminalGraphInputFromMir } from "../../../src/proof-check/domains/summary-input";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirOwnedCallId, proofMirCallId } from "../../../src/proof-mir/ids";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import { emptyProofMirReachableFunctionTableForTest } from "../proof-mir/input-compatibility-validator.test";
import {
  proofAuthorityFingerprintForTest,
  proofCheckPlatformCatalogFake,
  proofCheckRuntimeCatalogFake,
  proofCheckTypeFactCatalogFake,
  proofSemanticsCompanionFake,
} from "../../support/proof-check/authority-fakes";
import { withEmbeddedRuntimeCatalogFingerprint } from "../../support/proof-check/proof-check-fixtures";
import { withConcurrencyExtensionStatement } from "../../support/proof-check/fixtures/mir-mutations";

function proofMirProgramForInputValidatorTest(): ProofMirProgram {
  const result = buildProofMir(closedProofMirFixture());
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirProgramForInputValidatorTest failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

function proofCheckResourceLimitsForInputValidatorTest(): ProofCheckResourceLimits {
  return {
    maximumReachableFunctions: 256,
    maximumBlocksPerFunction: 512,
    maximumEdgesPerFunction: 1024,
    maximumAcceptedStateVariantsPerBlock: 64,
    maximumActiveFactsPerState: 512,
    maximumActiveLoansPerState: 128,
    maximumOpenObligationsPerState: 128,
    maximumOpenValidationsPerState: 64,
    maximumOpenAttemptsPerState: 64,
    maximumLiveCapabilitiesPerState: 128,
    maximumCounterexampleFrames: 64,
    maximumStagedPacketEntriesPerFunction: 512,
  };
}

function minimalProofCheckInputForValidatorTest(input?: {
  readonly mutateMir?: (mir: ProofMirProgram) => ProofMirProgram;
  readonly mutate?: (input: CheckProofAndResourcesInput) => CheckProofAndResourcesInput;
}): CheckProofAndResourcesInput {
  const mir = withEmbeddedRuntimeCatalogFingerprint(
    input?.mutateMir?.(proofMirProgramForInputValidatorTest()) ??
      proofMirProgramForInputValidatorTest(),
    "runtime",
  );
  const targetName = String(mir.layout.target.targetId);
  const baseInput: CheckProofAndResourcesInput = {
    mir,
    layout: mir.layout,
    limits: proofCheckResourceLimitsForInputValidatorTest(),
    platformContracts: proofCheckPlatformCatalogFake({
      entries: [],
      targetName,
    }),
    runtimeCatalog: proofCheckRuntimeCatalogFake({
      embedded: mir.runtimeCatalog,
      targetName,
    }),
    typeFacts: proofCheckTypeFactCatalogFake({
      entries: [],
      fingerprint: proofAuthorityFingerprintForTest({
        authorityKind: "typeFacts",
        targetName,
      }),
    }),
    semantics: proofSemanticsCompanionFake({
      providedJudgments: [],
      targetName,
      fingerprint: proofAuthorityFingerprintForTest({
        authorityKind: "semantics",
        targetName,
        version: "semantics-v1",
        digestSeed: "semantics",
      }),
    }),
  };
  return input?.mutate?.(baseInput) ?? baseInput;
}

describe("validateProofCheckInput", () => {
  test("valid closed proof-check input passes validation", () => {
    const result = validateProofCheckInput(minimalProofCheckInputForValidatorTest());

    expect(result.diagnostics).toEqual([]);
    expect(result.deadFunctionIds).toEqual([]);
    expect(result.reachableFunctionOrder.length).toBeGreaterThan(0);
    expect(result.sourceCallGraph.edges).toEqual([]);
  });

  test("input validator rejects external root outside reachable closure", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutateMir: (mir) =>
        ({
          ...mir,
          reachableFunctions: emptyProofMirReachableFunctionTableForTest(),
        }) as unknown as ProofMirProgram,
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_REACHABLE_CLOSURE_INVALID"),
    );
  });

  test("invalid resource limits fail before function checking", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutate: (baseInput) => ({
        ...baseInput,
        limits: {
          ...baseInput.limits,
          maximumReachableFunctions: 0,
        },
      }),
    });

    const result = validateProofCheckInput(input);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    ]);
    expect(result.reachableFunctionOrder).toEqual([]);
    expect(result.deadFunctionIds).toEqual([]);
  });

  test("target mismatch is reported deterministically", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutate: (baseInput) => ({
        ...baseInput,
        semantics: proofSemanticsCompanionFake({
          targetName: "different-target",
          providedJudgments: [],
        }),
      }),
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_TARGET_MISMATCH"));
    expect(diagnostics[0]?.rootCauseKey).toBe("proof-check:target-mismatch");
  });

  test("layout content key mismatch is reported", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutate: (baseInput) => ({
        ...baseInput,
        layout: {
          ...baseInput.layout,
          target: {
            ...baseInput.layout.target,
            pointerWidthBits: baseInput.layout.target.pointerWidthBits === 64 ? 32 : 64,
          },
        },
      }),
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LAYOUT_AUTHORITY_MISMATCH"),
    );
  });

  test("runtime catalog mismatch is reported", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutate: (baseInput) => ({
        ...baseInput,
        runtimeCatalog: proofCheckRuntimeCatalogFake({
          embedded: baseInput.mir.runtimeCatalog,
          targetName: String(baseInput.mir.layout.target.targetId),
          features: ["mismatched-runtime-feature"],
        }),
      }),
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
    );
  });

  test("reachable source-call cycles are rejected", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutateMir: (mir) => {
        const firstFunction = mir.functions.entries()[0];
        if (firstFunction === undefined) {
          throw new Error("expected at least one function in proof mir fixture");
        }
        const callerId = firstFunction.functionInstanceId;
        const calleeId = monoInstanceId(`${String(callerId)}-callee`);

        const callGraphEntries = [
          ...mir.callGraph.entries(),
          {
            callId: proofMirOwnedCallId(callerId, proofMirCallId(9001)),
            target: {
              kind: "sourceFunction" as const,
              functionInstanceId: calleeId,
              abi: {
                kind: "functionAbi" as const,
                functionInstanceId: calleeId,
              },
            },
            origin: firstFunction.origin,
          },
          {
            callId: proofMirOwnedCallId(calleeId, proofMirCallId(9002)),
            target: {
              kind: "sourceFunction" as const,
              functionInstanceId: callerId,
              abi: {
                kind: "functionAbi" as const,
                functionInstanceId: callerId,
              },
            },
            origin: firstFunction.origin,
          },
        ];

        const callGraphLookup = new Map(
          callGraphEntries.map((entry) => [
            `${String(entry.callId.functionInstanceId)}:${String(entry.callId.callId)}`,
            entry,
          ]),
        );
        const callGraph = {
          get(callId: (typeof callGraphEntries)[number]["callId"]) {
            return callGraphLookup.get(
              `${String(callId.functionInstanceId)}:${String(callId.callId)}`,
            );
          },
          entries: () => callGraphEntries,
        };

        const reachableEntry = {
          reason: "sourceCall" as const,
          origin: firstFunction.origin,
        };

        return {
          ...mir,
          callGraph: callGraph as unknown as ProofMirProgram["callGraph"],
          functions: {
            get(key: typeof callerId) {
              if (key === callerId) {
                return firstFunction;
              }
              if (key === calleeId) {
                return {
                  ...firstFunction,
                  functionInstanceId: calleeId,
                };
              }
              return undefined;
            },
            entries: () => [
              firstFunction,
              {
                ...firstFunction,
                functionInstanceId: calleeId,
              },
            ],
          },
          reachableFunctions: {
            get(key: typeof callerId) {
              if (key === callerId || key === calleeId) {
                return {
                  functionInstanceId: key,
                  ...reachableEntry,
                };
              }
              return undefined;
            },
            has(key: typeof callerId) {
              return key === callerId || key === calleeId;
            },
            entries: () => [
              {
                functionInstanceId: callerId,
                ...reachableEntry,
              },
              {
                functionInstanceId: calleeId,
                ...reachableEntry,
              },
            ],
          },
        } as unknown as ProofMirProgram;
      },
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_SOURCE_CALL_CYCLE"),
    );
  });

  test("dead function table entries are tracked without proof diagnostics", () => {
    const mir = proofMirProgramForInputValidatorTest();
    const reachableId = mir.reachableFunctions.entries()[0]?.functionInstanceId;
    if (reachableId === undefined) {
      throw new Error("expected reachable function in proof mir fixture");
    }

    const deadId = monoInstanceId("999999");
    const deadFunction = mir.functions.entries()[0];
    if (deadFunction === undefined) {
      throw new Error("expected function table entry in proof mir fixture");
    }

    const functions = [
      ...mir.functions.entries().filter((entry) => entry.functionInstanceId === reachableId),
      {
        ...deadFunction,
        functionInstanceId: deadId,
      },
    ];
    const functionLookup = new Map(
      functions.map((entry) => [String(entry.functionInstanceId), entry]),
    );
    const input = minimalProofCheckInputForValidatorTest({
      mutateMir: () =>
        ({
          ...mir,
          functions: {
            get(key: typeof reachableId) {
              return functionLookup.get(String(key));
            },
            entries: () => functions,
          },
        }) as unknown as ProofMirProgram,
    });

    const result = validateProofCheckInput(input);

    expect(result.diagnostics).toEqual([]);
    expect(result.deadFunctionIds).toEqual([deadId]);
  });

  test("missing companion judgment is reported for enabled extensions", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutateMir: (mir) => withConcurrencyExtensionStatement(mir),
    });

    const result = validateProofCheckInput(input);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("terminal graph target missing is reported for terminal functions", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutateMir: (mir) => {
        const functionGraph = mir.functions.entries()[0];
        if (functionGraph === undefined) {
          throw new Error("expected function graph in proof mir fixture");
        }

        const terminalFunction = {
          ...functionGraph,
          signature: {
            ...functionGraph.signature,
            modifiers: {
              ...functionGraph.signature.modifiers,
              isTerminal: true,
            },
          },
        };

        return {
          ...mir,
          functions: {
            get(key: typeof functionGraph.functionInstanceId) {
              return key === functionGraph.functionInstanceId ? terminalFunction : undefined;
            },
            entries: () => [terminalFunction],
          },
        } as unknown as ProofMirProgram;
      },
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
    );
  });

  test("terminal graph target from call graph sourceFunction edge passes validation", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutateMir: (mir) => {
        const functionGraph = mir.functions.entries()[0];
        if (functionGraph === undefined) {
          throw new Error("expected function graph in proof mir fixture");
        }

        const terminalFunction = {
          ...functionGraph,
          signature: {
            ...functionGraph.signature,
            modifiers: {
              ...functionGraph.signature.modifiers,
              isTerminal: true,
            },
          },
        };

        const callGraphEntries = [
          ...mir.callGraph.entries(),
          {
            callId: proofMirOwnedCallId(terminalFunction.functionInstanceId, proofMirCallId(9101)),
            target: {
              kind: "sourceFunction" as const,
              functionInstanceId: terminalFunction.functionInstanceId,
              abi: {
                kind: "functionAbi" as const,
                functionInstanceId: terminalFunction.functionInstanceId,
              },
            },
            origin: terminalFunction.origin,
          },
        ];
        const callGraphLookup = new Map(
          callGraphEntries.map((entry) => [
            `${String(entry.callId.functionInstanceId)}:${String(entry.callId.callId)}`,
            entry,
          ]),
        );
        const callGraph = {
          get(callId: (typeof callGraphEntries)[number]["callId"]) {
            return callGraphLookup.get(
              `${String(callId.functionInstanceId)}:${String(callId.callId)}`,
            );
          },
          entries: () => callGraphEntries,
        };

        return {
          ...mir,
          callGraph,
          functions: {
            get(key: typeof terminalFunction.functionInstanceId) {
              return key === terminalFunction.functionInstanceId ? terminalFunction : undefined;
            },
            entries: () => [terminalFunction],
          },
        } as unknown as ProofMirProgram;
      },
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
    );
  });

  test("buildWholeImageTerminalGraphInputFromMir derives edges only from call graph", () => {
    const mir = proofMirProgramForInputValidatorTest();
    const functionGraph = mir.functions.entries()[0];
    if (functionGraph === undefined) {
      throw new Error("expected function graph in proof mir fixture");
    }

    const terminalFunction = {
      ...functionGraph,
      signature: {
        ...functionGraph.signature,
        modifiers: {
          ...functionGraph.signature.modifiers,
          isTerminal: true,
        },
      },
    };

    const callGraphEntries = [
      {
        callId: proofMirOwnedCallId(terminalFunction.functionInstanceId, proofMirCallId(9201)),
        target: {
          kind: "sourceFunction" as const,
          functionInstanceId: terminalFunction.functionInstanceId,
          abi: {
            kind: "functionAbi" as const,
            functionInstanceId: terminalFunction.functionInstanceId,
          },
        },
        origin: terminalFunction.origin,
      },
    ];
    const callGraphLookup = new Map(
      callGraphEntries.map((entry) => [
        `${String(entry.callId.functionInstanceId)}:${String(entry.callId.callId)}`,
        entry,
      ]),
    );
    const callGraph = {
      get(callId: (typeof callGraphEntries)[number]["callId"]) {
        return callGraphLookup.get(`${String(callId.functionInstanceId)}:${String(callId.callId)}`);
      },
      entries: () => callGraphEntries,
    };
    const mutatedMir = {
      ...mir,
      callGraph,
      functions: {
        get(key: typeof terminalFunction.functionInstanceId) {
          return key === terminalFunction.functionInstanceId ? terminalFunction : undefined;
        },
        entries: () => [terminalFunction],
      },
    } as unknown as ProofMirProgram;

    const graphInput = buildWholeImageTerminalGraphInputFromMir({
      mir: mutatedMir,
      terminalGraphKey: "terminal-graph:test",
    });

    expect(graphInput.edges).toEqual([
      {
        from: `terminal:${String(terminalFunction.functionInstanceId)}`,
        targetNode: `terminal:${String(terminalFunction.functionInstanceId)}`,
      },
    ]);
  });

  test("invalid exit policy is reported", () => {
    const input = minimalProofCheckInputForValidatorTest({
      mutateMir: (mir) => {
        const functionGraph = mir.functions.entries()[0];
        if (functionGraph === undefined) {
          throw new Error("expected function graph in proof mir fixture");
        }

        const invalidExit = {
          ...functionGraph.exits[0]!,
          closure: {
            kind: "functionExit" as const,
            requireNoLiveLoans: false,
            requireNoOpenObligations: true,
            requireNoLiveSessionMembers: true,
            requireNoPendingValidationResults: true,
            terminalReachability: "notRequired" as const,
          },
        };

        return {
          ...mir,
          functions: {
            get(key: typeof functionGraph.functionInstanceId) {
              return key === functionGraph.functionInstanceId
                ? { ...functionGraph, exits: [invalidExit] }
                : undefined;
            },
            entries: () => [{ ...functionGraph, exits: [invalidExit] }],
          },
        } as unknown as ProofMirProgram;
      },
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
  });

  test("malformed authority fingerprints are rejected before target matching", () => {
    const baseInput = minimalProofCheckInputForValidatorTest();
    const targetName = String(baseInput.mir.layout.target.targetId);
    const malformedFingerprint = {
      ...proofAuthorityFingerprintForTest({
        authorityKind: "platform",
        targetName,
      }),
      version: "",
    };

    const diagnostics = validateProofCheckInput({
      ...baseInput,
      platformContracts: proofCheckPlatformCatalogFake({
        entries: [],
        targetName,
        fingerprint: malformedFingerprint,
      }),
    }).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT"),
    );
    expect(diagnostics.some((diagnostic) => diagnostic.stableDetail === "empty-version")).toBe(
      true,
    );
  });

  test("invalid digest algorithm is rejected for type fact catalog fingerprints", () => {
    const baseInput = minimalProofCheckInputForValidatorTest();
    const targetName = String(baseInput.mir.layout.target.targetId);
    const malformedFingerprint = {
      ...proofAuthorityFingerprintForTest({
        authorityKind: "typeFacts",
        targetName,
      }),
      digestAlgorithm: "sha1" as "sha256",
    };

    const diagnostics = validateProofCheckInput({
      ...baseInput,
      typeFacts: proofCheckTypeFactCatalogFake({
        entries: [],
        fingerprint: malformedFingerprint,
      }),
    }).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT"),
    );
    expect(
      diagnostics.some((diagnostic) => diagnostic.stableDetail === "invalid-digest-algorithm:sha1"),
    ).toBe(true);
  });

  test("non-hex digest values are rejected for semantics fingerprints", () => {
    const baseInput = minimalProofCheckInputForValidatorTest();
    const targetName = String(baseInput.mir.layout.target.targetId);
    const malformedFingerprint = {
      ...proofAuthorityFingerprintForTest({
        authorityKind: "semantics",
        targetName,
      }),
      digestHex: "not-a-valid-sha256-digest",
    };

    const diagnostics = validateProofCheckInput({
      ...baseInput,
      semantics: proofSemanticsCompanionFake({
        targetName,
        providedJudgments: [],
        fingerprint: malformedFingerprint,
      }),
    }).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT"),
    );
    expect(diagnostics.some((diagnostic) => diagnostic.stableDetail === "invalid-digest-hex")).toBe(
      true,
    );
  });
});
