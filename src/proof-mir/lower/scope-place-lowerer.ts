import { instantiatedHirIdKey, type MonoInstanceId } from "../../mono/ids";
import type {
  MonoAttempt,
  MonoBlock,
  MonoExpression,
  MonoInstantiatedProofId,
  MonoMatchArm,
  MonoResourcePlace,
  MonoStatement,
  MonoValidation,
} from "../../mono/mono-hir";
import type { ValidationId } from "../../hir/ids";
import { walkMonoExpression, walkMonoStatement } from "../../mono/body-walker";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { type ProofMirDiagnostic } from "../diagnostics";
import { draftOriginKey } from "../draft/draft-keys";
import type { ProofMirLayoutBindingIndex } from "../domains/layout-binding-index";
import {
  createProofMirDraftScopeTree,
  createProofMirEffectsResources,
  sortDraftResourceBoundarySet,
  type DraftProofMirObligationReference,
  type DraftProofMirPlaceProjection,
  type DraftProofMirPlaceRoot,
  type DraftProofMirPrivateStateGenerationReference,
  type DraftProofMirResourceBoundarySet,
  type DraftProofMirSessionMemberReference,
  type DraftProofMirStructuredPlace,
  type ProofMirDraftScopeTree,
  type ProofMirEffectsResources,
} from "../domains/effects-resources";
import { type ProofMirOriginMap } from "../domains/origin-map";
import type { ProofMirLayoutReference } from "../model/layout-bindings";
import type { FieldId } from "../../semantic/ids";

export type ProofMirLoweringResult<Value> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export type ProofMirScopeKind =
  | "function"
  | "block"
  | "loop"
  | "matchArm"
  | "validationArm"
  | "attemptArm"
  | "take";

export interface ProofMirScopeEntry {
  readonly role: string;
  readonly kind: ProofMirScopeKind;
  readonly parentRole?: string;
  readonly originKey: ProofMirCanonicalKey;
}

export interface LoweredProofMirPlaceProjection {
  readonly kind: DraftProofMirPlaceProjection["kind"];
  readonly fieldId?: FieldId;
  readonly name?: string;
  readonly validationId?: MonoInstantiatedProofId<ValidationId>;
  readonly layout?: ProofMirLayoutReference;
  readonly projection: DraftProofMirPlaceProjection;
}

export interface LoweredProofMirPlace {
  readonly placeKey: ProofMirCanonicalKey;
  readonly root: DraftProofMirPlaceRoot;
  readonly projections: readonly LoweredProofMirPlaceProjection[];
  readonly monoPlaceCanonicalKey?: string;
  readonly originKey: ProofMirCanonicalKey;
}

export interface ProofMirFunctionScopePlaceLowerer {
  readonly functionInstanceId: MonoInstanceId;
  readonly scopeTree: ProofMirDraftScopeTree;
  readonly scopeEntries: readonly ProofMirScopeEntry[];
  readonly effectsResources: ProofMirEffectsResources;
  scopeKind(role: string): ProofMirScopeKind | undefined;
  allocateSyntheticOrigin(note: string): ProofMirCanonicalKey;
  lowerMonoPlace(input: {
    readonly monoPlace: MonoResourcePlace;
    readonly originKey: ProofMirCanonicalKey;
    readonly layoutReferences?: readonly (ProofMirLayoutReference | undefined)[];
  }): ProofMirLoweringResult<LoweredProofMirPlace>;
  collectLoopBoundarySet(input: {
    readonly loopRole: string;
    readonly places: readonly ProofMirCanonicalKey[];
    readonly loans?: readonly ProofMirCanonicalKey[];
    readonly obligations?: readonly DraftProofMirObligationReference[];
    readonly sessionMembers?: readonly DraftProofMirSessionMemberReference[];
    readonly privateStateGenerations?: readonly DraftProofMirPrivateStateGenerationReference[];
  }): DraftProofMirResourceBoundarySet;
}

export interface CreateProofMirScopePlaceLowererInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
  readonly originMap: ProofMirOriginMap;
  readonly layoutBindingIndex?: ProofMirLayoutBindingIndex;
  readonly effectsResources?: ProofMirEffectsResources;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function statementRolePrefix(statementId: MonoStatement["statementId"]): string {
  return `stmt:${instantiatedHirIdKey(statementId)}`;
}

