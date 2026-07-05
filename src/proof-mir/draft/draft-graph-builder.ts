import type { AttemptId, ValidationId } from "../../hir/ids";
import { hirStatementId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import { instantiatedHirId } from "../../mono/ids";
import type { MonoInstantiatedProofId, MonoCheckedType } from "../../mono/mono-hir";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type {
  DraftProofMirPlaceProjection,
  DraftProofMirPlaceRoot,
  DraftProofMirStructuredPlace,
  ProofMirLocalStorageKind,
} from "../domains/effects-resources";
import type { ProofMirValueRepresentation } from "../model/graph";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirEdgeEffect } from "../domains/effects-resources";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import {
  draftBlockKey,
  draftFactKey,
  draftLocalKey,
  draftOriginKey,
  draftPlaceKey,
  draftScopeKey,
  draftStatementKey,
  draftTerminatorKey,
  draftValueKey,
} from "./draft-keys";
import {
  createEmptyDraftProofMirFunctionDraft,
  type DraftProofMirCanonicalTableAcceptResult,
  type DraftProofMirExitClosurePolicy,
  type DraftProofMirFunctionDraft,
  type DraftProofMirGraphExitSnapshot,
  type DraftProofMirGraphSnapshot,
} from "./draft-program";
import type { DraftProofMirGraphStatementSnapshot } from "./draft-statement";
import { createDraftGraphEdgeBuilders } from "./draft-graph-terminators";
import { errorResult, okResult, type DraftGraphBuilderResult } from "./draft-graph-builder-result";
import { setDraftGraphBlockStateMerge } from "./draft-block-state-merge";
import { exportDraftGraphSnapshot } from "./draft-graph-snapshot-export";
import type { DraftGraphBlockStateMerge } from "./draft-block-state-merge";
export type { DraftGraphBlockStateMerge } from "./draft-block-state-merge";

export type DraftGraphControlEdgeKind =
  | "normal"
  | "branchTrue"
  | "branchFalse"
  | "switchCase"
  | "validationOk"
  | "validationErr"
  | "attemptSuccess"
  | "attemptError"
  | "scopeBreak"
  | "scopeContinue"
  | "yieldSuspend"
  | "yieldResume"
  | "returnExit"
  | "panicExit";

export type DraftGraphEdgeEffect = DraftProofMirEdgeEffect;

export interface DraftGraphBlockTarget {
  readonly edge: ProofMirCanonicalKey;
  readonly block: ProofMirCanonicalKey;
}

export interface DraftGraphSwitchCase {
  readonly label: string;
  readonly target: DraftGraphBlockTarget;
  readonly origin: ProofMirCanonicalKey;
}

export type DraftGraphTerminator =
  | {
      readonly kind: "return";
      readonly value?: ProofMirCanonicalKey;
      readonly edge: ProofMirCanonicalKey;
      readonly exit: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "panic";
      readonly reason?: ProofMirCanonicalKey;
      readonly edge: ProofMirCanonicalKey;
      readonly exit: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "goto";
      readonly target: DraftGraphBlockTarget;
      readonly origin: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "branch";
      readonly condition: ProofMirCanonicalKey;
      readonly whenTrue: DraftGraphBlockTarget;
      readonly whenFalse: DraftGraphBlockTarget;
      readonly origin: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "switch";
      readonly scrutinee: ProofMirCanonicalKey;
      readonly cases: readonly DraftGraphSwitchCase[];
      readonly fallback?: DraftGraphBlockTarget;
      readonly origin: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "unreachable";
      readonly reason: string;
      readonly origin: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "matchValidation";
      readonly validationId: MonoInstantiatedProofId<ValidationId>;
      readonly okTarget: DraftGraphBlockTarget;
      readonly errTarget: DraftGraphBlockTarget;
      readonly okBindings: readonly DraftGraphValidationArmBinding[];
      readonly errBindings: readonly DraftGraphValidationArmBinding[];
      readonly origin: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "matchAttempt";
      readonly match: {
        readonly attemptId: MonoInstantiatedProofId<AttemptId>;
        readonly successTarget: DraftGraphBlockTarget;
        readonly errorTarget: DraftGraphBlockTarget;
        readonly inputPlaceKeys: readonly ProofMirCanonicalKey[];
        readonly origin: ProofMirCanonicalKey;
      };
      readonly origin: ProofMirCanonicalKey;
    };

