import { walkMonoBlock } from "../../mono/body-walker";
import { instantiatedHirIdKey, type MonoInstanceId } from "../../mono/ids";
import type {
  MonoBlock,
  MonoBodyIndex,
  MonoCheckedType,
  MonoExpression,
  MonoFunctionInstance,
  MonoLocal,
  MonoLocalId,
  MonoPlaceRoot,
  MonoResourcePlace,
  MonoStatement,
} from "../../mono/mono-hir";
import {
  classifyProofMirLocalStorage,
  type ProofMirLocalStoragePreScanFact,
} from "../domains/effects-resources";
import type { ProofMirLocalStorageKind } from "../domains/effects-resources";
import type { ProofMirLocalClassifier as LoweringContextLocalClassifier } from "./lowering-context";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";

export interface ProofMirClassifiedLocal {
  readonly local: MonoLocal;
  readonly storage: ProofMirLocalStorageKind;
}

export interface ProofMirLocalClassification {
  local(name: string): ProofMirClassifiedLocal | undefined;
  localById(localId: MonoLocalId): ProofMirClassifiedLocal | undefined;
  entries(): readonly ProofMirClassifiedLocal[];
}

export interface ProofMirLocalClassifier {
  classification(): ProofMirLocalClassification;
  requireRecordedPlaceUse(input: {
    readonly localId: MonoLocalId;
    readonly use: "place" | "borrow";
    readonly sourceOrigin?: string;
    readonly nodeDetail?: string;
  }): ProofMirLocalClassifierResult<void>;
}

export type ProofMirLocalClassifierResult<Value> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface CreateProofMirLocalClassifierInput {
  readonly functionInstance: MonoFunctionInstance;
  readonly ownerKey?: string;
}

interface MutablePreScanFact {
  isCopyScalar: boolean;
  addressTaken: boolean;
  borrowed: boolean;
  projected: boolean;
  consumed: boolean;
  validatedBuffer: boolean;
  sessionBound: boolean;
  privateState: boolean;
  capability: boolean;
  aggregate: boolean;
}

interface MutablePreScanState {
  readonly fact: MutablePreScanFact;
  placeUseRecorded: boolean;
  borrowUseRecorded: boolean;
}

interface PreScanContext {
  readonly functionInstance: MonoFunctionInstance;
  readonly ownerKey: string;
  readonly factsByLocalId: Map<string, MutablePreScanState>;
  readonly localsByName: Map<string, MonoLocal>;
  readonly localsById: Map<string, MonoLocal>;
  readonly parameterLocalIds: Map<string, MonoLocalId>;
}

function compareMonoLocalIds(left: MonoLocalId, right: MonoLocalId): number {
  return instantiatedHirIdKey(left).localeCompare(instantiatedHirIdKey(right));
}

function isAggregateType(type: MonoCheckedType): boolean {
  return type.kind === "applied" && type.constructor.kind === "source";
}

function initialFactsFromLocal(local: MonoLocal): MutablePreScanFact {
  const isCopyScalar = local.resourceKind === "Copy";
  return {
    isCopyScalar,
    addressTaken: false,
    borrowed: false,
    projected: false,
    consumed: false,
    validatedBuffer: local.resourceKind === "ValidatedBuffer",
    sessionBound: local.resourceKind === "Stream",
    privateState: local.resourceKind === "PrivateState",
    capability:
      local.resourceKind === "SealedPlatformToken" || local.resourceKind === "UniqueEdgeRoot",
    aggregate: local.resourceKind === "EdgePath" || isAggregateType(local.type),
  };
}

function localIdKey(localId: MonoLocalId): string {
  return instantiatedHirIdKey(localId);
}

function stateForLocal(context: PreScanContext, localId: MonoLocalId): MutablePreScanState {
  const key = localIdKey(localId);
  const existing = context.factsByLocalId.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const local = context.localsById.get(key);
  const fact = local === undefined ? emptyCopyScalarFact() : initialFactsFromLocal(local);
  const created: MutablePreScanState = {
    fact,
    placeUseRecorded: false,
    borrowUseRecorded: false,
  };
  context.factsByLocalId.set(key, created);
  return created;
}

