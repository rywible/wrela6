import { walkMonoBlock } from "./body-walker";
import { monoAppliedArgumentTypes } from "./instantiation-key";
import type { MonoCheckedType, MonoLayoutExpression, MonomorphizedHirProgram } from "./mono-hir";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";

export function collectReachableMonoCheckedTypes(
  program: MonomorphizedHirProgram,
): readonly MonoCheckedType[] {
  const collected = new Set<string>();
  const types: MonoCheckedType[] = [];
  const addType = (type: MonoCheckedType | undefined): void => {
    if (type === undefined) {
      return;
    }
    if (type.kind === "genericParameter" || type.kind === "error") {
      return;
    }
    const fingerprint = checkedTypeFingerprint(type);
    if (collected.has(fingerprint)) {
      return;
    }
    collected.add(fingerprint);
    types.push(type);
    if (type.kind === "applied") {
      for (const argument of monoAppliedArgumentTypes(type)) {
        addType(argument);
      }
    }
  };

  for (const typeInstance of program.types.entries()) {
    for (const argument of typeInstance.typeArguments) {
      addType(argument);
    }
    for (const field of typeInstance.fields) {
      addType(field.type);
    }
  }
  for (const functionInstance of program.functions.entries()) {
    addType(functionInstance.signature.returnType);
    if (functionInstance.signature.receiver !== undefined) {
      addType(functionInstance.signature.receiver.type);
    }
    for (const parameter of functionInstance.signature.parameters) {
      addType(parameter.type);
    }
    for (const local of functionInstance.locals.entries()) {
      addType(local.type);
    }
    if (functionInstance.body !== undefined) {
      walkMonoBlock(functionInstance.body, {
        expression: (expression) => addType(expression.type),
        statement: () => undefined,
      });
    }
  }
  for (const buffer of program.validatedBuffers.entries()) {
    for (const field of buffer.parameterFields) {
      addType(field.type);
    }
    for (const layoutField of buffer.layoutFields) {
      addType(layoutField.field.type);
      collectLayoutExpressionTypes(layoutField.offset, addType);
      if (layoutField.length !== undefined) {
        collectLayoutExpressionTypes(layoutField.length, addType);
      }
    }
    for (const derivedField of buffer.derivedFields) {
      addType(derivedField.field.type);
      collectLayoutExpressionTypes(derivedField.source, addType);
      for (const caseRecord of derivedField.cases) {
        if (caseRecord.condition.kind !== "otherwise") {
          collectLayoutExpressionTypes(caseRecord.condition, addType);
        }
        collectLayoutExpressionTypes(caseRecord.result, addType);
      }
    }
  }
  for (const device of program.image.devices) {
    addType(device.place.type);
    for (const rootPlace of device.rootPlaces) {
      addType(rootPlace.type);
    }
  }

  return types;
}

function collectLayoutExpressionTypes(
  expression: MonoLayoutExpression,
  addType: (type: MonoCheckedType) => void,
): void {
  switch (expression.kind) {
    case "integerLiteral":
      if (expression.width.kind === "type") {
        addType(expression.width.type);
      }
      return;
    case "sourceLength":
      return;
    case "fieldValue":
      addType(expression.type);
      return;
    case "add":
    case "subtract":
    case "multiply":
      collectLayoutExpressionTypes(expression.left, addType);
      collectLayoutExpressionTypes(expression.right, addType);
      if (expression.width.kind === "type") {
        addType(expression.width.type);
      }
      return;
    default: {
      const unreachable: never = expression;
      return unreachable;
    }
  }
}
