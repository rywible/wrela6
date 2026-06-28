import { stableNumericSeed } from "../stable-numeric-seed";
import type { ProofMirExitBoundary } from "../../proof-mir/model/graph";
import { proofMirOriginId, proofMirPlaceId } from "../../proof-mir/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofSemanticsCompanion } from "../authority/semantics-companion";
import {
  validateProofSemanticsJudgmentResult,
  type ProofSemanticsJudgmentRequest,
  type ProofTerminalClosureJudgmentResult,
} from "../authority/semantics-companion";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import {
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofSemanticsCertificateId,
} from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import {
  checkedTerminalClosureKey,
  type CheckedTerminalClosureKey,
  type CheckedTerminalGraphCertificate,
} from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import { type CheckedDivergenceFact, type ProofCheckState } from "../kernel/state";
import { checkReturnWithLoans } from "./loans";
import { checkCrossedScopeExit } from "./take-sessions";

export interface TerminalGraphEdge {
  readonly from: string;
  readonly targetNode: string;
}

export interface CoreTerminalGraph {
  readonly terminalGraphKey: string;
  readonly nodes: readonly string[];
  readonly edges: readonly TerminalGraphEdge[];
  readonly platformBaseNodes: readonly string[];
  readonly entryNodes: readonly string[];
  readonly fallthroughNodes: readonly string[];
  readonly dynamicDispatchNodes: readonly string[];
  readonly closed: boolean;
}

export interface BuildCoreTerminalGraphInput {
  readonly terminalGraphKey: string;
  readonly nodes: readonly string[];
  readonly edges: readonly TerminalGraphEdge[];
  readonly platformBaseNodes: readonly string[];
  readonly entryNodes?: readonly string[];
  readonly fallthroughNodes?: readonly string[];
  readonly dynamicDispatchNodes?: readonly string[];
}

export interface TerminalGraphCheckInput {
  readonly graph: CoreTerminalGraph;
  readonly ownerKey?: string;
}

export interface TerminalClosureCompanionInput {
  readonly graph: CoreTerminalGraph;
  readonly companion: ProofSemanticsCompanion;
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly dependencyKeys?: ReadonlySet<string>;
  readonly ownerKey?: string;
}

export type ProofCheckPanicExitPolicy =
  | { readonly kind: "unobservableAfterAbort"; readonly certificateKey: string }
  | { readonly kind: "forbiddenWithLiveState" };

export type DivergenceExitKind = "panic" | "mayPanic" | "doesNotReturn";

export interface LocalTerminalExitInput {
  readonly state: ProofCheckState;
  readonly terminalReachabilityRequired: boolean;
  readonly operationOriginKey?: string;
}

export interface DivergenceExitInput {
  readonly state: ProofCheckState;
  readonly kind: DivergenceExitKind;
  readonly divergenceKey: string;
  readonly boundary?: ProofMirExitBoundary;
  readonly exitPolicy?: ProofCheckPanicExitPolicy;
  readonly operationOriginKey?: string;
}

export interface TerminalClosurePacketInput {
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly terminalCallKey: string;
  readonly platformEffectKey: string;
  readonly closurePath: readonly string[];
  readonly emptyExitStateKey: string;
  readonly operationOriginKey?: string;
  readonly semanticsCertificateId?: ProofCheckCertificateId;
}