function emptyCopyScalarFact(): MutablePreScanFact {
  return {
    isCopyScalar: true,
    addressTaken: false,
    borrowed: false,
    projected: false,
    consumed: false,
    validatedBuffer: false,
    sessionBound: false,
    privateState: false,
    capability: false,
    aggregate: false,
  };
}

function localIdFromPlaceRoot(
  context: PreScanContext,
  root: MonoPlaceRoot,
): MonoLocalId | undefined {
  switch (root.kind) {
    case "local":
      return root.localId;
    case "parameter":
    case "receiver":
      return context.parameterLocalIds.get(String(root.parameterId));
    default:
      return undefined;
  }
}

function recordPlaceUse(context: PreScanContext, place: MonoResourcePlace): void {
  const localId = localIdFromPlaceRoot(context, place.root);
  if (localId === undefined) {
    return;
  }
  const state = stateForLocal(context, localId);
  state.placeUseRecorded = true;
  state.fact.addressTaken = true;
  if (place.projection.length > 0) {
    state.fact.projected = true;
  }
}

function recordBorrowUse(context: PreScanContext, localId: MonoLocalId): void {
  const state = stateForLocal(context, localId);
  state.borrowUseRecorded = true;
  state.fact.borrowed = true;
  state.fact.addressTaken = true;
}

function recordAssignmentTargetPlace(
  context: PreScanContext,
  assignment: {
    readonly target: MonoExpression;
    readonly targetPlace?: MonoResourcePlace;
  },
): void {
  if (assignment.targetPlace === undefined) {
    return;
  }
  const localId = localIdFromPlaceRoot(context, assignment.targetPlace.root);
  if (localId === undefined) {
    recordPlaceUse(context, assignment.targetPlace);
    return;
  }
  const local = context.localsById.get(localIdKey(localId));
  if (
    local?.resourceKind === "Copy" &&
    assignment.targetPlace.projection.length === 0 &&
    assignment.target.kind.kind === "name" &&
    assignment.target.kind.localId !== undefined &&
    instantiatedHirIdKey(assignment.target.kind.localId) === localIdKey(localId)
  ) {
    return;
  }
  recordPlaceUse(context, assignment.targetPlace);
}

function recordConsumeUse(context: PreScanContext, localId: MonoLocalId): void {
  const state = stateForLocal(context, localId);
  state.fact.consumed = true;
  state.placeUseRecorded = true;
}

function localIdFromExpression(
  context: PreScanContext,
  expression: MonoExpression,
): MonoLocalId | undefined {
  if (expression.kind.kind !== "name" || expression.kind.localId === undefined) {
    return undefined;
  }
  return expression.kind.localId;
}

function recordBorrowFromOperand(context: PreScanContext, operand: MonoExpression): void {
  if (operand.place !== undefined) {
    recordPlaceUse(context, operand.place);
    const localId = localIdFromPlaceRoot(context, operand.place.root);
    if (localId !== undefined) {
      recordBorrowUse(context, localId);
    }
    return;
  }
  if (operand.kind.kind === "member" && operand.kind.memberPlace !== undefined) {
    recordPlaceUse(context, operand.kind.memberPlace);
    const localId = localIdFromPlaceRoot(context, operand.kind.memberPlace.root);
    if (localId !== undefined) {
      recordBorrowUse(context, localId);
    }
    return;
  }
  const localId = localIdFromExpression(context, operand);
  if (localId !== undefined) {
    recordBorrowUse(context, localId);
  }
}

function createPreScanContext(functionInstance: MonoFunctionInstance): PreScanContext {
  const localsByName = new Map<string, MonoLocal>();
  const localsById = new Map<string, MonoLocal>();
  const parameterLocalIds = new Map<string, MonoLocalId>();
  const factsByLocalId = new Map<string, MutablePreScanState>();

  for (const local of functionInstance.locals.entries()) {
    localsByName.set(local.name, local);
    localsById.set(localIdKey(local.localId), local);
    if (local.parameterId !== undefined) {
      parameterLocalIds.set(String(local.parameterId), local.localId);
    }
    factsByLocalId.set(localIdKey(local.localId), {
      fact: initialFactsFromLocal(local),
      placeUseRecorded: false,
      borrowUseRecorded: false,
    });
  }

  return {
    functionInstance,
    ownerKey: `function:${String(functionInstance.instanceId)}`,
    factsByLocalId,
    localsByName,
    localsById,
    parameterLocalIds,
  };
}

