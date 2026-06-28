import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkLocalTerminalExit,
  checkTerminalClosureWithCompanion,
  checkTerminalGraph,
  transferDivergenceExit,
} from "../../../src/proof-check/domains/terminal";
import { proofSemanticsCertificateId } from "../../../src/proof-check/ids";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import { targetId } from "../../../src/semantic/ids";
import {
  checkProofSourceForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import {
  exclusiveLoanForTest,
  obligationStateForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { terminalGraphForTest } from "../../unit/proof-check/terminal.test";

function semanticsFingerprintForTest(): ProofAuthorityFingerprint {
  return {
    authorityKind: "semantics",
    targetId: targetId("proof-check-test-target"),
    version: "semantics-v1",
    digestAlgorithm: "sha256",
    digestHex: "ee".repeat(32),
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
    certificateId: proofSemanticsCertificateId(11),
    terminalClosureKey: request.input.terminalKey,
  };
}

describe("terminal closure integration", () => {
  test("rejected self-cycle reports deterministic terminal closure diagnostics", () => {
    const result = checkTerminalGraph(
      terminalGraphForTest({
        edges: [{ from: "terminal:self", targetNode: "terminal:self" }],
        platformBaseNodes: [],
        ownerKey: "integration:terminal:self-cycle",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_TERMINAL_CLOSURE_MISSING",
        ownerKey: "integration:terminal:self-cycle",
        rootCauseKey: "integration:terminal:self-cycle",
      },
    ]);
  });

  test("accepted platform-reaching terminal chain validates companion closure", () => {
    const graphInput = terminalGraphForTest({
      nodes: ["terminal:wrapper", "terminal:platform"],
      edges: [{ from: "terminal:wrapper", targetNode: "terminal:platform" }],
      platformBaseNodes: ["terminal:platform"],
      entryNodes: ["terminal:wrapper"],
      ownerKey: "integration:terminal:platform-chain",
    });

    const graphResult = checkTerminalGraph(graphInput);
    expect(graphResult.kind).toBe("ok");
    if (graphResult.kind !== "ok") return;

    const companionResult = checkTerminalClosureWithCompanion({
      graph: graphInput.graph,
      terminalKey: checkedTerminalClosureKey(graphInput.graph.terminalGraphKey),
      companion: proofSemanticsCompanion({
        fingerprint: semanticsFingerprintForTest(),
        targetId: targetId("proof-check-test-target"),
        schemaVersion: "semantics-v1",
        providedJudgments: [proofSemanticsJudgmentKind("terminalClosure")],
        judge: (request) => {
          if (request.kind !== "terminalClosure") {
            return undefined;
          }
          return terminalClosureOkResult(request);
        },
      }),
      dependencyKeys: new Set(["platform-base:terminal:platform"]),
      ownerKey: "integration:terminal:platform-chain",
    });

    expect(companionResult.kind).toBe("ok");
    if (companionResult.kind !== "ok") return;
    expect(companionResult.certificate.closurePath).toEqual([
      "terminal:wrapper",
      "terminal:platform",
    ]);
  });

  test("local terminal exit and divergence transfer compose for empty and abort paths", () => {
    const terminalExit = checkLocalTerminalExit({
      state: proofCheckStateForTest({
        terminal: [{ terminalKey: checkedTerminalClosureKey("terminal:discharge") }],
      }),
      terminalReachabilityRequired: true,
      operationOriginKey: "integration:terminal:local-exit",
    });
    expect(terminalExit.kind).toBe("ok");
    if (terminalExit.kind !== "ok") return;
    expect(
      terminalExit.packetEntries.some(
        (entry) => entry.kind === checkedFactKindId("terminalClosure"),
      ),
    ).toBe(true);

    const divergence = transferDivergenceExit({
      state: proofCheckStateForTest(),
      kind: "doesNotReturn",
      divergenceKey: "divergence:integration",
      operationOriginKey: "integration:terminal:divergence",
    });
    expect(divergence.kind).toBe("ok");
    if (divergence.kind !== "ok") return;
    expect(divergence.patches[0]?.kind).toBe("divergence");
  });

  test("abort panic with live resources requires invalid panic closure diagnostic", () => {
    const result = transferDivergenceExit({
      state: proofCheckStateForTest({
        obligations: [obligationStateForTest("obligation:live")],
        loans: [exclusiveLoanForTest("buffer")],
      }),
      kind: "panic",
      divergenceKey: "panic:integration",
      boundary: { kind: "function", unwind: "abortNoUnwind" },
      operationOriginKey: "integration:terminal:panic",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_PANIC_CLOSURE"),
    );
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_INVALID_PANIC_CLOSURE",
        ownerKey: "integration:terminal:panic",
        rootCauseKey: "integration:terminal:panic",
      },
    ]);
  });
});