export type TerminalGraphCheckResult =
  | {
      readonly kind: "ok";
      readonly certificate: CheckedTerminalGraphCertificate;
      readonly closurePath: readonly string[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type TerminalClosureCompanionResult =
  | {
      readonly kind: "ok";
      readonly certificate: CheckedTerminalGraphCertificate;
      readonly judgment: ProofTerminalClosureJudgmentResult;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type LocalTerminalExitResult =
  | {
      readonly kind: "ok";
      readonly patches: readonly ProofCheckStatePatchEntry[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type DivergenceExitResult = LocalTerminalExitResult;

export function resetTerminalSemanticsCertificateIdsForTest(): void {
  // Terminal semantics certificate ids are derived from stable subject keys.
}

function defaultOwnerKey(ownerKey: string | undefined, suffix: string): string {
  return ownerKey ?? `proof-check:terminal:${suffix}`;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnitStrings);
}

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

function originForTerminal(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function coreCertificateForSubject(subjectKey: string): ProofCheckCertificateId {
  return {
    kind: "core",
    id: proofCheckCoreCertificateId(stableNumericSeed(`core:${subjectKey}`)),
  };
}

function semanticsCertificateForTerminalKey(
  terminalKey: CheckedTerminalClosureKey,
): ProofCheckCertificateId {
  return {
    kind: "semantics",
    id: proofSemanticsCertificateId(stableNumericSeed(`semantics:terminal:${terminalKey}`)),
  };
}

function terminalClosureMissingDiagnostic(input: {
  readonly ownerKey: string;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_TERMINAL_CLOSURE_MISSING",
    messageTemplateId: "proof-check.terminal.closure-missing",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail: input.stableDetail,
  });
}

function invalidPanicClosureDiagnostic(input: {
  readonly ownerKey: string;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_PANIC_CLOSURE",
    messageTemplateId: "proof-check.terminal.invalid-panic-closure",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail: input.stableDetail,
  });
}

function inputContractDiagnostic(input: {
  readonly ownerKey: string;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.terminal.input-contract",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail: input.stableDetail,
  });
}

function missingCompanionJudgmentDiagnostic(ownerKey: string): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
    messageTemplateId: "proof-check.semantics-companion.missing-judgment",
    messageArguments: [{ kind: "text", value: "terminalClosure" }],
    message: "Missing companion judgment: terminalClosure.",
    ownerKey,
    rootCauseKey: ownerKey,
    stableDetail: "missing-judgment:terminalClosure",
  });
}

function adjacency(edges: readonly TerminalGraphEdge[]): ReadonlyMap<string, readonly string[]> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const bucket = outgoing.get(edge.from) ?? [];
    bucket.push(edge.targetNode);
    outgoing.set(edge.from, bucket);
  }
  for (const [from, targets] of outgoing.entries()) {
    outgoing.set(from, [...targets].sort(compareCodeUnitStrings));
  }
  return outgoing;
}

function reachesPlatformBase(input: {
  readonly node: string;
  readonly outgoing: ReadonlyMap<string, readonly string[]>;
  readonly platformBaseNodes: ReadonlySet<string>;
  readonly visiting: Set<string>;
}): boolean {
  if (input.platformBaseNodes.has(input.node)) {
    return true;
  }
  if (input.visiting.has(input.node)) {
    return false;
  }
  const targets = input.outgoing.get(input.node) ?? [];
  if (targets.length === 0) {
    return false;
  }
  input.visiting.add(input.node);
  for (const target of targets) {
    if (
      reachesPlatformBase({
        node: target,
        outgoing: input.outgoing,
        platformBaseNodes: input.platformBaseNodes,
        visiting: input.visiting,
      })
    ) {
      input.visiting.delete(input.node);
      return true;
    }
  }
  input.visiting.delete(input.node);
  return false;
}

function closurePathForNode(input: {
  readonly node: string;
  readonly outgoing: ReadonlyMap<string, readonly string[]>;
  readonly platformBaseNodes: ReadonlySet<string>;
  readonly visiting: Set<string>;
}): readonly string[] | undefined {
  if (input.platformBaseNodes.has(input.node)) {
    return [input.node];
  }
  if (input.visiting.has(input.node)) {
    return undefined;
  }
  const targets = input.outgoing.get(input.node) ?? [];
  input.visiting.add(input.node);
  for (const target of targets) {
    const suffix = closurePathForNode({
      node: target,
      outgoing: input.outgoing,
      platformBaseNodes: input.platformBaseNodes,
      visiting: input.visiting,
    });
    if (suffix !== undefined) {
      input.visiting.delete(input.node);
      return [input.node, ...suffix];
    }
  }
  input.visiting.delete(input.node);
  return undefined;
}

function hasLiveProofResourceState(state: ProofCheckState): boolean {
  const loanResult = checkReturnWithLoans({ state, operationOriginKey: "terminal:panic-check" });
  if (loanResult.kind === "error") {
    return true;
  }
  const crossedScopeResult = checkCrossedScopeExit({
    state,
    exitKind: "return",
    operationOriginKey: "terminal:panic-check",
  });
  return crossedScopeResult.kind === "error";
}