function prescanMonoBody(context: PreScanContext, body: MonoBlock): void {
  const skippedAssignmentTargetPlaceKeys = new Set<string>();

  walkMonoBlock(body, {
    local(local) {
      const state = stateForLocal(context, local.localId);
      const nextFact = initialFactsFromLocal(local);
      Object.assign(state.fact, nextFact);
    },
    statement(statement) {
      if (statement.kind.kind !== "assignment") {
        return;
      }
      const assignment = statement.kind.statement;
      if (assignment.targetPlace === undefined) {
        return;
      }
      const localId = localIdFromPlaceRoot(context, assignment.targetPlace.root);
      if (localId === undefined) {
        return;
      }
      const local = context.localsById.get(localIdKey(localId));
      if (
        local?.resourceKind === "Copy" &&
        assignment.targetPlace.projection.length === 0 &&
        assignment.target.kind.kind === "name" &&
        assignment.target.kind.localId !== undefined &&
        instantiatedHirIdKey(assignment.target.kind.localId) === localIdKey(localId)
      ) {
        skippedAssignmentTargetPlaceKeys.add(assignment.targetPlace.canonicalKey);
      }
    },
    resourcePlace(place) {
      if (skippedAssignmentTargetPlaceKeys.has(place.canonicalKey)) {
        return;
      }
      recordPlaceUse(context, place);
    },
    expression(expression) {
      recordExpressionPlaceUse(context, expression);
      if (expression.kind.kind === "unary" && expression.kind.operator === "borrow") {
        recordBorrowFromOperand(context, expression.kind.operand);
      }
      if (expression.kind.kind === "object") {
        const localId =
          expression.place === undefined
            ? undefined
            : localIdFromPlaceRoot(context, expression.place.root);
        if (localId !== undefined) {
          const state = stateForLocal(context, localId);
          state.fact.aggregate = true;
        }
      }
    },
    call(call) {
      for (const argument of call.arguments) {
        if (argument.mode === "consume" && argument.place !== undefined) {
          const localId = localIdFromPlaceRoot(context, argument.place.root);
          if (localId !== undefined) {
            recordConsumeUse(context, localId);
          }
        }
        if (argument.place !== undefined) {
          recordPlaceUse(context, argument.place);
        }
      }
    },
    validation(validation) {
      recordPlaceUse(context, validation.sourcePlace);
      recordPlaceUse(context, validation.pendingResultPlace);
    },
    attempt(attempt) {
      for (const place of attempt.declaredInputPlaces) {
        recordPlaceUse(context, place);
      }
    },
    takeKind(takeKind) {
      if (takeKind.kind === "buffer") {
        recordPlaceUse(context, takeKind.bufferPlace);
      }
      if (takeKind.kind === "stream" || takeKind.kind === "validatedBuffer") {
        for (const local of context.localsById.values()) {
          if (local.resourceKind === "Stream") {
            const state = stateForLocal(context, local.localId);
            state.fact.sessionBound = true;
          }
        }
      }
    },
  });
}

function buildClassification(context: PreScanContext): ProofMirLocalClassification {
  const entries: ProofMirClassifiedLocal[] = [];
  for (const local of context.localsById.values()) {
    const state = stateForLocal(context, local.localId);
    entries.push({
      local,
      storage: classifyProofMirLocalStorage(state.fact satisfies ProofMirLocalStoragePreScanFact),
    });
  }
  entries.sort((left, right) => compareMonoLocalIds(left.local.localId, right.local.localId));

  const byName = new Map(entries.map((entry) => [entry.local.name, entry]));
  const byId = new Map(entries.map((entry) => [localIdKey(entry.local.localId), entry]));

  return {
    local(name: string) {
      return byName.get(name);
    },
    localById(localId: MonoLocalId) {
      return byId.get(localIdKey(localId));
    },
    entries() {
      return entries;
    },
  };
}