function expressionRolePrefix(expressionId: MonoExpression["expressionId"]): string {
  return `expr:${instantiatedHirIdKey(expressionId)}`;
}

function originForStatement(
  originMap: ProofMirOriginMap,
  functionInstanceId: MonoInstanceId,
  statement: MonoStatement,
): ProofMirCanonicalKey {
  return originMap.fromMonoStatement({
    owner: { kind: "function", functionInstanceId },
    sourceOrigin: statement.sourceOrigin,
    monoStatementId: statement.statementId,
  });
}

function originForArm(
  originMap: ProofMirOriginMap,
  functionInstanceId: MonoInstanceId,
  arm: MonoMatchArm,
): ProofMirCanonicalKey {
  return originMap.fromHirOrigin({
    owner: { kind: "function", functionInstanceId },
    sourceOrigin: arm.sourceOrigin,
  });
}

function originForValidation(
  originMap: ProofMirOriginMap,
  functionInstanceId: MonoInstanceId,
  validation: MonoValidation,
): ProofMirCanonicalKey {
  return originMap.fromMonoProof({
    owner: { kind: "function", functionInstanceId },
    sourceOrigin: validation.sourceOrigin,
    monoProofId: validation.validationId,
  });
}

function originForAttempt(
  originMap: ProofMirOriginMap,
  functionInstanceId: MonoInstanceId,
  attempt: MonoAttempt,
): ProofMirCanonicalKey {
  return originMap.fromMonoProof({
    owner: { kind: "function", functionInstanceId },
    sourceOrigin: attempt.sourceOrigin,
    monoProofId: attempt.attemptId,
  });
}

function pushScope(entries: ProofMirScopeEntry[], entry: ProofMirScopeEntry): void {
  entries.push(entry);
}

