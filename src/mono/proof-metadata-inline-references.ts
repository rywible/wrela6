import type { HirProofOwner } from "../hir/ids";
import type { HirProofMetadata } from "../hir/proof-metadata";
import type {
  MonoBlock,
  MonoCallExpression,
  MonoExpression,
  MonoForIteration,
  MonoInstantiatedProofId,
  MonoStatement,
  MonoTakeKind,
  MonoTakeOperand,
} from "./mono-hir";
import { ownersEqual } from "./proof-metadata-index";

export type InlineProofReference =
  | {
      readonly family: "attempt";
      readonly id: MonoInstantiatedProofId<import("../hir/ids").AttemptId>;
    }
  | {
      readonly family: "validation";
      readonly id: MonoInstantiatedProofId<import("../hir/ids").ValidationId>;
    }
  | {
      readonly family: "obligation";
      readonly id: MonoInstantiatedProofId<import("../hir/ids").ObligationId>;
    }
  | {
      readonly family: "session";
      readonly id: MonoInstantiatedProofId<import("../hir/ids").SessionId>;
    }
  | {
      readonly family: "brand";
      readonly id: MonoInstantiatedProofId<import("../hir/ids").BrandId>;
    };

export function hasCanonicalInstanceKeyForOwner(
  canonicalInstanceKeys: ReadonlyMap<HirProofOwner, string>,
  owner: HirProofOwner,
): boolean {
  for (const knownOwner of canonicalInstanceKeys.keys()) {
    if (ownersEqual(knownOwner, owner)) return true;
  }
  return false;
}

export function inlineProofReferenceExists(
  metadata: HirProofMetadata,
  owner: HirProofOwner,
  reference: InlineProofReference,
): boolean {
  switch (reference.family) {
    case "attempt":
      return metadata.attempts
        .entries()
        .some(
          (record) =>
            ownersEqual(record.attemptId.owner, owner) &&
            record.attemptId.id === reference.id.hirId,
        );
    case "validation":
      return metadata.validations
        .entries()
        .some(
          (record) =>
            ownersEqual(record.validationId.owner, owner) &&
            record.validationId.id === reference.id.hirId,
        );
    case "obligation":
      return metadata.obligations
        .entries()
        .some(
          (record) =>
            ownersEqual(record.obligationId.owner, owner) &&
            record.obligationId.id === reference.id.hirId,
        );
    case "session":
      return metadata.sessions
        .entries()
        .some(
          (record) =>
            ownersEqual(record.sessionId.owner, owner) &&
            record.sessionId.id === reference.id.hirId,
        );
    case "brand":
      return metadata.brands
        .entries()
        .some(
          (record) =>
            ownersEqual(record.brandId.owner, owner) && record.brandId.id === reference.id.hirId,
        );
  }
}

export function collectInlineBodyProofReferences(body: MonoBlock): readonly InlineProofReference[] {
  const references: InlineProofReference[] = [];
  collectReferencesFromBlock(body, references);
  return references;
}

function collectReferencesFromBlock(block: MonoBlock, references: InlineProofReference[]): void {
  for (const statement of block.statements) {
    collectReferencesFromStatement(statement, references);
  }
}

function collectReferencesFromStatement(
  statement: MonoStatement,
  references: InlineProofReference[],
): void {
  switch (statement.kind.kind) {
    case "validationMatch":
      references.push({ family: "validation", id: statement.kind.statement.validationMatchId });
      if (statement.kind.statement.validation !== undefined) {
        references.push({
          family: "validation",
          id: statement.kind.statement.validation.validationId,
        });
      }
      collectReferencesFromExpression(statement.kind.statement.scrutinee, references);
      if (statement.kind.statement.okArm !== undefined) {
        collectReferencesFromBlock(statement.kind.statement.okArm.body, references);
      }
      if (statement.kind.statement.errArm !== undefined) {
        collectReferencesFromBlock(statement.kind.statement.errArm.body, references);
      }
      return;
    case "expression":
      collectReferencesFromExpression(statement.kind.expression, references);
      return;
    case "block":
      collectReferencesFromBlock(statement.kind.block, references);
      return;
    case "if":
      collectReferencesFromExpression(statement.kind.statement.condition, references);
      collectReferencesFromBlock(statement.kind.statement.thenBlock, references);
      if (statement.kind.statement.elseBlock !== undefined) {
        collectReferencesFromBlock(statement.kind.statement.elseBlock, references);
      }
      return;
    case "while":
      collectReferencesFromExpression(statement.kind.statement.condition, references);
      collectReferencesFromBlock(statement.kind.statement.body, references);
      return;
    case "loop":
      collectReferencesFromBlock(statement.kind.body, references);
      return;
    case "for":
      collectReferencesFromExpression(statement.kind.statement.iterable, references);
      collectReferencesFromForIteration(statement.kind.statement.iteration, references);
      collectReferencesFromBlock(statement.kind.statement.body, references);
      return;
    case "match":
      collectReferencesFromExpression(statement.kind.statement.scrutinee, references);
      for (const arm of statement.kind.statement.arms) {
        collectReferencesFromBlock(arm.body, references);
      }
      return;
    case "take":
      collectReferencesFromTakeOperand(statement.kind.statement.operand, references);
      collectReferencesFromTakeKind(statement.kind.statement.takeKind, references);
      collectReferencesFromBlock(statement.kind.statement.body, references);
      return;
    case "let":
      if (statement.kind.statement.value !== undefined) {
        collectReferencesFromExpression(statement.kind.statement.value, references);
      }
      return;
    case "assignment":
      collectReferencesFromExpression(statement.kind.statement.target, references);
      collectReferencesFromExpression(statement.kind.statement.value, references);
      return;
    case "return":
      if (statement.kind.expression !== undefined) {
        collectReferencesFromExpression(statement.kind.expression, references);
      }
      return;
    case "yield":
      if (statement.kind.expression !== undefined) {
        collectReferencesFromExpression(statement.kind.expression, references);
      }
      return;
    case "break":
    case "continue":
    case "error":
      return;
  }
}