function createClassifierFromContext(context: PreScanContext): ProofMirLocalClassifier {
  const classification = buildClassification(context);

  return {
    classification() {
      return classification;
    },
    requireRecordedPlaceUse(input) {
      const key = localIdKey(input.localId);
      const state = context.factsByLocalId.get(key);
      const classified = classification.localById(input.localId);
      if (state === undefined || classified === undefined) {
        return {
          kind: "error",
          diagnostics: [
            proofMirDiagnostic({
              severity: "error",
              code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
              message: "Proof MIR lowering requested an unknown local place or borrow use.",
              functionInstanceId: context.functionInstance.instanceId,
              ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
              ...(input.nodeDetail === undefined ? {} : { nodeDetail: input.nodeDetail }),
              ownerKey: context.ownerKey,
              rootCauseKey: "local-classifier",
              stableDetail: `missing-local:${key}`,
            }),
          ],
        };
      }

      const recorded = input.use === "borrow" ? state.borrowUseRecorded : state.placeUseRecorded;
      if (recorded || classified.storage === "placeBacked") {
        return { kind: "ok", value: undefined };
      }

      return {
        kind: "error",
        diagnostics: [
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
            message:
              "Proof MIR lowering discovered a place or borrow use that the local pre-scan did not classify.",
            functionInstanceId: context.functionInstance.instanceId,
            ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
            ...(input.nodeDetail === undefined ? {} : { nodeDetail: input.nodeDetail }),
            ownerKey: context.ownerKey,
            rootCauseKey: "local-classifier",
            stableDetail: `${input.use}:${key}`,
          }),
        ],
      };
    },
  };
}

export function createProofMirLocalClassifier(
  input: CreateProofMirLocalClassifierInput,
): ProofMirLocalClassifierResult<ProofMirLocalClassifier> {
  const functionInstance = input.functionInstance;
  const ownerKey = input.ownerKey ?? `function:${String(functionInstance.instanceId)}`;

  if (functionInstance.bodyStatus === "sourceBody" && functionInstance.bodyIndex === undefined) {
    return {
      kind: "error",
      diagnostics: [
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_MISSING_FUNCTION_BODY",
          message: "Reachable source-body function is missing mono body index metadata.",
          functionInstanceId: functionInstance.instanceId,
          sourceOrigin: functionInstance.sourceOrigin,
          ownerKey,
          rootCauseKey: "function-body",
          stableDetail: "missing-body-index",
        }),
      ],
    };
  }

  const context = createPreScanContext(functionInstance);
  if (functionInstance.bodyIndex !== undefined) {
    if (functionInstance.body !== undefined) {
      prescanMonoBody(context, functionInstance.body);
    } else {
      prescanMonoBodyIndex(context, functionInstance.bodyIndex);
    }
  }

  return {
    kind: "ok",
    value: createClassifierFromContext(context),
  };
}

function prescanMonoBodyIndex(context: PreScanContext, bodyIndex: MonoBodyIndex): void {
  for (const statement of bodyIndex.statements.entries()) {
    prescanMonoStatementExpressions(context, statement);
  }
  for (const expression of bodyIndex.expressions.entries()) {
    prescanMonoExpression(context, expression);
  }
}