function divergenceKindForExit(kind: DivergenceExitKind): CheckedDivergenceFact["kind"] {
  switch (kind) {
    case "panic":
    case "mayPanic":
      return "panic";
    case "doesNotReturn":
      return "doesNotReturn";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function buildTerminalClosurePacketEntry(input: {
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly operationOriginKey: string;
  readonly semanticsCertificateId?: ProofCheckCertificateId;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`terminal:${input.terminalKey}`)),
    kind: checkedFactKindId("terminalClosure"),
    subject: { kind: "terminal", terminalKey: input.terminalKey },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [],
    certificate:
      input.semanticsCertificateId ?? semanticsCertificateForTerminalKey(input.terminalKey),
    origin: originForTerminal(input.operationOriginKey),
  };
}

function buildExitClosurePacketEntry(input: {
  readonly emptyExitStateKey: string;
  readonly operationOriginKey: string;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const subjectKey = `exit:${input.emptyExitStateKey}`;
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(subjectKey)),
    kind: checkedFactKindId("exitClosure"),
    subject: { kind: "place", placeId: proofMirPlaceId(stableNumericSeed(subjectKey)) },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [],
    certificate: coreCertificateForSubject(subjectKey),
    origin: originForTerminal(input.operationOriginKey),
  };
}

export function buildCoreTerminalGraph(input: BuildCoreTerminalGraphInput): CoreTerminalGraph {
  const nodes = sortedUnique(input.nodes);
  const edges = [...input.edges].sort((left, right) =>
    compareCodeUnitStrings(
      `${left.from}->${left.targetNode}`,
      `${right.from}->${right.targetNode}`,
    ),
  );
  const platformBaseNodes = sortedUnique(input.platformBaseNodes);
  const entryNodes =
    input.entryNodes === undefined || input.entryNodes.length === 0
      ? nodes
      : sortedUnique(input.entryNodes);
  return {
    terminalGraphKey: input.terminalGraphKey,
    nodes,
    edges,
    platformBaseNodes,
    entryNodes,
    fallthroughNodes: sortedUnique(input.fallthroughNodes ?? []),
    dynamicDispatchNodes: sortedUnique(input.dynamicDispatchNodes ?? []),
    closed: true,
  };
}