function collectScopeEntries(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
  readonly originMap: ProofMirOriginMap;
}): ProofMirScopeEntry[] {
  const entries: ProofMirScopeEntry[] = [];
  const functionOrigin = draftOriginKey({
    owner: { kind: "function", functionInstanceId: input.functionInstanceId },
    note: "function:root",
  });
  pushScope(entries, {
    role: "function",
    kind: "function",
    originKey: functionOrigin,
  });

  function walkBlock(block: MonoBlock, parentRole: string, blockRole?: string): void {
    const currentRole = blockRole ?? parentRole;
    if (blockRole !== undefined) {
      pushScope(entries, {
        role: blockRole,
        kind: "block",
        parentRole,
        originKey: draftOriginKey({
          owner: { kind: "function", functionInstanceId: input.functionInstanceId },
          note: blockRole,
        }),
      });
    }
    for (const statement of block.statements) {
      walkStatement(statement, currentRole);
    }
  }

  function walkStatement(statement: MonoStatement, parentRole: string): void {
    const stmtPrefix = statementRolePrefix(statement.statementId);
    const statementOrigin = originForStatement(
      input.originMap,
      input.functionInstanceId,
      statement,
    );

    switch (statement.kind.kind) {
      case "block": {
        const role = `block:${stmtPrefix}`;
        walkBlock(statement.kind.block, parentRole, role);
        return;
      }
      case "if": {
        walkMonoExpression(statement.kind.statement.condition, {});
        const thenRole = `block:${stmtPrefix}:then`;
        pushScope(entries, {
          role: thenRole,
          kind: "block",
          parentRole,
          originKey: statementOrigin,
        });
        walkBlock(statement.kind.statement.thenBlock, thenRole);
        if (statement.kind.statement.elseBlock !== undefined) {
          const elseRole = `block:${stmtPrefix}:else`;
          pushScope(entries, {
            role: elseRole,
            kind: "block",
            parentRole,
            originKey: statementOrigin,
          });
          walkBlock(statement.kind.statement.elseBlock, elseRole);
        }
        return;
      }
      case "while": {
        walkMonoExpression(statement.kind.statement.condition, {});
        const loopRole = `loop:${stmtPrefix}`;
        pushScope(entries, {
          role: loopRole,
          kind: "loop",
          parentRole,
          originKey: statementOrigin,
        });
        walkBlock(statement.kind.statement.body, loopRole);
        return;
      }
      case "loop": {
        const loopRole = `loop:${stmtPrefix}`;
        pushScope(entries, {
          role: loopRole,
          kind: "loop",
          parentRole,
          originKey: statementOrigin,
        });
        walkBlock(statement.kind.body, loopRole);
        return;
      }
      case "for": {
        const loopRole = `loop:${stmtPrefix}`;
        pushScope(entries, {
          role: loopRole,
          kind: "loop",
          parentRole,
          originKey: statementOrigin,
        });
        walkMonoExpression(statement.kind.statement.iterable, {});
        walkBlock(statement.kind.statement.body, loopRole);
        return;
      }
      case "match": {
        walkMonoExpression(statement.kind.statement.scrutinee, {});
        for (const [index, arm] of statement.kind.statement.arms.entries()) {
          const armRole = `matchArm:${stmtPrefix}:${index}`;
          pushScope(entries, {
            role: armRole,
            kind: "matchArm",
            parentRole,
            originKey: originForArm(input.originMap, input.functionInstanceId, arm),
          });
          walkBlock(arm.body, armRole);
        }
        return;
      }
      case "validationMatch": {
        walkMonoExpression(statement.kind.statement.scrutinee, {});
        if (statement.kind.statement.validation !== undefined) {
          walkMonoValidation(statement.kind.statement.validation, input, entries, parentRole);
        }
        const validationOrigin =
          statement.kind.statement.validation === undefined
            ? statementOrigin
            : originForValidation(
                input.originMap,
                input.functionInstanceId,
                statement.kind.statement.validation,
              );
        for (const [suffix, arm] of [
          ["ok", statement.kind.statement.okArm],
          ["err", statement.kind.statement.errArm],
        ] as const) {
          if (arm === undefined) continue;
          const armRole = `validationArm:${stmtPrefix}:${suffix}`;
          pushScope(entries, {
            role: armRole,
            kind: "validationArm",
            parentRole,
            originKey: originForArm(input.originMap, input.functionInstanceId, arm),
          });
          walkBlock(arm.body, armRole);
        }
        if (statement.kind.statement.validation !== undefined) {
          void validationOrigin;
        }
        return;
      }
      case "take": {
        const takeRole = `take:${stmtPrefix}`;
        pushScope(entries, {
          role: takeRole,
          kind: "take",
          parentRole,
          originKey: statementOrigin,
        });
        walkMonoTake(statement.kind.statement, input, entries, parentRole);
        walkBlock(statement.kind.statement.body, takeRole);
        return;
      }
      case "let":
      case "assignment":
      case "return":
      case "yield":
      case "expression":
      case "break":
      case "continue":
      case "error":
        walkMonoStatement(statement, {
          expression(expression) {
            walkExpression(expression, parentRole);
          },
        });
        return;
      default: {
        const unreachable: never = statement.kind;
        return unreachable;
      }
    }
  }

  function walkExpression(expression: MonoExpression, parentRole: string): void {
    if (expression.kind.kind === "attempt") {
      walkAttemptFromAttempt(expression.kind.attempt, parentRole);
      return;
    }
    walkMonoExpression(expression, {
      attempt(attempt) {
        walkAttemptFromAttempt(attempt, parentRole);
      },
    });
  }

  function walkAttemptFromAttempt(attempt: MonoAttempt, parentRole: string): void {
    const exprPrefix = expressionRolePrefix(attempt.attemptExpressionId);
    const attemptOrigin = originForAttempt(input.originMap, input.functionInstanceId, attempt);
    const fallibleRole = `attemptArm:${exprPrefix}:fallible`;
    pushScope(entries, {
      role: fallibleRole,
      kind: "attemptArm",
      parentRole,
      originKey: attemptOrigin,
    });
    walkExpression(attempt.fallibleExpression, fallibleRole);
    if (attempt.alternativeExpression !== undefined) {
      const alternativeRole = `attemptArm:${exprPrefix}:alternative`;
      pushScope(entries, {
        role: alternativeRole,
        kind: "attemptArm",
        parentRole,
        originKey: attemptOrigin,
      });
      walkExpression(attempt.alternativeExpression, alternativeRole);
    }
  }

  walkBlock(input.body, "function");
  return entries;
}

function walkMonoValidation(
  validation: MonoValidation,
  input: { readonly functionInstanceId: MonoInstanceId; readonly originMap: ProofMirOriginMap },
  _entries: ProofMirScopeEntry[],
  _parentRole: string,
): void {
  void validation;
  void input;
}