function prescanMonoStatementExpressions(context: PreScanContext, statement: MonoStatement): void {
  switch (statement.kind.kind) {
    case "let":
      context.localsByName.set(statement.kind.statement.local.name, statement.kind.statement.local);
      context.localsById.set(
        localIdKey(statement.kind.statement.local.localId),
        statement.kind.statement.local,
      );
      stateForLocal(context, statement.kind.statement.local.localId);
      if (statement.kind.statement.value !== undefined) {
        prescanMonoExpression(context, statement.kind.statement.value);
      }
      return;
    case "assignment":
      prescanMonoExpression(context, statement.kind.statement.target);
      prescanMonoExpression(context, statement.kind.statement.value);
      recordAssignmentTargetPlace(context, statement.kind.statement);
      return;
    case "if":
      prescanMonoExpression(context, statement.kind.statement.condition);
      return;
    case "while":
      prescanMonoExpression(context, statement.kind.statement.condition);
      return;
    case "for":
      if (statement.kind.statement.binding !== undefined) {
        context.localsByName.set(
          statement.kind.statement.binding.name,
          statement.kind.statement.binding,
        );
        context.localsById.set(
          localIdKey(statement.kind.statement.binding.localId),
          statement.kind.statement.binding,
        );
        stateForLocal(context, statement.kind.statement.binding.localId);
      }
      prescanMonoExpression(context, statement.kind.statement.iterable);
      return;
    case "match":
      prescanMonoExpression(context, statement.kind.statement.scrutinee);
      return;
    case "validationMatch":
      prescanMonoExpression(context, statement.kind.statement.scrutinee);
      if (statement.kind.statement.validation !== undefined) {
        recordPlaceUse(context, statement.kind.statement.validation.sourcePlace);
        recordPlaceUse(context, statement.kind.statement.validation.pendingResultPlace);
      }
      return;
    case "return":
    case "yield":
      if (statement.kind.expression !== undefined) {
        prescanMonoExpression(context, statement.kind.expression);
      }
      return;
    case "expression":
      prescanMonoExpression(context, statement.kind.expression);
      return;
    case "take":
    case "block":
    case "loop":
    case "break":
    case "continue":
    case "error":
      return;
  }
}

function recordExpressionPlaceUse(context: PreScanContext, expression: MonoExpression): void {
  if (expression.place === undefined) {
    return;
  }
  const localId = localIdFromPlaceRoot(context, expression.place.root);
  if (localId === undefined) {
    recordPlaceUse(context, expression.place);
    return;
  }
  const local = context.localsById.get(localIdKey(localId));
  if (
    local?.resourceKind === "Copy" &&
    expression.place.projection.length === 0 &&
    expression.kind.kind === "name" &&
    expression.kind.localId !== undefined &&
    instantiatedHirIdKey(expression.kind.localId) === localIdKey(localId)
  ) {
    return;
  }
  recordPlaceUse(context, expression.place);
}

function prescanMonoExpression(context: PreScanContext, expression: MonoExpression): void {
  recordExpressionPlaceUse(context, expression);
  switch (expression.kind.kind) {
    case "literal":
    case "name":
    case "error":
      return;
    case "member":
      prescanMonoExpression(context, expression.kind.receiver);
      if (expression.kind.memberPlace !== undefined) {
        recordPlaceUse(context, expression.kind.memberPlace);
      }
      return;
    case "object":
      for (const field of expression.kind.fields) {
        prescanMonoExpression(context, field.value);
      }
      return;
    case "call":
      prescanMonoExpression(context, expression.kind.call.callee);
      if (expression.kind.call.receiver !== undefined) {
        prescanMonoExpression(context, expression.kind.call.receiver);
      }
      for (const argument of expression.kind.call.arguments) {
        prescanMonoExpression(context, argument.expression);
        if (argument.mode === "consume" && argument.place !== undefined) {
          const localId = localIdFromPlaceRoot(context, argument.place.root);
          if (localId !== undefined) {
            recordConsumeUse(context, localId);
          }
        }
        if (argument.place !== undefined) {
          recordPlaceUse(context, argument.place);
        }
      }
      return;
    case "attempt":
      prescanMonoExpression(context, expression.kind.attempt.fallibleExpression);
      if (expression.kind.attempt.alternativeExpression !== undefined) {
        prescanMonoExpression(context, expression.kind.attempt.alternativeExpression);
      }
      for (const place of expression.kind.attempt.declaredInputPlaces) {
        recordPlaceUse(context, place);
      }
      return;
    case "validationCreation":
      recordPlaceUse(context, expression.kind.validation.sourcePlace);
      recordPlaceUse(context, expression.kind.validation.pendingResultPlace);
      return;
    case "unary":
      prescanMonoExpression(context, expression.kind.operand);
      if (expression.kind.operator === "borrow") {
        recordBorrowFromOperand(context, expression.kind.operand);
      }
      return;
    case "binary":
    case "comparison":
      prescanMonoExpression(context, expression.kind.left);
      prescanMonoExpression(context, expression.kind.right);
      return;
  }
}