function collectReferencesFromForIteration(
  iteration: MonoForIteration,
  references: InlineProofReference[],
): void {
  if (iteration.kind !== "stream") return;
  references.push({ family: "session", id: iteration.sessionId });
  references.push({ family: "brand", id: iteration.itemBrandId });
  references.push({ family: "obligation", id: iteration.closureObligationId });
}

function collectReferencesFromTakeKind(
  takeKind: MonoTakeKind,
  references: InlineProofReference[],
): void {
  switch (takeKind.kind) {
    case "stream":
      references.push({ family: "session", id: takeKind.sessionId });
      references.push({ family: "brand", id: takeKind.itemBrandId });
      references.push({ family: "obligation", id: takeKind.closureObligationId });
      return;
    case "buffer":
      references.push({ family: "obligation", id: takeKind.obligationId });
      return;
    case "validatedBuffer":
      references.push({ family: "session", id: takeKind.sessionId });
      references.push({ family: "brand", id: takeKind.memberBrandId });
      references.push({ family: "obligation", id: takeKind.closureObligationId });
      return;
    case "error":
      return;
  }
}

function collectReferencesFromExpression(
  expression: MonoExpression,
  references: InlineProofReference[],
): void {
  switch (expression.kind.kind) {
    case "attempt":
      references.push({ family: "attempt", id: expression.kind.attempt.attemptId });
      collectReferencesFromExpression(expression.kind.attempt.fallibleExpression, references);
      if (expression.kind.attempt.alternativeExpression !== undefined) {
        collectReferencesFromExpression(expression.kind.attempt.alternativeExpression, references);
      }
      return;
    case "validationCreation":
      references.push({ family: "validation", id: expression.kind.validation.validationId });
      return;
    case "call":
      collectReferencesFromCall(expression.kind.call, references);
      return;
    case "member":
      collectReferencesFromExpression(expression.kind.receiver, references);
      return;
    case "object":
      for (const field of expression.kind.fields) {
        collectReferencesFromExpression(field.value, references);
      }
      return;
    case "unary":
      collectReferencesFromExpression(expression.kind.operand, references);
      return;
    case "binary":
    case "comparison":
      collectReferencesFromExpression(expression.kind.left, references);
      collectReferencesFromExpression(expression.kind.right, references);
      return;
    case "literal":
    case "name":
    case "error":
      return;
  }
}

function collectReferencesFromCall(
  call: MonoCallExpression,
  references: InlineProofReference[],
): void {
  collectReferencesFromExpression(call.callee, references);
  if (call.receiver !== undefined) {
    collectReferencesFromExpression(call.receiver, references);
  }
  for (const argument of call.arguments) {
    collectReferencesFromExpression(argument.expression, references);
  }
}

function collectReferencesFromTakeOperand(
  operand: MonoTakeOperand,
  references: InlineProofReference[],
): void {
  switch (operand.kind) {
    case "place":
      collectReferencesFromExpression(operand.expression, references);
      return;
    case "takeOnlyCall":
      collectReferencesFromCall(operand.call, references);
      return;
    case "error":
      if (operand.expression !== undefined) {
        collectReferencesFromExpression(operand.expression, references);
      }
      return;
  }
}
