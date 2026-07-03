import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirExitClosurePolicy } from "../model/graph";
import type { DraftProofMirEdgeEffect } from "../domains/effects-resources";
import { draftControlEdgeKey, draftExitEdgeKey } from "./draft-keys";
import type {
  DraftProofMirCanonicalTableAcceptResult,
  DraftProofMirFunctionDraft,
  DraftProofMirGraphExitSnapshot,
} from "./draft-program";
import type {
  DraftGraphBuilderResult,
  DraftGraphControlEdgeKind,
  DraftGraphEdgeState,
  DraftGraphEdgeView,
} from "./draft-graph-builder";

interface DraftGraphBlockScopeLookup {
  readonly scopeKey: ProofMirCanonicalKey;
}

function functionExitClosurePolicy(terminal: boolean): ProofMirExitClosurePolicy {
  return {
    kind: "functionExit",
    requireNoLiveLoans: true,
    requireNoOpenObligations: true,
    requireNoLiveSessionMembers: true,
    requireNoPendingValidationResults: true,
    terminalReachability: terminal ? "required" : "notRequired",
  };
}

export interface CreateDraftGraphEdgeBuildersInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly draft: DraftProofMirFunctionDraft;
  readonly blocks: Map<ProofMirCanonicalKey, DraftGraphBlockScopeLookup>;
  readonly edges: Map<ProofMirCanonicalKey, DraftGraphEdgeState>;
  readonly exitStates: Map<ProofMirCanonicalKey, DraftProofMirGraphExitSnapshot>;
  readonly rootScopeKeyValue: ProofMirCanonicalKey;
  readonly normalEdgeCounter: { value: number };
  readonly switchCaseCounter: { value: number };
  readonly propagateAcceptResult: (
    result: DraftProofMirCanonicalTableAcceptResult,
  ) => DraftGraphBuilderResult;
  readonly acceptOrigin: (
    originKey: ProofMirCanonicalKey,
    note?: string,
  ) => DraftGraphBuilderResult;
}