export function checkTerminalGraph(input: TerminalGraphCheckInput): TerminalGraphCheckResult {
  const ownerKey = defaultOwnerKey(input.ownerKey, input.graph.terminalGraphKey);
  const graph = input.graph;

  if (!graph.closed) {
    return {
      kind: "error",
      diagnostics: [
        inputContractDiagnostic({
          ownerKey,
          stableDetail: "terminal-graph:not-closed",
        }),
      ],
    };
  }

  const nodeSet = new Set(graph.nodes);
  const platformBaseNodes = new Set(graph.platformBaseNodes);
  const outgoing = adjacency(graph.edges);
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const node of graph.fallthroughNodes) {
    diagnostics.push(
      terminalClosureMissingDiagnostic({
        ownerKey,
        stableDetail: `fallthrough:${node}`,
      }),
    );
  }

  for (const node of graph.dynamicDispatchNodes) {
    diagnostics.push(
      terminalClosureMissingDiagnostic({
        ownerKey,
        stableDetail: `dynamic-dispatch:${node}`,
      }),
    );
  }

  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.from)) {
      diagnostics.push(
        terminalClosureMissingDiagnostic({
          ownerKey,
          stableDetail: `missing-source:${edge.from}`,
        }),
      );
    }
    if (!nodeSet.has(edge.targetNode)) {
      diagnostics.push(
        terminalClosureMissingDiagnostic({
          ownerKey,
          stableDetail: `missing-target:${edge.targetNode}`,
        }),
      );
    }
  }

  for (const entryNode of graph.entryNodes) {
    if (!nodeSet.has(entryNode)) {
      diagnostics.push(
        terminalClosureMissingDiagnostic({
          ownerKey,
          stableDetail: `missing-entry:${entryNode}`,
        }),
      );
      continue;
    }
    const visiting = new Set<string>();
    if (
      !reachesPlatformBase({
        node: entryNode,
        outgoing,
        platformBaseNodes,
        visiting,
      })
    ) {
      diagnostics.push(
        terminalClosureMissingDiagnostic({
          ownerKey,
          stableDetail: `no-platform-reachability:${entryNode}`,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(diagnostics),
    };
  }

  const primaryEntry = graph.entryNodes[0] ?? graph.nodes[0] ?? "";
  const closurePath =
    closurePathForNode({
      node: primaryEntry,
      outgoing,
      platformBaseNodes,
      visiting: new Set<string>(),
    }) ?? [];

  const terminalKey = checkedTerminalClosureKey(graph.terminalGraphKey);
  const certificateId = proofSemanticsCertificateId(
    stableNumericSeed(`semantics:terminal:${terminalKey}`),
  );
  const platformEffectKey =
    graph.platformBaseNodes[0] ?? closurePath[closurePath.length - 1] ?? primaryEntry;

  return {
    kind: "ok",
    certificate: {
      certificateId,
      terminalKey,
      closurePath,
      platformEffectKey,
    },
    closurePath,
  };
}

function buildTerminalClosureRequest(input: {
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly graph: CoreTerminalGraph;
}): ProofSemanticsJudgmentRequest {
  return {
    kind: "terminalClosure",
    input: {
      requestKey: `request:terminal:${input.graph.terminalGraphKey}`,
      terminalKey: input.terminalKey,
      terminalGraphKey: input.graph.terminalGraphKey,
      platformBaseKeys: [...input.graph.platformBaseNodes],
    },
  };
}

export function checkTerminalClosureWithCompanion(
  input: TerminalClosureCompanionInput,
): TerminalClosureCompanionResult {
  const ownerKey = defaultOwnerKey(input.ownerKey, String(input.terminalKey));
  const graphCheck = checkTerminalGraph({ graph: input.graph, ownerKey });
  if (graphCheck.kind === "error") {
    return graphCheck;
  }

  const dependencyKeys = input.dependencyKeys ?? new Set<string>();
  const request = buildTerminalClosureRequest({
    terminalKey: input.terminalKey,
    graph: input.graph,
  });
  const validation = validateProofSemanticsJudgmentResult({
    companion: input.companion,
    request,
    dependencyKeys,
  });
  if (validation.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(
        validation.diagnostics.map((diagnostic) =>
          proofCheckDiagnostic({
            ...diagnostic,
            ownerKey,
            rootCauseKey: ownerKey,
          }),
        ),
      ),
    };
  }
  if (validation.result.kind !== "terminalClosure") {
    return {
      kind: "error",
      diagnostics: [missingCompanionJudgmentDiagnostic(ownerKey)],
    };
  }

  return {
    kind: "ok",
    certificate: graphCheck.certificate,
    judgment: validation.result,
  };
}

export function checkLocalTerminalExit(input: LocalTerminalExitInput): LocalTerminalExitResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "local-exit");
  const diagnostics: ProofCheckDiagnostic[] = [];

  const loanResult = checkReturnWithLoans({
    state: input.state,
    operationOriginKey: ownerKey,
  });
  if (loanResult.kind === "error") {
    diagnostics.push(...loanResult.diagnostics);
  }

  const crossedScopeResult = checkCrossedScopeExit({
    state: input.state,
    exitKind: "return",
    operationOriginKey: ownerKey,
  });
  if (crossedScopeResult.kind === "error") {
    diagnostics.push(...crossedScopeResult.diagnostics);
  }

  if (input.terminalReachabilityRequired && input.state.terminal.size === 0) {
    diagnostics.push(
      terminalClosureMissingDiagnostic({
        ownerKey,
        stableDetail: "terminal-return:missing-terminal-reachability",
      }),
    );
  }

  if (diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(diagnostics),
    };
  }

  const terminalFacts = [...input.state.terminal.values()].sort((left, right) =>
    compareCodeUnitStrings(left.terminalKey, right.terminalKey),
  );
  const packetEntries = terminalFacts.map((terminal) =>
    buildTerminalClosurePacketEntry({
      terminalKey: terminal.terminalKey as CheckedTerminalClosureKey,
      operationOriginKey: ownerKey,
    }),
  );

  return {
    kind: "ok",
    patches: [],
    packetEntries,
  };
}