export interface DraftGraphValidationArmBinding {
  readonly monoLocalIdKey?: ProofMirCanonicalKey;
  readonly bindingKind: "packet" | "payload" | "error";
  readonly operandValueKey?: ProofMirCanonicalKey;
  readonly operandPlaceKey?: ProofMirCanonicalKey;
  readonly operandType?: MonoCheckedType;
  readonly origin: ProofMirCanonicalKey;
}

export interface DraftGraphBlockParameter {
  readonly valueKey: ProofMirCanonicalKey;
  readonly role: string;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftGraphStatement {
  readonly key: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftGraphBlockView {
  readonly key: ProofMirCanonicalKey;
  readonly role: string;
  readonly scopeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly parameters: readonly DraftGraphBlockParameter[];
  readonly statements: readonly DraftGraphStatement[];
  readonly terminator?: DraftGraphTerminator;
  readonly stateMerge?: DraftGraphBlockStateMerge;
  readonly finalized: boolean;
}

export interface DraftGraphEdgeView {
  readonly key: ProofMirCanonicalKey;
  readonly kind: DraftGraphControlEdgeKind;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey?: ProofMirCanonicalKey;
  readonly factKeys: readonly ProofMirCanonicalKey[];
  readonly effects: readonly DraftGraphEdgeEffect[];
  readonly argumentKeys: readonly ProofMirCanonicalKey[];
  readonly sourceScopeKey: ProofMirCanonicalKey;
  readonly targetScopeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly exitKey?: ProofMirCanonicalKey;
}

export interface CreateDraftGraphBuilderInput {
  readonly functionInstanceId: MonoInstanceId;
}

export interface DraftGraphBuilder {
  allocateSyntheticOrigin(note: string): ProofMirCanonicalKey;
  allocateRequirementFactKey(authorityKey: string): ProofMirCanonicalKey;
  rootScopeKey(): ProofMirCanonicalKey;
  createScope(input: {
    readonly role: string;
    readonly parentScopeKey?: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  createBlock(input: {
    readonly role: string;
    readonly scope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly sourceOrigin?: string;
  }): ProofMirCanonicalKey;
  block(blockKey: ProofMirCanonicalKey): DraftGraphBlockView;
  blockParameters(blockKey: ProofMirCanonicalKey): readonly DraftGraphBlockParameter[];
  addBlockParameter(
    blockKey: ProofMirCanonicalKey,
    input: {
      readonly valueKey: ProofMirCanonicalKey;
      readonly role: string;
      readonly origin: ProofMirCanonicalKey;
    },
  ): DraftGraphBuilderResult;
  addStatement(
    blockKey: ProofMirCanonicalKey,
    input: {
      readonly origin: ProofMirCanonicalKey;
    },
  ): ProofMirCanonicalKey;
  setTerminator(
    blockKey: ProofMirCanonicalKey,
    terminator: DraftGraphTerminator,
  ): DraftGraphBuilderResult;
  setBlockStateMerge(
    blockKey: ProofMirCanonicalKey,
    stateMerge: DraftGraphBlockStateMerge,
  ): DraftGraphBuilderResult;
  finalizeBlock(blockKey: ProofMirCanonicalKey): DraftGraphBuilderResult;
  createNormalEdge(input: {
    readonly role?: string;
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly factKeys?: readonly ProofMirCanonicalKey[];
    readonly effects?: readonly DraftGraphEdgeEffect[];
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
    readonly effects?: readonly DraftGraphEdgeEffect[];
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
  }): ProofMirCanonicalKey;
  createSwitchEdge(input: {
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly factKeys?: readonly ProofMirCanonicalKey[];
    readonly effects?: readonly DraftGraphEdgeEffect[];
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
    readonly effects?: readonly DraftGraphEdgeEffect[];
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
    readonly effects?: readonly DraftGraphEdgeEffect[];
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
    readonly closure: Extract<DraftProofMirExitClosurePolicy, { readonly kind: "scopeExit" }>;
  }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey };
  createPanicExit(input: {
    readonly fromBlock: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
  }): { readonly edge: ProofMirCanonicalKey; readonly exit: ProofMirCanonicalKey };
  edge(edgeKey: ProofMirCanonicalKey): DraftGraphEdgeView;
  createValue(input: {
    readonly role: string;
    readonly origin: ProofMirCanonicalKey;
    readonly type?: MonoCheckedType;
    readonly resourceKind?: ConcreteResourceKind;
    readonly representation?: ProofMirValueRepresentation;
  }): ProofMirCanonicalKey;
  createLocal(input: {
    readonly monoLocalId: Parameters<typeof draftLocalKey>[0]["monoLocalId"];
    readonly name: string;
    readonly origin: ProofMirCanonicalKey;
    readonly scopeKey?: ProofMirCanonicalKey;
    readonly type?: MonoCheckedType;
    readonly resourceKind?: ConcreteResourceKind;
    readonly storage?: ProofMirLocalStorageKind;
    readonly backingPlaceKey?: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  createPlace(input: {
    readonly monoPlaceCanonicalKey: string;
    readonly origin: ProofMirCanonicalKey;
    readonly root?: DraftProofMirPlaceRoot;
    readonly projection?: readonly DraftProofMirPlaceProjection[];
    readonly type?: MonoCheckedType;
    readonly resourceKind?: ConcreteResourceKind;
  }): ProofMirCanonicalKey;
  acceptStructuredPlace(place: DraftProofMirStructuredPlace): void;
  functionDraft(): DraftProofMirFunctionDraft;
  recordLoweredStatement(
    blockKey: ProofMirCanonicalKey,
    statement: DraftProofMirGraphStatementSnapshot,
  ): void;
  finalizeBlocksMissingTerminators(): DraftGraphBuilderResult;
  exportGraphSnapshot(): DraftProofMirGraphSnapshot;
  diagnostics(): readonly ProofMirDiagnostic[];
}

interface DraftGraphBlockState {
  readonly key: ProofMirCanonicalKey;
  readonly role: string;
  readonly scopeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly sourceOrigin: string;
  parameters: DraftGraphBlockParameter[];
  statements: DraftGraphStatement[];
  terminator?: DraftGraphTerminator;
  stateMerge?: DraftGraphBlockStateMerge;
  finalized: boolean;
}

export interface DraftGraphEdgeState {
  readonly key: ProofMirCanonicalKey;
  readonly kind: DraftGraphControlEdgeKind;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey?: ProofMirCanonicalKey;
  readonly factKeys: readonly ProofMirCanonicalKey[];
  readonly effects: readonly DraftGraphEdgeEffect[];
  readonly argumentKeys: readonly ProofMirCanonicalKey[];
  readonly sourceScopeKey: ProofMirCanonicalKey;
  readonly targetScopeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly exitKey?: ProofMirCanonicalKey;
}

function ownerKey(functionInstanceId: MonoInstanceId): string {
  return `function:${String(functionInstanceId)}`;
}

function sourceOriginForBlock(
  role: string,
  origin: ProofMirCanonicalKey,
  sourceOrigin?: string,
): string {
  return sourceOrigin ?? `synthetic:${role}:${String(origin)}`;
}

export function createDraftGraphBuilder(input: CreateDraftGraphBuilderInput): DraftGraphBuilder {
  const functionInstanceId = input.functionInstanceId;
  const draft = createEmptyDraftProofMirFunctionDraft(functionInstanceId);
  const diagnostics: ProofMirDiagnostic[] = [];
  const blocks = new Map<ProofMirCanonicalKey, DraftGraphBlockState>();
  const edges = new Map<ProofMirCanonicalKey, DraftGraphEdgeState>();
  const exitStates = new Map<ProofMirCanonicalKey, DraftProofMirGraphExitSnapshot>();
  const loweredStatementsByBlock = new Map<
    ProofMirCanonicalKey,
    DraftProofMirGraphStatementSnapshot[]
  >();
  const rootScopeKeyValue = draftScopeKey({ functionInstanceId, role: "function" });
  const normalEdgeCounter = { value: 0 };
  const switchCaseCounter = { value: 0 };
  const nextSyntheticMonoStatement = { value: 1 };

  function hasPlaceWithCanonicalKey(monoPlaceCanonicalKey: string): boolean {
    return draft.places
      .entries()
      .some((entry) => entry.monoPlaceCanonicalKey === monoPlaceCanonicalKey);
  }

  function recordDiagnostic(diagnostic: ProofMirDiagnostic): void {
    diagnostics.push(diagnostic);
  }

  function propagateAcceptResult(
    result: DraftProofMirCanonicalTableAcceptResult,
  ): DraftGraphBuilderResult {
    if (result.kind === "error") {
      for (const diagnostic of result.diagnostics) {
        recordDiagnostic(diagnostic);
      }
      return errorResult(result.diagnostics);
    }
    return okResult();
  }

  function acceptOrigin(originKey: ProofMirCanonicalKey, note?: string): DraftGraphBuilderResult {
    if (draft.origins.has(originKey)) {
      return okResult();
    }
    return propagateAcceptResult(
      draft.origins.accept({
        key: originKey,
        ownerKey: ownerKey(functionInstanceId),
        note,
      }),
    );
  }

  function requireBlock(blockKey: ProofMirCanonicalKey): DraftGraphBlockState | undefined {
    return blocks.get(blockKey);
  }

  const edgeBuilders = createDraftGraphEdgeBuilders({
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
  });

  const rootFunctionOriginKey = draftOriginKey({
    owner: { kind: "function", functionInstanceId },
    note: "function:root",
  });
  propagateAcceptResult(
    draft.scopes.accept({
      key: rootScopeKeyValue,
      functionInstanceId,
      role: "function",
      originKey: rootFunctionOriginKey,
    }),
  );
  acceptOrigin(rootFunctionOriginKey, "function:root");

  return {
    allocateSyntheticOrigin(note: string): ProofMirCanonicalKey {
      const originKey = draftOriginKey({
        owner: { kind: "function", functionInstanceId },
        note,
      });
      acceptOrigin(originKey, note);
      return originKey;
    },

    allocateRequirementFactKey(authorityKey: string): ProofMirCanonicalKey {
      return draftFactKey({
        role: "requirement",
        kind: "validatedBufferBinding",
        authorityKey,
      });
    },

    rootScopeKey(): ProofMirCanonicalKey {
      return rootScopeKeyValue;
    },

    createScope(input: {
      readonly role: string;
      readonly parentScopeKey?: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
    }): ProofMirCanonicalKey {
      const scopeKey = draftScopeKey({
        functionInstanceId,
        role: input.role,
        parentScopeKey: input.parentScopeKey,
      });
      propagateAcceptResult(
        draft.scopes.accept({
          key: scopeKey,
          functionInstanceId,
          role: input.role,
          parentScopeKey: input.parentScopeKey,
          originKey: input.origin,
        }),
      );
      acceptOrigin(input.origin);
      return scopeKey;
    },

    createBlock(input: {
      readonly role: string;
      readonly scope: ProofMirCanonicalKey;
      readonly origin: ProofMirCanonicalKey;
      readonly sourceOrigin?: string;
    }): ProofMirCanonicalKey {
      const sourceOrigin = sourceOriginForBlock(input.role, input.origin, input.sourceOrigin);
      const blockKey = draftBlockKey({
        functionInstanceId,
        role: input.role,
        sourceOrigin,
      });
      propagateAcceptResult(
        draft.blocks.accept({
          key: blockKey,
          functionInstanceId,
          role: input.role,
          sourceOrigin,
          scopeKey: input.scope,
          originKey: input.origin,
        }),
      );
      acceptOrigin(input.origin);
      blocks.set(blockKey, {
        key: blockKey,
        role: input.role,
        scopeKey: input.scope,
        originKey: input.origin,
        sourceOrigin,
        parameters: [],
        statements: [],
        finalized: false,
      });
      return blockKey;
    },

    block(blockKey: ProofMirCanonicalKey): DraftGraphBlockView {
      const block = blocks.get(blockKey);
      if (block === undefined) {
        throw new RangeError(`Unknown draft graph block key: ${String(blockKey)}.`);
      }
      return {
        key: block.key,
        role: block.role,
        scopeKey: block.scopeKey,
        originKey: block.originKey,
        parameters: block.parameters.slice(),
        statements: block.statements.slice(),
        terminator: block.terminator,
        finalized: block.finalized,
      };
    },

    blockParameters(blockKey: ProofMirCanonicalKey): readonly DraftGraphBlockParameter[] {
      return this.block(blockKey).parameters;
    },

    addBlockParameter(
      blockKey: ProofMirCanonicalKey,
      input: {
        readonly valueKey: ProofMirCanonicalKey;
        readonly role: string;
        readonly origin: ProofMirCanonicalKey;
      },
    ): DraftGraphBuilderResult {
      const block = requireBlock(blockKey);
      if (block === undefined) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_CFG",
            message: "Cannot add block parameter to an unknown block.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "unknown-block",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      if (block.finalized) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_CFG",
            message: "Cannot add block parameter to a finalized block.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "finalized-block",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      block.parameters.push({
        valueKey: input.valueKey,
        role: input.role,
        originKey: input.origin,
      });
      acceptOrigin(input.origin);
      return okResult();
    },

    addStatement(
      blockKey: ProofMirCanonicalKey,
      input: {
        readonly origin: ProofMirCanonicalKey;
      },
    ): ProofMirCanonicalKey {
      const block = requireBlock(blockKey);
      if (block === undefined) {
        throw new RangeError(`Unknown draft graph block key: ${String(blockKey)}.`);
      }
      if (block.terminator !== undefined) {
        throw new RangeError(
          `Cannot add statement after terminator on draft graph block: ${String(blockKey)}.`,
        );
      }
      const monoStatementId = instantiatedHirId(
        functionInstanceId,
        hirStatementId(nextSyntheticMonoStatement.value++),
      );
      const statementKey = draftStatementKey({
        functionInstanceId,
        monoStatementId,
      });
      propagateAcceptResult(
        draft.statements.accept({
          key: statementKey,
          functionInstanceId,
          blockKey,
          originKey: input.origin,
        }),
      );
      acceptOrigin(input.origin);
      block.statements.push({
        key: statementKey,
        originKey: input.origin,
      });
      return statementKey;
    },

    setTerminator(
      blockKey: ProofMirCanonicalKey,
      terminator: DraftGraphTerminator,
    ): DraftGraphBuilderResult {
      const block = requireBlock(blockKey);
      if (block === undefined) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_CFG",
            message: "Cannot set terminator on an unknown block.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "unknown-block",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      if (block.finalized) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_CFG",
            message: "Cannot set terminator on a finalized block.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "finalized-block",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      if (block.terminator !== undefined) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_CFG",
            message: "Cannot replace an existing block terminator.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "duplicate-terminator",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      block.terminator = terminator;
      acceptOrigin(terminator.origin);
      return okResult();
    },

    setBlockStateMerge(
      blockKey: ProofMirCanonicalKey,
      stateMerge: DraftGraphBlockStateMerge,
    ): DraftGraphBuilderResult {
      return setDraftGraphBlockStateMerge({
        block: requireBlock(blockKey),
        blockKey,
        stateMerge,
        functionInstanceId,
        acceptOrigin,
      });
    },

    finalizeBlock(blockKey: ProofMirCanonicalKey): DraftGraphBuilderResult {
      const block = requireBlock(blockKey);
      if (block === undefined) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_CFG",
            message: "Cannot finalize an unknown block.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "unknown-block",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      if (block.finalized) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_CFG",
            message: "Cannot finalize a block twice.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "duplicate-finalize",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      if (block.terminator === undefined) {
        return errorResult([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_MISSING_TERMINATOR_ID",
            message: "Cannot finalize a block without a terminator.",
            ownerKey: ownerKey(functionInstanceId),
            rootCauseKey: "missing-terminator",
            stableDetail: String(blockKey),
            functionInstanceId,
          }),
        ]);
      }
      const terminatorKey = draftTerminatorKey({ functionInstanceId, blockKey });
      const acceptResult = draft.terminators.accept({
        key: terminatorKey,
        functionInstanceId,
        blockKey,
        originKey: block.terminator.origin,
      });
      if (acceptResult.kind === "error") {
        return propagateAcceptResult(acceptResult);
      }
      block.finalized = true;
      return okResult();
    },

    ...edgeBuilders,

    createValue(input: {
      readonly role: string;
      readonly origin: ProofMirCanonicalKey;
      readonly type?: MonoCheckedType;
      readonly resourceKind?: ConcreteResourceKind;
      readonly representation?: ProofMirValueRepresentation;
    }): ProofMirCanonicalKey {
      const valueKey = draftValueKey({ functionInstanceId, role: input.role });
      propagateAcceptResult(
        draft.values.accept({
          key: valueKey,
          functionInstanceId,
          role: input.role,
          originKey: input.origin,
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.resourceKind === undefined ? {} : { resourceKind: input.resourceKind }),
          ...(input.representation === undefined ? {} : { representation: input.representation }),
        }),
      );
      acceptOrigin(input.origin);
      return valueKey;
    },

    createLocal(input: {
      readonly monoLocalId: Parameters<typeof draftLocalKey>[0]["monoLocalId"];
      readonly name: string;
      readonly origin: ProofMirCanonicalKey;
      readonly scopeKey?: ProofMirCanonicalKey;
      readonly type?: MonoCheckedType;
      readonly resourceKind?: ConcreteResourceKind;
      readonly storage?: ProofMirLocalStorageKind;
      readonly backingPlaceKey?: ProofMirCanonicalKey;
    }): ProofMirCanonicalKey {
      const localKey = draftLocalKey({
        functionInstanceId,
        monoLocalId: input.monoLocalId,
      });
      if (draft.locals.has(localKey)) {
        return localKey;
      }
      propagateAcceptResult(
        draft.locals.accept({
          key: localKey,
          functionInstanceId,
          name: input.name,
          originKey: input.origin,
          ...(input.scopeKey === undefined ? {} : { scopeKey: input.scopeKey }),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.resourceKind === undefined ? {} : { resourceKind: input.resourceKind }),
          ...(input.storage === undefined ? {} : { storage: input.storage }),
          ...(input.backingPlaceKey === undefined
            ? {}
            : { backingPlaceKey: input.backingPlaceKey }),
        }),
      );
      acceptOrigin(input.origin);
      return localKey;
    },