export function createDraftGraphEdgeBuilders(input: CreateDraftGraphEdgeBuildersInput): {
  createNormalEdge(input: {
    readonly role?: string;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly factKeys?: readonly ProofMirCanonicalKey[];
    readonly effects?: readonly DraftProofMirEdgeEffect[];
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createBranchEdge(input: {
    readonly kind: "branchTrue" | "branchFalse";
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly factKeys?: readonly ProofMirCanonicalKey[];
    readonly effects?: readonly DraftProofMirEdgeEffect[];
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createSwitchEdge(input: {
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly factKeys?: readonly ProofMirCanonicalKey[];
    readonly effects?: readonly DraftProofMirEdgeEffect[];
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createAttemptEdge(input: {
    readonly kind: "attemptSuccess" | "attemptError";
    readonly role?: string;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly effects?: readonly DraftProofMirEdgeEffect[];
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createValidationEdge(input: {
    readonly kind: "validationOk" | "validationErr";
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly factKeys?: readonly ProofMirCanonicalKey[];
    readonly effects?: readonly DraftProofMirEdgeEffect[];
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createScopeBreakEdge(input: {
    readonly role?: string;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createScopeContinueEdge(input: {
    readonly role?: string;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createReturnExit(input: {
    readonly fromBlock: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly terminal: boolean;
  }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey };
  createScopeExit(input: {
    readonly role: string;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly crossedScopes: readonly ProofMirCanonicalKey[];
    readonly closure: Extract<ProofMirExitClosurePolicy, { readonly kind: "scopeExit" }>;
  }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey };
  createPanicExit(input: {
    readonly fromBlock: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
  }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey };
  edge(edgeKey: ProofMirCanonicalKey): DraftGraphEdgeView;
} {
  const {
    functionInstanceId,
    draft,
    blocks,
    edges,
    exitStates,
    rootScopeKeyValue,
    normalEdgeCounter,
    switchCaseCounter,
    propagateAcceptResult,
    acceptOrigin,
  } = input;

  function createEdge(edgeInput: {
    readonly role: string;
    readonly kind: DraftGraphControlEdgeKind;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock?: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly factKeys?: readonly ProofMirCanonicalKey[];
    readonly effects?: readonly DraftProofMirEdgeEffect[];
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    readonly exitKey?: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey {
    const edgeKey = draftControlEdgeKey({ functionInstanceId, role: edgeInput.role });
    const edgeState: DraftGraphEdgeState = {
      key: edgeKey,
      kind: edgeInput.kind,
      fromBlockKey: edgeInput.fromBlock,
      toBlockKey: edgeInput.toBlock,
      factKeys: edgeInput.factKeys ?? [],
      effects: edgeInput.effects ?? [],
      argumentKeys: edgeInput.argumentKeys ?? [],
      sourceScopeKey: edgeInput.sourceScope,
      targetScopeKey: edgeInput.targetScope,
      originKey: edgeInput.origin,
      exitKey: edgeInput.exitKey,
    };
    edges.set(edgeKey, edgeState);
    propagateAcceptResult(
      draft.controlEdges.accept({
        key: edgeKey,
        functionInstanceId,
        role: edgeInput.role,
        fromBlockKey: edgeInput.fromBlock,
        toBlockKey: edgeInput.toBlock ?? edgeInput.fromBlock,
        originKey: edgeInput.origin,
      }),
    );
    acceptOrigin(edgeInput.origin);
    return edgeKey;
  }

  function createExit(exitInput: {
    readonly role: string;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly exitKind?: DraftProofMirGraphExitSnapshot["exitKind"];
    readonly closure?: ProofMirExitClosurePolicy;
    readonly crossedScopeKeys?: readonly ProofMirCanonicalKey[];
    readonly targetScopeKey?: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey {
    const exitKey = draftExitEdgeKey({ functionInstanceId, role: exitInput.role });
    propagateAcceptResult(
      draft.exitEdges.accept({
        key: exitKey,
        functionInstanceId,
        role: exitInput.role,
        fromBlockKey: exitInput.fromBlock,
        originKey: exitInput.origin,
      }),
    );
    exitStates.set(exitKey, {
      key: exitKey,
      role: exitInput.role,
      fromBlockKey: exitInput.fromBlock,
      originKey: exitInput.origin,
      exitKind: exitInput.exitKind ?? "ordinaryReturn",
      closure: exitInput.closure ?? functionExitClosurePolicy(false),
      ...(exitInput.crossedScopeKeys === undefined
        ? {}
        : { crossedScopeKeys: exitInput.crossedScopeKeys }),
      ...(exitInput.targetScopeKey === undefined
        ? {}
        : { targetScopeKey: exitInput.targetScopeKey }),
    });
    acceptOrigin(exitInput.origin);
    return exitKey;
  }

  return {
    createNormalEdge(edgeMethodInput: {
      readonly role?: string;
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly factKeys?: readonly ProofMirCanonicalKey[];
      readonly effects?: readonly DraftProofMirEdgeEffect[];
      readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    }): ProofMirCanonicalKey {
      const role = edgeMethodInput.role ?? `normal:${normalEdgeCounter.value++}`;
      return createEdge({
        role,
        kind: "normal",
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        factKeys: edgeMethodInput.factKeys,
        effects: edgeMethodInput.effects,
        argumentKeys: edgeMethodInput.argumentKeys,
      });
    },

    createBranchEdge(edgeMethodInput: {
      readonly kind: "branchTrue" | "branchFalse";
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly factKeys?: readonly ProofMirCanonicalKey[];
      readonly effects?: readonly DraftProofMirEdgeEffect[];
      readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    }): ProofMirCanonicalKey {
      return createEdge({
        role: edgeMethodInput.kind,
        kind: edgeMethodInput.kind,
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        factKeys: edgeMethodInput.factKeys,
        effects: edgeMethodInput.effects,
        argumentKeys: edgeMethodInput.argumentKeys,
      });
    },

    createSwitchEdge(edgeMethodInput: {
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly factKeys?: readonly ProofMirCanonicalKey[];
      readonly effects?: readonly DraftProofMirEdgeEffect[];
      readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    }): ProofMirCanonicalKey {
      const role = `switchCase:${switchCaseCounter.value++}`;
      return createEdge({
        role,
        kind: "switchCase",
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        factKeys: edgeMethodInput.factKeys,
        effects: edgeMethodInput.effects,
        argumentKeys: edgeMethodInput.argumentKeys,
      });
    },

    createAttemptEdge(edgeMethodInput: {
      readonly kind: "attemptSuccess" | "attemptError";
      readonly role?: string;
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly effects?: readonly DraftProofMirEdgeEffect[];
      readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    }): ProofMirCanonicalKey {
      return createEdge({
        role: edgeMethodInput.role ?? edgeMethodInput.kind,
        kind: edgeMethodInput.kind,
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        effects: edgeMethodInput.effects,
        argumentKeys: edgeMethodInput.argumentKeys,
      });
    },

    createValidationEdge(edgeMethodInput: {
      readonly kind: "validationOk" | "validationErr";
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly factKeys?: readonly ProofMirCanonicalKey[];
      readonly effects?: readonly DraftProofMirEdgeEffect[];
      readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    }): ProofMirCanonicalKey {
      return createEdge({
        role: edgeMethodInput.kind,
        kind: edgeMethodInput.kind,
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        factKeys: edgeMethodInput.factKeys,
        effects: edgeMethodInput.effects,
        argumentKeys: edgeMethodInput.argumentKeys,
      });
    },

    createScopeBreakEdge(edgeMethodInput: {
      readonly role?: string;
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    }): ProofMirCanonicalKey {
      return createEdge({
        role: edgeMethodInput.role ?? "scopeBreak",
        kind: "scopeBreak",
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        argumentKeys: edgeMethodInput.argumentKeys,
      });
    },

    createScopeContinueEdge(edgeMethodInput: {
      readonly role?: string;
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    }): ProofMirCanonicalKey {
      return createEdge({
        role: edgeMethodInput.role ?? "scopeContinue",
        kind: "scopeContinue",
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        argumentKeys: edgeMethodInput.argumentKeys,
      });
    },

    createReturnExit(edgeMethodInput: {
      readonly fromBlock: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly terminal: boolean;
    }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey } {
      const exitRole = edgeMethodInput.terminal ? "returnExit:terminal" : "returnExit:ordinary";
      const siteRole = `${exitRole}:${String(edgeMethodInput.fromBlock)}`;
      const exit = createExit({
        role: siteRole,
        fromBlock: edgeMethodInput.fromBlock,
        origin: edgeMethodInput.origin,
        exitKind: edgeMethodInput.terminal ? "terminalReturn" : "ordinaryReturn",
        closure: functionExitClosurePolicy(edgeMethodInput.terminal),
      });
      const edge = createEdge({
        role: `returnExit:${String(edgeMethodInput.fromBlock)}`,
        kind: "returnExit",
        fromBlock: edgeMethodInput.fromBlock,
        sourceScope: blocks.get(edgeMethodInput.fromBlock)?.scopeKey ?? rootScopeKeyValue,
        targetScope: rootScopeKeyValue,
        origin: edgeMethodInput.origin,
        exitKey: exit,
      });
      return { edge, exit };
    },

    createScopeExit(edgeMethodInput: {
      readonly role: string;
      readonly fromBlock: ProofMirCanonicalKey;
      readonly toBlock: ProofMirCanonicalKey;
      readonly sourceScope: ProofMirCanonicalKey;
      readonly targetScope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly crossedScopes: readonly ProofMirCanonicalKey[];
      readonly closure: Extract<ProofMirExitClosurePolicy, { readonly kind: "scopeExit" }>;
    }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey } {
      const exit = createExit({
        role: edgeMethodInput.role,
        fromBlock: edgeMethodInput.fromBlock,
        origin: edgeMethodInput.origin,
        exitKind: "scopeBreak",
        closure: edgeMethodInput.closure,
        crossedScopeKeys: edgeMethodInput.crossedScopes,
        targetScopeKey: edgeMethodInput.targetScope,
      });
      const edge = createEdge({
        role: edgeMethodInput.role,
        kind: "scopeBreak",
        fromBlock: edgeMethodInput.fromBlock,
        toBlock: edgeMethodInput.toBlock,
        sourceScope: edgeMethodInput.sourceScope,
        targetScope: edgeMethodInput.targetScope,
        origin: edgeMethodInput.origin,
        exitKey: exit,
      });
      return { edge, exit };
    },

    createPanicExit(edgeMethodInput: {
      readonly fromBlock: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
    }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey } {
      const exit = createExit({
        role: "panicExit",
        fromBlock: edgeMethodInput.fromBlock,
        origin: edgeMethodInput.origin,
        exitKind: "panic",
        closure: functionExitClosurePolicy(false),
      });
      const edge = createEdge({
        role: "panicExit",
        kind: "panicExit",
        fromBlock: edgeMethodInput.fromBlock,
        sourceScope: blocks.get(edgeMethodInput.fromBlock)?.scopeKey ?? rootScopeKeyValue,
        targetScope: rootScopeKeyValue,
        origin: edgeMethodInput.origin,
        exitKey: exit,
      });
      return { edge, exit };
    },

    edge(edgeKey: ProofMirCanonicalKey): DraftGraphEdgeView {
      const edgeState = edges.get(edgeKey);
      if (edgeState === undefined) {
        throw new RangeError(`Unknown draft graph edge key: ${String(edgeKey)}.`);
      }
      return {
        key: edgeState.key,
        kind: edgeState.kind,
        fromBlockKey: edgeState.fromBlockKey,
        toBlockKey: edgeState.toBlockKey,
        factKeys: edgeState.factKeys,
        effects: edgeState.effects,
        argumentKeys: edgeState.argumentKeys,
        sourceScopeKey: edgeState.sourceScopeKey,
        targetScopeKey: edgeState.targetScopeKey,
        originKey: edgeState.originKey,
        exitKey: edgeState.exitKey,
      };
    },
  };
}
