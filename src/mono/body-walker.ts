import type {
  MonoAttempt,
  MonoBlock,
  MonoCallExpression,
  MonoExpression,
  MonoForIteration,
  MonoLocal,
  MonoResourcePlace,
  MonoStatement,
  MonoTakeKind,
  MonoTakeOperand,
  MonoValidation,
} from "./mono-hir";

export interface MonoBodyVisitor {
  enterBlock?(block: MonoBlock): void;
  statement?(statement: MonoStatement): void;
  expression?(expression: MonoExpression): void;
  call?(call: MonoCallExpression): void;
  local?(local: MonoLocal): void;
  resourcePlace?(place: MonoResourcePlace): void;
  validation?(validation: MonoValidation): void;
  attempt?(attempt: MonoAttempt): void;
  forIteration?(iteration: MonoForIteration): void;
  takeKind?(takeKind: MonoTakeKind): void;
}

export function walkMonoBlock(block: MonoBlock, visitor: MonoBodyVisitor): void {
  visitor.enterBlock?.(block);
  for (const statement of block.statements) {
    walkMonoStatement(statement, visitor);
  }
}

export function walkMonoStatement(statement: MonoStatement, visitor: MonoBodyVisitor): void {
  visitor.statement?.(statement);
  switch (statement.kind.kind) {
    case "block":
      walkMonoBlock(statement.kind.block, visitor);
      return;
    case "let":
      visitor.local?.(statement.kind.statement.local);
      if (statement.kind.statement.value !== undefined) {
        walkMonoExpression(statement.kind.statement.value, visitor);
      }
      return;
    case "assignment":
      walkMonoExpression(statement.kind.statement.target, visitor);
      walkMonoExpression(statement.kind.statement.value, visitor);
      if (statement.kind.statement.targetPlace !== undefined) {
        visitor.resourcePlace?.(statement.kind.statement.targetPlace);
      }
      return;
    case "if":
      walkMonoExpression(statement.kind.statement.condition, visitor);
      walkMonoBlock(statement.kind.statement.thenBlock, visitor);
      if (statement.kind.statement.elseBlock !== undefined) {
        walkMonoBlock(statement.kind.statement.elseBlock, visitor);
      }
      return;
    case "while":
      walkMonoExpression(statement.kind.statement.condition, visitor);
      walkMonoBlock(statement.kind.statement.body, visitor);
      return;
    case "loop":
      walkMonoBlock(statement.kind.body, visitor);
      return;
    case "for":
      if (statement.kind.statement.binding !== undefined) {
        visitor.local?.(statement.kind.statement.binding);
      }
      walkMonoExpression(statement.kind.statement.iterable, visitor);
      visitor.forIteration?.(statement.kind.statement.iteration);
      walkMonoBlock(statement.kind.statement.body, visitor);
      return;
    case "match":
      walkMonoExpression(statement.kind.statement.scrutinee, visitor);
      for (const arm of statement.kind.statement.arms) {
        for (const local of arm.bindingLocals) visitor.local?.(local);
        walkMonoBlock(arm.body, visitor);
      }
      return;
    case "validationMatch":
      walkMonoExpression(statement.kind.statement.scrutinee, visitor);
      if (statement.kind.statement.validation !== undefined) {
        walkMonoValidation(statement.kind.statement.validation, visitor);
      }
      for (const arm of [statement.kind.statement.okArm, statement.kind.statement.errArm]) {
        if (arm === undefined) continue;
        for (const local of arm.bindingLocals) visitor.local?.(local);
        walkMonoBlock(arm.body, visitor);
      }
      return;
    case "take":
      walkMonoTakeOperand(statement.kind.statement.operand, visitor);
      walkMonoTakeKind(statement.kind.statement.takeKind, visitor);
      if (statement.kind.statement.aliasLocal !== undefined) {
        visitor.local?.(statement.kind.statement.aliasLocal);
      }
      walkMonoBlock(statement.kind.statement.body, visitor);
      return;
    case "return":
    case "yield":
      if (statement.kind.expression !== undefined) {
        walkMonoExpression(statement.kind.expression, visitor);
      }
      return;
    case "expression":
      walkMonoExpression(statement.kind.expression, visitor);
      return;
    case "break":
    case "continue":
    case "error":
      return;
  }
}

export function walkMonoExpression(expression: MonoExpression, visitor: MonoBodyVisitor): void {
  visitor.expression?.(expression);
  if (expression.place !== undefined) visitor.resourcePlace?.(expression.place);
  switch (expression.kind.kind) {
    case "literal":
    case "name":
    case "error":
      return;
    case "member":
      walkMonoExpression(expression.kind.receiver, visitor);
      if (expression.kind.memberPlace !== undefined) {
        visitor.resourcePlace?.(expression.kind.memberPlace);
      }
      return;
    case "object":
      for (const field of expression.kind.fields) {
        walkMonoExpression(field.value, visitor);
      }
      return;
    case "enumConstructor":
      for (const field of expression.kind.constructor.payloadFields) {
        walkMonoExpression(field.value, visitor);
      }
      return;
    case "call":
      walkMonoCallExpression(expression.kind.call, visitor);
      return;
    case "attempt":
      walkMonoAttempt(expression.kind.attempt, visitor);
      return;
    case "validationCreation":
      walkMonoValidation(expression.kind.validation, visitor);
      return;
    case "unary":
      walkMonoExpression(expression.kind.operand, visitor);
      return;
    case "binary":
    case "comparison":
      walkMonoExpression(expression.kind.left, visitor);
      walkMonoExpression(expression.kind.right, visitor);
      return;
  }
}

export function walkMonoCallExpression(call: MonoCallExpression, visitor: MonoBodyVisitor): void {
  visitor.call?.(call);
  walkMonoExpression(call.callee, visitor);
  if (call.receiver !== undefined) walkMonoExpression(call.receiver, visitor);
  for (const argument of call.arguments) {
    walkMonoExpression(argument.expression, visitor);
    if (argument.place !== undefined) visitor.resourcePlace?.(argument.place);
  }
}

export function walkMonoValidation(validation: MonoValidation, visitor: MonoBodyVisitor): void {
  visitor.validation?.(validation);
  visitor.resourcePlace?.(validation.sourcePlace);
  visitor.resourcePlace?.(validation.pendingResultPlace);
}

export function walkMonoAttempt(attempt: MonoAttempt, visitor: MonoBodyVisitor): void {
  visitor.attempt?.(attempt);
  walkMonoExpression(attempt.fallibleExpression, visitor);
  if (attempt.alternativeExpression !== undefined) {
    walkMonoExpression(attempt.alternativeExpression, visitor);
  }
  for (const place of attempt.declaredInputPlaces) {
    visitor.resourcePlace?.(place);
  }
}

function walkMonoTakeOperand(operand: MonoTakeOperand, visitor: MonoBodyVisitor): void {
  switch (operand.kind) {
    case "place":
      visitor.resourcePlace?.(operand.place);
      walkMonoExpression(operand.expression, visitor);
      return;
    case "takeOnlyCall":
      walkMonoCallExpression(operand.call, visitor);
      visitor.resourcePlace?.(operand.resultPlace);
      return;
    case "error":
      if (operand.expression !== undefined) walkMonoExpression(operand.expression, visitor);
      return;
  }
}

function walkMonoTakeKind(takeKind: MonoTakeKind, visitor: MonoBodyVisitor): void {
  visitor.takeKind?.(takeKind);
  switch (takeKind.kind) {
    case "buffer":
      visitor.resourcePlace?.(takeKind.bufferPlace);
      return;
    case "stream":
    case "validatedBuffer":
    case "error":
      return;
  }
}