    createPlace(input: {
      readonly monoPlaceCanonicalKey: string;
      readonly origin: ProofMirCanonicalKey;
      readonly root?: DraftProofMirPlaceRoot;
      readonly projection?: readonly DraftProofMirPlaceProjection[];
      readonly type?: MonoCheckedType;
      readonly resourceKind?: ConcreteResourceKind;
    }): ProofMirCanonicalKey {
      const placeKey = draftPlaceKey({
        functionInstanceId,
        monoPlaceCanonicalKey: input.monoPlaceCanonicalKey,
      });
      if (draft.places.has(placeKey) || hasPlaceWithCanonicalKey(input.monoPlaceCanonicalKey)) {
        return placeKey;
      }
      propagateAcceptResult(
        draft.places.accept({
          key: placeKey,
          functionInstanceId,
          monoPlaceCanonicalKey: input.monoPlaceCanonicalKey,
          originKey: input.origin,
          ...(input.root === undefined ? {} : { root: input.root }),
          ...(input.projection === undefined ? {} : { projection: input.projection }),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.resourceKind === undefined ? {} : { resourceKind: input.resourceKind }),
        }),
      );
      acceptOrigin(input.origin);
      return placeKey;
    },

    acceptStructuredPlace(place: DraftProofMirStructuredPlace): void {
      if (place.functionInstanceId !== functionInstanceId) {
        return;
      }
      const monoPlaceCanonicalKey =
        place.monoPlaceCanonicalKey ?? `structured:${String(place.key)}`;
      const canonicalPlaceKey = draftPlaceKey({
        functionInstanceId,
        monoPlaceCanonicalKey,
      });
      if (
        draft.places.has(place.key) ||
        draft.places.has(canonicalPlaceKey) ||
        hasPlaceWithCanonicalKey(monoPlaceCanonicalKey)
      ) {
        return;
      }
      propagateAcceptResult(
        draft.places.accept({
          key: place.key,
          functionInstanceId,
          monoPlaceCanonicalKey,
          originKey: place.originKey,
          root: place.root,
          projection: [...place.projection],
          ...(place.type === undefined ? {} : { type: place.type }),
          ...(place.resourceKind === undefined ? {} : { resourceKind: place.resourceKind }),
        }),
      );
      acceptOrigin(place.originKey);
    },

    functionDraft(): DraftProofMirFunctionDraft {
      return draft;
    },

    recordLoweredStatement(
      blockKey: ProofMirCanonicalKey,
      statement: DraftProofMirGraphStatementSnapshot,
    ): void {
      const current = loweredStatementsByBlock.get(blockKey) ?? [];
      current.push(statement);
      loweredStatementsByBlock.set(blockKey, current);
    },

    finalizeBlocksMissingTerminators(): DraftGraphBuilderResult {
      for (const block of blocks.values()) {
        if (block.terminator !== undefined) {
          continue;
        }
        const setTerminatorResult = this.setTerminator(block.key, {
          kind: "unreachable",
          reason: "unreachableSource",
          origin: block.originKey,
        });
        if (setTerminatorResult.kind === "error") {
          return setTerminatorResult;
        }
      }
      return okResult();
    },

    exportGraphSnapshot(): DraftProofMirGraphSnapshot {
      return exportDraftGraphSnapshot({
        blocks: blocks.values(),
        edges: edges.values(),
        exits: exitStates.values(),
        loweredStatementsByBlock,
      });
    },

    diagnostics(): readonly ProofMirDiagnostic[] {
      return sortProofMirDiagnostics(diagnostics);
    },
  };
}
