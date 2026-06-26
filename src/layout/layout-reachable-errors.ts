import type {
  MonoCheckedType,
  MonoLayoutExpression,
  MonomorphizedHirProgram,
} from "../mono/mono-hir";
import { walkMonoBlock } from "../mono/body-walker";
import { monoAppliedArgumentTypes } from "../mono/instantiation-key";
import type { CheckedType } from "../semantic/surface/type-model";
import { layoutDiagnostic } from "./diagnostics";
import {
  functionAbiOwnerKey,
  imageDeviceOwnerKey,
  typeLayoutOwnerKey,
  validatedBufferRootOwnerKey,
} from "./layout-owners";

export function collectReachableErrorTypeDiagnostics(
  program: MonomorphizedHirProgram,
): readonly ReturnType<typeof layoutDiagnostic>[] {
  const diagnostics: ReturnType<typeof layoutDiagnostic>[] = [];
  const seenErrors = new Set<string>();
  const seenRecovered = new Set<string>();

  function recordErrorType(type: CheckedType, ownerKey: string, sourceOrigin?: string): void {
    if (type.kind !== "error") return;
    const detail = `${ownerKey}:error`;
    if (seenErrors.has(detail)) return;
    seenErrors.add(detail);
    diagnostics.push(
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_REACHABLE_ERROR_TYPE",
        message: "Reachable mono error type cannot receive layout facts.",
        ownerKey,
        rootCauseKey: ownerKey,
        stableDetail: detail,
        ...(sourceOrigin !== undefined ? { sourceOrigin } : {}),
      }),
    );
  }

  function recordRecoveredNode(
    ownerKey: string,
    stableDetail: string,
    sourceOrigin?: string,
  ): void {
    const detail = `${ownerKey}:${stableDetail}`;
    if (seenRecovered.has(detail)) return;
    seenRecovered.add(detail);
    diagnostics.push(
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_REACHABLE_RECOVERED_NODE",
        message: "Reachable recovered mono node cannot receive layout facts.",
        ownerKey,
        rootCauseKey: ownerKey,
        stableDetail: detail,
        ...(sourceOrigin !== undefined ? { sourceOrigin } : {}),
      }),
    );
  }

  function visitMonoType(type: MonoCheckedType, ownerKey: string, sourceOrigin?: string): void {
    recordErrorType(type, ownerKey, sourceOrigin);
    if (type.kind === "applied") {
      for (const argument of monoAppliedArgumentTypes(type)) {
        visitMonoType(argument, ownerKey, sourceOrigin);
      }
    }
  }

  function visitLayoutExpression(
    expression: MonoLayoutExpression,
    ownerKey: string,
    sourceOrigin?: string,
  ): void {
    switch (expression.kind) {
      case "integerLiteral":
        if (expression.width.kind === "type") {
          visitMonoType(expression.width.type, ownerKey, sourceOrigin);
        }
        return;
      case "sourceLength":
        return;
      case "fieldValue":
        visitMonoType(expression.type, ownerKey, sourceOrigin);
        return;
      case "add":
      case "subtract":
      case "multiply":
        visitLayoutExpression(expression.left, ownerKey, sourceOrigin);
        visitLayoutExpression(expression.right, ownerKey, sourceOrigin);
        if (expression.width.kind === "type") {
          visitMonoType(expression.width.type, ownerKey, sourceOrigin);
        }
        return;
      default: {
        const unreachable: never = expression;
        return unreachable;
      }
    }
  }

  for (const typeInstance of program.types.entries()) {
    const ownerKey = String(typeLayoutOwnerKey(typeInstance.instanceId));
    for (const field of typeInstance.fields) {
      visitMonoType(field.type, ownerKey, field.sourceOrigin);
    }
    for (const typeArgument of typeInstance.typeArguments) {
      visitMonoType(typeArgument, ownerKey, typeInstance.sourceOrigin);
    }
  }

  for (const functionInstance of program.functions.entries()) {
    const ownerKey = String(functionAbiOwnerKey(functionInstance.instanceId));
    const signature = functionInstance.signature;
    const functionOrigin = functionInstance.sourceOrigin;
    if (signature.receiver !== undefined) {
      visitMonoType(signature.receiver.type, ownerKey, functionOrigin);
    }
    for (const parameter of signature.parameters) {
      visitMonoType(parameter.type, ownerKey, functionOrigin);
    }
    visitMonoType(signature.returnType, ownerKey, functionOrigin);
    for (const local of functionInstance.locals.entries()) {
      visitMonoType(local.type, ownerKey, local.sourceOrigin);
    }
    if (functionInstance.body !== undefined) {
      walkMonoBlock(functionInstance.body, {
        statement: (statement) => {
          if (
            statement.kind.kind === "validationMatch" &&
            statement.kind.statement.recovered === true
          ) {
            recordRecoveredNode(
              ownerKey,
              `validation-match:${String(statement.kind.statement.validationMatchId.hirId)}`,
              statement.kind.statement.sourceOrigin,
            );
          }
        },
        expression: (expression) => {
          visitMonoType(expression.type, ownerKey, expression.sourceOrigin);
          if (expression.kind.kind === "call" && expression.kind.call.recovered === true) {
            recordRecoveredNode(
              ownerKey,
              `call:${expression.sourceOrigin}`,
              expression.sourceOrigin,
            );
          }
        },
      });
    }
  }

  for (const buffer of program.validatedBuffers.entries()) {
    const ownerKey = String(validatedBufferRootOwnerKey(buffer.instanceId));
    for (const parameter of buffer.parameterFields) {
      visitMonoType(parameter.type, ownerKey, parameter.sourceOrigin);
    }
    for (const layoutField of buffer.layoutFields) {
      visitMonoType(layoutField.field.type, ownerKey, layoutField.sourceOrigin);
      visitLayoutExpression(layoutField.offset, ownerKey, layoutField.sourceOrigin);
      if (layoutField.length !== undefined) {
        visitLayoutExpression(layoutField.length, ownerKey, layoutField.sourceOrigin);
      }
    }
    for (const derivedField of buffer.derivedFields) {
      visitMonoType(derivedField.field.type, ownerKey, derivedField.sourceOrigin);
      visitLayoutExpression(derivedField.source, ownerKey, derivedField.sourceOrigin);
      for (const caseRecord of derivedField.cases) {
        if (caseRecord.condition.kind !== "otherwise") {
          visitLayoutExpression(caseRecord.condition, ownerKey, caseRecord.sourceOrigin);
        }
        visitLayoutExpression(caseRecord.result, ownerKey, caseRecord.sourceOrigin);
      }
    }
  }

  for (const device of program.image.devices) {
    const ownerKey = String(imageDeviceOwnerKey(program.image.instanceId, device.fieldId));
    visitMonoType(device.place.type, ownerKey, device.sourceOrigin);
    for (const rootPlace of device.rootPlaces) {
      visitMonoType(rootPlace.type, ownerKey, rootPlace.sourceOrigin);
    }
  }

  return diagnostics;
}