describe("terminal closure end-to-end integration", () => {
  const TERMINAL_DELEGATE_SOURCE = [
    "terminal fn stop() -> Never",
    "platform fn exit() -> Never",
    "",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        stop()",
  ].join("\n");

  test("terminal self-cycle is rejected end to end", () => {
    const result = checkProofAndResourcesForClosedFixture({ invalidCase: "terminal-self-cycle" });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
    );
  });

  test("mutual terminal cycle is rejected end to end", () => {
    const result = checkProofAndResourcesForClosedFixture({ invalidCase: "terminal-mutual-cycle" });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
    );
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_TERMINAL_CLOSURE_MISSING",
        ownerKey: result.diagnostics[0]?.ownerKey ?? "",
        rootCauseKey: result.diagnostics[0]?.rootCauseKey ?? "",
      },
    ]);
  });

  test("terminal return without platform reachability is rejected deterministically", () => {
    const result = checkLocalTerminalExit({
      state: proofCheckStateForTest(),
      terminalReachabilityRequired: true,
      operationOriginKey: "integration:e2e:terminal-without-platform",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_TERMINAL_CLOSURE_MISSING",
        ownerKey: "integration:e2e:terminal-without-platform",
        rootCauseKey: "integration:e2e:terminal-without-platform",
      },
    ]);
  });

  test("invalid panic closure with live resources is rejected end to end", () => {
    const result = transferDivergenceExit({
      state: proofCheckStateForTest({
        obligations: [obligationStateForTest("obligation:live")],
        loans: [exclusiveLoanForTest("buffer")],
      }),
      kind: "panic",
      divergenceKey: "panic:e2e",
      boundary: { kind: "function", unwind: "abortNoUnwind" },
      operationOriginKey: "integration:e2e:invalid-panic",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_PANIC_CLOSURE"),
    );
  });

  test("accepted platform-reaching terminal chain validates companion closure end to end", () => {
    const graphInput = terminalGraphForTest({
      nodes: ["terminal:wrapper", "terminal:platform"],
      edges: [{ from: "terminal:wrapper", targetNode: "terminal:platform" }],
      platformBaseNodes: ["terminal:platform"],
      entryNodes: ["terminal:wrapper"],
      ownerKey: "integration:e2e:terminal-platform-chain",
    });

    const graphResult = checkTerminalGraph(graphInput);
    expect(graphResult.kind).toBe("ok");
    if (graphResult.kind !== "ok") return;

    const companionResult = checkTerminalClosureWithCompanion({
      graph: graphInput.graph,
      terminalKey: checkedTerminalClosureKey(graphInput.graph.terminalGraphKey),
      companion: proofSemanticsCompanion({
        fingerprint: semanticsFingerprintForTest(),
        targetId: targetId("proof-check-test-target"),
        schemaVersion: "semantics-v1",
        providedJudgments: [proofSemanticsJudgmentKind("terminalClosure")],
        judge: (request) => {
          if (request.kind !== "terminalClosure") {
            return undefined;
          }
          return terminalClosureOkResult(request);
        },
      }),
      dependencyKeys: new Set(["platform-base:terminal:platform"]),
      ownerKey: "integration:e2e:terminal-platform-chain",
    });

    expect(companionResult.kind).toBe("ok");
  });

  test("checkProofSourceForTest routes terminal function snippets through fixture fallback when unsupported", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(TERMINAL_DELEGATE_SOURCE);
    const result = checkProofSourceForTest(TERMINAL_DELEGATE_SOURCE, {
      fixtureFallback: { invalidCase: "terminal-self-cycle" },
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    if (syntax === "unsupported-source-syntax") {
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
      );
    }
  });
});
