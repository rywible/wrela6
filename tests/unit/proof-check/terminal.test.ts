import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  buildCoreTerminalGraph,
  buildTerminalClosurePacketFacts,
  checkLocalTerminalExit,
  checkPanicClosure,
  checkTerminalClosureWithCompanion,
  checkTerminalGraph,
  resetTerminalSemanticsCertificateIdsForTest,
  transferDivergenceExit,
  type BuildCoreTerminalGraphInput,
  type CoreTerminalGraph,
  type TerminalGraphCheckInput,
} from "../../../src/proof-check/domains/terminal";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import { proofSemanticsCertificateId } from "../../../src/proof-check/ids";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import { targetId } from "../../../src/semantic/ids";
import { proofSemanticsCompanionFake } from "../../support/proof-check/authority-fakes";
import {
  exclusiveLoanForTest,
  obligationStateForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";

const defaultTerminalGraphKey = "terminal-graph:test";

function semanticsFingerprintForTest(): ProofAuthorityFingerprint {
  return {
    authorityKind: "semantics",
    targetId: targetId("proof-check-test-target"),
    version: "semantics-v1",
    digestAlgorithm: "sha256",
    digestHex: "dd".repeat(32),
  };
}

function terminalClosureOkResult(
  request: Extract<ProofSemanticsJudgmentRequest, { readonly kind: "terminalClosure" }>,
): Extract<ProofSemanticsJudgmentResult, { readonly kind: "terminalClosure" }> {
  return {
    kind: "terminalClosure",
    requestKind: "terminalClosure",
    requestKey: request.input.requestKey,
    companionFingerprint: semanticsFingerprintForTest(),
    subjectKey: String(request.input.terminalKey),
    dependencyKeys: request.input.platformBaseKeys.map((key) => `platform-base:${key}`),
    certificateId: proofSemanticsCertificateId(9),
    terminalClosureKey: request.input.terminalKey,
  };
}

function terminalCompanionWithJudge(
  judge: (request: ProofSemanticsJudgmentRequest) => ProofSemanticsJudgmentResult | undefined,
): ProofSemanticsCompanion {
  return proofSemanticsCompanion({
    fingerprint: semanticsFingerprintForTest(),
    targetId: targetId("proof-check-test-target"),
    schemaVersion: "semantics-v1",
    providedJudgments: [proofSemanticsJudgmentKind("terminalClosure")],
    judge,
  });
}

function terminalFactForTest(terminalKey: string) {
  return {
    terminalKey: checkedTerminalClosureKey(terminalKey),
  };
}

export function terminalGraphForTest(
  overrides: Partial<BuildCoreTerminalGraphInput> & {
    readonly closed?: boolean;
    readonly ownerKey?: string;
  } = {},
): TerminalGraphCheckInput {
  resetTerminalSemanticsCertificateIdsForTest();
  const nodes = overrides.nodes ?? ["terminal:self"];
  const graph: CoreTerminalGraph = {
    ...buildCoreTerminalGraph({
      terminalGraphKey: overrides.terminalGraphKey ?? defaultTerminalGraphKey,
      nodes,
      edges: overrides.edges ?? [],
      platformBaseNodes: overrides.platformBaseNodes ?? [],
      ...(overrides.entryNodes === undefined ? {} : { entryNodes: overrides.entryNodes }),
      ...(overrides.fallthroughNodes === undefined
        ? {}
        : { fallthroughNodes: overrides.fallthroughNodes }),
      ...(overrides.dynamicDispatchNodes === undefined
        ? {}
        : { dynamicDispatchNodes: overrides.dynamicDispatchNodes }),
    }),
    closed: overrides.closed ?? true,
  };
  return {
    graph,
    ...(overrides.ownerKey === undefined ? {} : { ownerKey: overrides.ownerKey }),
  };
}

describe("checkTerminalGraph", () => {
  test("terminal self-cycle without platform base is rejected", () => {
    const result = checkTerminalGraph(
      terminalGraphForTest({
        edges: [{ from: "terminal:self", targetNode: "terminal:self" }],
        platformBaseNodes: [],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
    );
  });

  test("mutual terminal cycle without platform base is rejected", () => {
    const result = checkTerminalGraph(
      terminalGraphForTest({
        nodes: ["terminal:a", "terminal:b"],
        edges: [
          { from: "terminal:a", targetNode: "terminal:b" },
          { from: "terminal:b", targetNode: "terminal:a" },
        ],
        platformBaseNodes: [],
        entryNodes: ["terminal:a"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
    );
  });

  test("missing terminal target is rejected", () => {
    const result = checkTerminalGraph(
      terminalGraphForTest({
        nodes: ["terminal:entry"],
        edges: [{ from: "terminal:entry", targetNode: "terminal:missing" }],
        platformBaseNodes: [],
        entryNodes: ["terminal:entry"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.stableDetail.includes("missing-target")),
    ).toBe(true);
  });

  test("fallthrough terminal node is rejected", () => {
    const result = checkTerminalGraph(
      terminalGraphForTest({
        nodes: ["terminal:entry", "terminal:platform"],
        edges: [{ from: "terminal:entry", targetNode: "terminal:platform" }],
        platformBaseNodes: ["terminal:platform"],
        fallthroughNodes: ["terminal:entry"],
        entryNodes: ["terminal:entry"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("fallthrough");
  });

  test("dynamic terminal dispatch is rejected", () => {
    const result = checkTerminalGraph(
      terminalGraphForTest({
        nodes: ["terminal:entry", "terminal:platform"],
        edges: [{ from: "terminal:entry", targetNode: "terminal:platform" }],
        platformBaseNodes: ["terminal:platform"],
        dynamicDispatchNodes: ["terminal:entry"],
        entryNodes: ["terminal:entry"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("dynamic-dispatch");
  });

  test("terminal chain reaching platform base is accepted", () => {
    const result = checkTerminalGraph(
      terminalGraphForTest({
        nodes: ["terminal:entry", "terminal:platform"],
        edges: [{ from: "terminal:entry", targetNode: "terminal:platform" }],
        platformBaseNodes: ["terminal:platform"],
        entryNodes: ["terminal:entry"],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.certificate.closurePath).toEqual(["terminal:entry", "terminal:platform"]);
    expect(result.certificate.platformEffectKey).toBe("terminal:platform");
  });

  test("unclosed terminal graph is rejected before companion validation", () => {
    const input = terminalGraphForTest({
      nodes: ["terminal:platform"],
      platformBaseNodes: ["terminal:platform"],
      closed: false,
    });

    const result = checkTerminalClosureWithCompanion({
      graph: input.graph,
      terminalKey: checkedTerminalClosureKey(defaultTerminalGraphKey),
      companion: terminalCompanionWithJudge((request) => {
        if (request.kind !== "terminalClosure") {
          return undefined;
        }
        return terminalClosureOkResult(request);
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
  });
});

describe("checkTerminalClosureWithCompanion", () => {
  test("terminal closure without required companion judgment is rejected", () => {
    const graphInput = terminalGraphForTest({
      nodes: ["terminal:platform"],
      platformBaseNodes: ["terminal:platform"],
      entryNodes: ["terminal:platform"],
    });

    const result = checkTerminalClosureWithCompanion({
      graph: graphInput.graph,
      terminalKey: checkedTerminalClosureKey(defaultTerminalGraphKey),
      companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("companion validates closed terminal graph without adding edges", () => {
    const graphInput = terminalGraphForTest({
      nodes: ["terminal:entry", "terminal:platform"],
      edges: [{ from: "terminal:entry", targetNode: "terminal:platform" }],
      platformBaseNodes: ["terminal:platform"],
      entryNodes: ["terminal:entry"],
    });

    const result = checkTerminalClosureWithCompanion({
      graph: graphInput.graph,
      terminalKey: checkedTerminalClosureKey(defaultTerminalGraphKey),
      companion: terminalCompanionWithJudge((request) => {
        if (request.kind !== "terminalClosure") {
          return undefined;
        }
        return terminalClosureOkResult(request);
      }),
      dependencyKeys: new Set(["platform-base:terminal:platform"]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.judgment.terminalClosureKey).toBe(
      checkedTerminalClosureKey(defaultTerminalGraphKey),
    );
    expect(result.certificate.closurePath).toEqual(["terminal:entry", "terminal:platform"]);
  });
});

describe("checkLocalTerminalExit", () => {
  test("terminal return with live obligation is rejected", () => {
    const result = checkLocalTerminalExit({
      state: proofCheckStateForTest({
        obligations: [obligationStateForTest("obligation:open")],
        terminal: [terminalFactForTest("terminal:discharge")],
      }),
      terminalReachabilityRequired: true,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "PROOF_CHECK_LEAKED_OBLIGATION"),
    ).toBe(true);
  });

  test("terminal return with empty state and terminal reachability is accepted", () => {
    const result = checkLocalTerminalExit({
      state: proofCheckStateForTest({
        terminal: [terminalFactForTest("terminal:discharge")],
      }),
      terminalReachabilityRequired: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("terminalClosure")),
    ).toBe(true);
  });

  test("terminal return without terminal reachability is rejected", () => {
    const result = checkLocalTerminalExit({
      state: proofCheckStateForTest(),
      terminalReachabilityRequired: true,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
    );
  });
});

describe("transferDivergenceExit", () => {
  test("panic creates divergence exit state", () => {
    const result = transferDivergenceExit({
      state: proofCheckStateForTest(),
      kind: "panic",
      divergenceKey: "panic:main",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([
      {
        kind: "divergence",
        divergence: { divergenceKey: "panic:main", kind: "panic" },
      },
    ]);
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("exitClosure")),
    ).toBe(true);
  });

  test("mayPanic and doesNotReturn create divergence exit states", () => {
    const mayPanic = transferDivergenceExit({
      state: proofCheckStateForTest(),
      kind: "mayPanic",
      divergenceKey: "may-panic:platform",
    });
    const doesNotReturn = transferDivergenceExit({
      state: proofCheckStateForTest(),
      kind: "doesNotReturn",
      divergenceKey: "does-not-return:platform",
    });

    expect(mayPanic.kind).toBe("ok");
    expect(doesNotReturn.kind).toBe("ok");
    if (mayPanic.kind !== "ok" || doesNotReturn.kind !== "ok") return;
    expect(mayPanic.patches[0]?.kind).toBe("divergence");
    expect(doesNotReturn.patches[0]).toEqual({
      kind: "divergence",
      divergence: { divergenceKey: "does-not-return:platform", kind: "doesNotReturn" },
    });
  });

  test("panic with live state is rejected unless abort policy proves unobservable", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer")],
    });

    const rejected = transferDivergenceExit({
      state,
      kind: "panic",
      divergenceKey: "panic:abort",
      boundary: { kind: "function", unwind: "abortNoUnwind" },
    });
    expect(rejected.kind).toBe("error");
    if (rejected.kind !== "error") return;
    expect(rejected.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_PANIC_CLOSURE"),
    );

    const accepted = transferDivergenceExit({
      state,
      kind: "panic",
      divergenceKey: "panic:abort",
      boundary: { kind: "function", unwind: "abortNoUnwind" },
      exitPolicy: { kind: "unobservableAfterAbort", certificateKey: "policy:abort-unobservable" },
    });
    expect(accepted.kind).toBe("ok");
  });

  test("non-abort panic cannot cross live proof resource state", () => {
    const result = transferDivergenceExit({
      state: proofCheckStateForTest({
        loans: [exclusiveLoanForTest("buffer")],
      }),
      kind: "panic",
      divergenceKey: "panic:plain",
      boundary: { kind: "function", unwind: "none" },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "PROOF_CHECK_LEAKED_LOAN"),
    ).toBe(true);
  });
});

describe("checkPanicClosure", () => {
  test("abortNoUnwind accepts live state with unobservable-after-abort policy", () => {
    const result = checkPanicClosure({
      state: proofCheckStateForTest({ loans: [exclusiveLoanForTest("buffer")] }),
      boundary: { kind: "function", unwind: "abortNoUnwind" },
      exitPolicy: { kind: "unobservableAfterAbort", certificateKey: "policy:abort" },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packetEntries.length).toBe(1);
  });
});

describe("buildTerminalClosurePacketFacts", () => {
  test("terminal packet facts identify call, platform edge, closure path, and empty exit state", () => {
    const facts = buildTerminalClosurePacketFacts({
      terminalKey: checkedTerminalClosureKey("terminal:graph"),
      terminalCallKey: "call:terminal-main",
      platformEffectKey: "platform:abort",
      closurePath: ["terminal:entry", "terminal:platform"],
      emptyExitStateKey: "exit:empty",
    });

    expect(facts).toHaveLength(2);
    expect(facts.some((entry) => entry.kind === checkedFactKindId("terminalClosure"))).toBe(true);
    expect(facts.some((entry) => entry.kind === checkedFactKindId("exitClosure"))).toBe(true);
    expect(
      facts.every((entry) =>
        entry.dependencies.every(
          (dependency) => dependency.kind !== "proofMirCall" && dependency.kind !== "proofMirEdge",
        ),
      ),
    ).toBe(true);
  });
});

describe("buildCoreTerminalGraph", () => {
  test("core terminal graph is closed and deterministic", () => {
    const first = buildCoreTerminalGraph({
      terminalGraphKey: "graph:a",
      nodes: ["terminal:b", "terminal:a"],
      edges: [{ from: "terminal:b", targetNode: "terminal:a" }],
      platformBaseNodes: ["terminal:a"],
    });
    const second = buildCoreTerminalGraph({
      terminalGraphKey: "graph:a",
      nodes: ["terminal:a", "terminal:b"],
      edges: [{ from: "terminal:b", targetNode: "terminal:a" }],
      platformBaseNodes: ["terminal:a"],
    });

    expect(first.closed).toBe(true);
    expect(first).toEqual(second);
  });
});