export interface CollectLoopCarriedLocalsForLoopInput {
  readonly classification: ProofMirLocalClassification;
  readonly allLocals: readonly MonoLocal[];
  readonly loopBody: MonoBlock;
}

function collectLocalIdsIntroducedInStatements(
  statements: readonly MonoStatement[],
  introduced: Set<string>,
): void {
  for (const statement of statements) {
    switch (statement.kind.kind) {
      case "let":
        introduced.add(localIdKey(statement.kind.statement.local.localId));
        break;
      case "for":
        if (statement.kind.statement.binding !== undefined) {
          introduced.add(localIdKey(statement.kind.statement.binding.localId));
        }
        collectLocalIdsIntroducedInBlock(statement.kind.statement.body, introduced);
        break;
      case "block":
        collectLocalIdsIntroducedInBlock(statement.kind.block, introduced);
        break;
      case "if":
        collectLocalIdsIntroducedInBlock(statement.kind.statement.thenBlock, introduced);
        if (statement.kind.statement.elseBlock !== undefined) {
          collectLocalIdsIntroducedInBlock(statement.kind.statement.elseBlock, introduced);
        }
        break;
      case "while":
        collectLocalIdsIntroducedInBlock(statement.kind.statement.body, introduced);
        break;
      case "loop":
        collectLocalIdsIntroducedInBlock(statement.kind.body, introduced);
        break;
      case "match":
        for (const arm of statement.kind.statement.arms) {
          for (const local of arm.bindingLocals) {
            introduced.add(localIdKey(local.localId));
          }
          collectLocalIdsIntroducedInBlock(arm.body, introduced);
        }
        break;
      case "validationMatch": {
        const validationMatch = statement.kind.statement;
        if (validationMatch.okArm !== undefined) {
          for (const local of validationMatch.okArm.bindingLocals) {
            introduced.add(localIdKey(local.localId));
          }
          collectLocalIdsIntroducedInBlock(validationMatch.okArm.body, introduced);
        }
        if (validationMatch.errArm !== undefined) {
          for (const local of validationMatch.errArm.bindingLocals) {
            introduced.add(localIdKey(local.localId));
          }
          collectLocalIdsIntroducedInBlock(validationMatch.errArm.body, introduced);
        }
        break;
      }
      case "take":
        if (statement.kind.statement.body !== undefined) {
          collectLocalIdsIntroducedInBlock(statement.kind.statement.body, introduced);
        }
        break;
      case "assignment":
      case "return":
      case "yield":
      case "expression":
      case "break":
      case "continue":
      case "error":
        break;
      default: {
        const unreachable: never = statement.kind;
        return unreachable;
      }
    }
  }
}

function collectLocalIdsIntroducedInBlock(block: MonoBlock, introduced: Set<string>): void {
  collectLocalIdsIntroducedInStatements(block.statements, introduced);
}

function assignmentTargetLocalId(expression: MonoExpression): MonoLocalId | undefined {
  if (expression.kind.kind !== "name" || expression.kind.localId === undefined) {
    return undefined;
  }
  return expression.kind.localId;
}