export function transferDivergenceExit(input: DivergenceExitInput): DivergenceExitResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "divergence-exit");
  const boundary = input.boundary ?? { kind: "function", unwind: "none" as const };

  if (
    input.kind === "panic" &&
    boundary.kind === "function" &&
    boundary.unwind === "abortNoUnwind" &&
    hasLiveProofResourceState(input.state)
  ) {
    const panicResult = checkPanicClosure({
      state: input.state,
      boundary,
      exitPolicy: input.exitPolicy,
      operationOriginKey: ownerKey,
    });
    if (panicResult.kind === "error") {
      return panicResult;
    }
  } else if (
    (input.kind === "panic" || input.kind === "mayPanic" || input.kind === "doesNotReturn") &&
    hasLiveProofResourceState(input.state)
  ) {
    const loanResult = checkReturnWithLoans({
      state: input.state,
      operationOriginKey: ownerKey,
    });
    if (loanResult.kind === "error") {
      return {
        kind: "error",
        diagnostics: loanResult.diagnostics,
      };
    }

    const crossedScopeResult = checkCrossedScopeExit({
      state: input.state,
      exitKind: "return",
      operationOriginKey: ownerKey,
    });
    if (crossedScopeResult.kind === "error") {
      return {
        kind: "error",
        diagnostics: crossedScopeResult.diagnostics,
      };
    }
  }

  const divergence: CheckedDivergenceFact = {
    divergenceKey: input.divergenceKey,
    kind: divergenceKindForExit(input.kind),
  };
  const patches: ProofCheckStatePatchEntry[] = [{ kind: "divergence", divergence }];
  const packetEntries = [
    buildExitClosurePacketEntry({
      emptyExitStateKey: `divergence:${divergence.divergenceKey}`,
      operationOriginKey: ownerKey,
    }),
  ];

  return {
    kind: "ok",
    patches,
    packetEntries,
  };
}

export function checkPanicClosure(input: {
  readonly state: ProofCheckState;
  readonly boundary: ProofMirExitBoundary;
  readonly exitPolicy?: ProofCheckPanicExitPolicy;
  readonly operationOriginKey?: string;
}): LocalTerminalExitResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "panic-closure");

  if (input.boundary.kind !== "function" || input.boundary.unwind !== "abortNoUnwind") {
    return { kind: "ok", patches: [], packetEntries: [] };
  }

  if (!hasLiveProofResourceState(input.state)) {
    return { kind: "ok", patches: [], packetEntries: [] };
  }

  if (input.exitPolicy?.kind === "unobservableAfterAbort") {
    return {
      kind: "ok",
      patches: [],
      packetEntries: [
        buildExitClosurePacketEntry({
          emptyExitStateKey: `abort:${input.exitPolicy.certificateKey}`,
          operationOriginKey: ownerKey,
        }),
      ],
    };
  }

  return {
    kind: "error",
    diagnostics: [
      invalidPanicClosureDiagnostic({
        ownerKey,
        stableDetail: "abort-no-unwind:live-state-without-unobservable-policy",
      }),
    ],
  };
}

export function buildTerminalClosurePacketFacts(
  input: TerminalClosurePacketInput,
): readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "packet-facts");
  const terminalEntry = buildTerminalClosurePacketEntry({
    terminalKey: input.terminalKey,
    operationOriginKey: `${ownerKey}:${input.terminalCallKey}`,
    ...(input.semanticsCertificateId !== undefined
      ? { semanticsCertificateId: input.semanticsCertificateId }
      : {}),
  });
  const exitEntry = buildExitClosurePacketEntry({
    emptyExitStateKey: input.emptyExitStateKey,
    operationOriginKey: `${ownerKey}:${input.platformEffectKey}`,
  });
  return [terminalEntry, exitEntry].sort((left, right) =>
    compareCodeUnitStrings(String(left.factId), String(right.factId)),
  );
}

export function terminalGraphSubjectKey(terminalGraphKey: string): CheckedTerminalClosureKey {
  return checkedTerminalClosureKey(terminalGraphKey);
}
