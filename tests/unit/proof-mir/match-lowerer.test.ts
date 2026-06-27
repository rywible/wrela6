import { describe, expect, test } from "bun:test";
import { factOriginId } from "../../../src/hir/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoInstantiatedProofId } from "../../../src/mono/mono-hir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { crossedScopesForDraftEdge } from "../../../src/proof-mir/domains/effects-resources";
import { lowerProofMirMatchForTest } from "../../support/proof-mir/lower-harness/match-lowerer-harness";

describe("ProofMirMatchLowerer", () => {
  test("non-exhaustive switch without mono evidence is rejected", () => {
    const result = lowerProofMirMatchForTest({
      scrutinee: "kind",
      cases: ["Arp"],
      monoExhaustive: false,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS"),
    );
  });

  test("exhaustive match lowers to switch terminator with deterministic case order", () => {
    const lowered = lowerProofMirMatchForTest({
      scrutinee: "kind",
      cases: ["Arp", "Icmp"],
      monoExhaustive: true,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.switch?.terminator?.kind).toBe("switch");
    if (lowered.switch?.terminator?.kind !== "switch") return;

    expect(lowered.switch.terminator.cases.map((caseEntry) => caseEntry.label)).toEqual([
      "Arp",
      "Icmp",
    ]);
    expect(lowered.switch.terminator.fallback).toBeUndefined();
    expect(lowered.switch.cases.map((caseEntry) => caseEntry.kind)).toEqual([
      "switchCase",
      "switchCase",
    ]);
  });

  test("wildcard arm lowers as switch fallback", () => {
    const lowered = lowerProofMirMatchForTest({
      scrutinee: "kind",
      cases: ["Arp", "_"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.switch?.terminator?.kind).toBe("switch");
    if (lowered.switch?.terminator?.kind !== "switch") return;

    expect(lowered.switch.terminator.cases.map((caseEntry) => caseEntry.label)).toEqual(["Arp"]);
    expect(lowered.switch.terminator.fallback).toBeDefined();
    expect(lowered.switch.fallback?.kind).toBe("switchCase");
  });

  test("match arm with binding locals uses a child scope", () => {
    const lowered = lowerProofMirMatchForTest({
      scrutinee: "kind",
      cases: [{ pattern: "Arp", bindingLocals: ["payload"] }, "Icmp"],
      monoExhaustive: true,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const arpArm = lowered.arms[0];
    const icmpArm = lowered.arms[1];
    expect(arpArm?.usesChildScope).toBe(true);
    expect(icmpArm?.usesChildScope).toBe(false);
    expect(arpArm?.scopeRole).toMatch(/^matchArm:/);
    expect(lowered.context.graph.block(arpArm!.blockKey).scopeKey).not.toEqual(
      lowered.context.graph.block(icmpArm!.blockKey).scopeKey,
    );
  });

  test("arm exits record crossed scopes using the scope tree", () => {
    const lowered = lowerProofMirMatchForTest({
      scrutinee: "kind",
      cases: [{ pattern: "Arp", bindingLocals: ["payload"], body: [] }, "Icmp"],
      monoExhaustive: true,
      postamble: ["return 0"],
      scalarLocals: ["kind", "payload"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const arpArm = lowered.arms[0];
    expect(arpArm).toBeDefined();
    if (arpArm === undefined) return;

    const continuationEdges = lowered.edgesTo(lowered.continuation!.blockKey);
    const arpExit = continuationEdges.find((edge) => edge.fromBlockKey === arpArm.blockKey);
    expect(arpExit).toBeDefined();
    if (arpExit === undefined) return;

    const tree = lowered.scopeTree;
    const fromRole = lowered.scopeRoleForBlock(arpExit.fromBlockKey);
    const toRole = lowered.scopeRoleForBlock(arpExit.toBlockKey!);
    expect(fromRole).toBeDefined();
    expect(toRole).toBeDefined();
    if (fromRole === undefined || toRole === undefined) return;

    expect(crossedScopesForDraftEdge(tree, { from: fromRole, targetRole: toRole })).toEqual(
      arpExit.crossedScopeRoles,
    );
    expect(arpExit.crossedScopeRoles.length).toBeGreaterThan(0);
  });

  test("match refinements are recorded as edge-local facts", () => {
    const factOrigin = {
      owner: { kind: "function" as const, instanceId: monoInstanceId("fn:match-test") },
      hirId: factOriginId(7),
      instanceId: monoInstanceId("fn:match-test"),
    } satisfies MonoInstantiatedProofId<ReturnType<typeof factOriginId>>;

    const lowered = lowerProofMirMatchForTest({
      functionInstanceId: monoInstanceId("fn:match-test"),
      scrutinee: "kind",
      cases: ["Arp", "Icmp"],
      monoExhaustive: true,
      matchRefinements: [{ caseLabel: "Arp", originId: factOrigin }],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const arpEdge = lowered.switch?.cases[0];
    expect(arpEdge?.factKeys.length).toBeGreaterThan(0);

    const refinement = lowered.factForKey(arpEdge!.factKeys[0]!);
    expect(refinement?.kind.kind).toBe("matchRefinement");
    if (refinement?.kind.kind !== "matchRefinement") return;
    expect(refinement.kind.caseLabel).toBe("Arp");
  });
});