function collectAssignedLocalIdsInStatements(
  statements: readonly MonoStatement[],
  assigned: Set<string>,
): void {
  for (const statement of statements) {
    switch (statement.kind.kind) {
      case "assignment": {
        const targetLocalId = assignmentTargetLocalId(statement.kind.statement.target);
        if (targetLocalId !== undefined) {
          assigned.add(localIdKey(targetLocalId));
        }
        break;
      }
      case "let":
        break;
      case "block":
        collectAssignedLocalIdsInBlock(statement.kind.block, assigned);
        break;
      case "if":
        collectAssignedLocalIdsInBlock(statement.kind.statement.thenBlock, assigned);
        if (statement.kind.statement.elseBlock !== undefined) {
          collectAssignedLocalIdsInBlock(statement.kind.statement.elseBlock, assigned);
        }
        break;
      case "while":
        collectAssignedLocalIdsInBlock(statement.kind.statement.body, assigned);
        break;
      case "loop":
        collectAssignedLocalIdsInBlock(statement.kind.body, assigned);
        break;
      case "for":
        collectAssignedLocalIdsInBlock(statement.kind.statement.body, assigned);
        break;
      case "match":
        for (const arm of statement.kind.statement.arms) {
          collectAssignedLocalIdsInBlock(arm.body, assigned);
        }
        break;
      case "validationMatch": {
        const validationMatch = statement.kind.statement;
        if (validationMatch.okArm !== undefined) {
          collectAssignedLocalIdsInBlock(validationMatch.okArm.body, assigned);
        }
        if (validationMatch.errArm !== undefined) {
          collectAssignedLocalIdsInBlock(validationMatch.errArm.body, assigned);
        }
        break;
      }
      case "take":
        if (statement.kind.statement.body !== undefined) {
          collectAssignedLocalIdsInBlock(statement.kind.statement.body, assigned);
        }
        break;
      case "return":
      case "yield":
      case "expression":
      case "break":
      case "continue":
      case "error":
        break;
      default: {
        const unreachable: never = statement.kind;
        return unreachable;
      }
    }
  }
}

function collectAssignedLocalIdsInBlock(block: MonoBlock, assigned: Set<string>): void {
  collectAssignedLocalIdsInStatements(block.statements, assigned);
}

function collectAssignedLocalIdsInBlockFixedPoint(block: MonoBlock): Set<string> {
  const assigned = new Set<string>();
  let previousSize = -1;
  while (assigned.size !== previousSize) {
    previousSize = assigned.size;
    collectAssignedLocalIdsInBlock(block, assigned);
  }
  return assigned;
}

export function collectLoopCarriedLocalsForLoop(
  input: CollectLoopCarriedLocalsForLoopInput,
): readonly MonoLocal[] {
  const introducedInBody = new Set<string>();
  collectLocalIdsIntroducedInBlock(input.loopBody, introducedInBody);
  const assignedInBody = collectAssignedLocalIdsInBlockFixedPoint(input.loopBody);

  const carried: MonoLocal[] = [];
  for (const local of input.allLocals) {
    const key = localIdKey(local.localId);
    if (introducedInBody.has(key)) {
      continue;
    }
    if (!assignedInBody.has(key)) {
      continue;
    }
    if (input.classification.localById(local.localId)?.storage !== "scalarSsa") {
      continue;
    }
    carried.push(local);
  }

  carried.sort((left, right) => compareMonoLocalIds(left.localId, right.localId));
  return carried;
}

export function placeBackedLocalsFromClassification(
  classification: ProofMirLocalClassification,
): readonly MonoLocal[] {
  return classification
    .entries()
    .filter((entry) => entry.storage === "placeBacked")
    .map((entry) => entry.local)
    .sort((left, right) => compareMonoLocalIds(left.localId, right.localId));
}

export function createLoweringContextLocalClassifier(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly functionInstance: MonoFunctionInstance;
  readonly classifier: ProofMirLocalClassifier;
}): LoweringContextLocalClassifier {
  const classification = input.classifier.classification();
  const allLocals = [...input.functionInstance.locals.entries()].sort((left, right) =>
    compareMonoLocalIds(left.localId, right.localId),
  );

  return {
    functionInstanceId: input.functionInstanceId,
    storageForLocal(monoLocalId) {
      return classification.localById(monoLocalId)?.storage;
    },
    storageForParameter(parameterId) {
      for (const entry of classification.entries()) {
        if (entry.local.parameterId === parameterId) {
          return entry.storage;
        }
      }
      return undefined;
    },
    collectLoopCarriedLocalsForLoop(loopBody) {
      return collectLoopCarriedLocalsForLoop({
        classification,
        allLocals,
        loopBody,
      });
    },
    placeBackedLocals() {
      return placeBackedLocalsFromClassification(classification);
    },
  };
}