function walkMonoTake(
  _statement: { readonly operand: unknown; readonly takeKind: unknown },
  _input: { readonly functionInstanceId: MonoInstanceId; readonly originMap: ProofMirOriginMap },
  _entries: ProofMirScopeEntry[],
  _parentRole: string,
): void {}

function projectionView(
  projection: DraftProofMirPlaceProjection,
  layout?: ProofMirLayoutReference,
): LoweredProofMirPlaceProjection {
  switch (projection.kind) {
    case "field":
      return {
        kind: "field",
        fieldId: projection.fieldId,
        layout,
        projection,
      };
    case "deref":
      return { kind: "deref", layout, projection };
    case "variant":
      return { kind: "variant", name: projection.name, layout, projection };
    case "validatedPacketPayload":
      return {
        kind: "validatedPacketPayload",
        validationId: projection.validationId,
        layout,
        projection,
      };
    case "imageDevice":
      return {
        kind: "imageDevice",
        fieldId: projection.fieldId,
        layout,
        projection,
      };
    default: {
      const unreachable: never = projection;
      return unreachable;
    }
  }
}

function toLoweredPlace(
  structured: DraftProofMirStructuredPlace,
  layoutReferences?: readonly (ProofMirLayoutReference | undefined)[],
): LoweredProofMirPlace {
  return {
    placeKey: structured.key,
    root: structured.root,
    monoPlaceCanonicalKey: structured.monoPlaceCanonicalKey,
    originKey: structured.originKey,
    projections: structured.projection.map((projection, index) =>
      projectionView(projection, layoutReferences?.[index]),
    ),
  };
}

function createScopePlaceLowererImpl(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly scopeEntries: readonly ProofMirScopeEntry[];
  readonly scopeTree: ProofMirDraftScopeTree;
  readonly effectsResources: ProofMirEffectsResources;
  readonly layoutBindingIndex?: ProofMirLayoutBindingIndex;
}): ProofMirFunctionScopePlaceLowerer {
  const scopeKindByRole = new Map(
    input.scopeEntries.map((entry) => [entry.role, entry.kind] as const),
  );

  return {
    functionInstanceId: input.functionInstanceId,
    scopeTree: input.scopeTree,
    scopeEntries: input.scopeEntries,
    effectsResources: input.effectsResources,

    scopeKind(role: string): ProofMirScopeKind | undefined {
      return scopeKindByRole.get(role);
    },

    allocateSyntheticOrigin(note: string): ProofMirCanonicalKey {
      return draftOriginKey({
        owner: { kind: "function", functionInstanceId: input.functionInstanceId },
        note,
      });
    },

    lowerMonoPlace(placeInput) {
      const placeKey = input.effectsResources.placeFromMono({
        monoPlace: placeInput.monoPlace,
        originKey: placeInput.originKey,
      });
      const structured = input.effectsResources.draftPlace(placeKey);
      return loweringOk(toLoweredPlace(structured, placeInput.layoutReferences));
    },

    collectLoopBoundarySet(boundaryInput) {
      return sortDraftResourceBoundarySet({
        places: boundaryInput.places,
        loans: boundaryInput.loans ?? [],
        obligations: boundaryInput.obligations ?? [],
        sessionMembers: boundaryInput.sessionMembers ?? [],
        privateStateGenerations: boundaryInput.privateStateGenerations ?? [],
      });
    },
  };
}

export function createProofMirScopePlaceLowerer(
  input: CreateProofMirScopePlaceLowererInput,
): ProofMirLoweringResult<ProofMirFunctionScopePlaceLowerer> {
  const scopeEntries = collectScopeEntries({
    functionInstanceId: input.functionInstanceId,
    body: input.body,
    originMap: input.originMap,
  });
  const scopeTree = createProofMirDraftScopeTree({
    functionInstanceId: input.functionInstanceId,
    entries: scopeEntries.map((entry) => ({
      role: entry.role,
      ...(entry.parentRole === undefined ? {} : { parentRole: entry.parentRole }),
    })),
  });
  const effectsResources =
    input.effectsResources ??
    createProofMirEffectsResources({ functionInstanceId: input.functionInstanceId });

  return loweringOk(
    createScopePlaceLowererImpl({
      functionInstanceId: input.functionInstanceId,
      scopeEntries,
      scopeTree,
      effectsResources,
      ...(input.layoutBindingIndex === undefined
        ? {}
        : { layoutBindingIndex: input.layoutBindingIndex }),
    }),
  );
}
