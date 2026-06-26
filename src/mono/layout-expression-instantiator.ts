import type { HirDerivedFieldCase, HirLayoutExpression, TypedHirProgram } from "../hir/hir";
import type { FieldId } from "../semantic/ids";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import type {
  MonoDerivedFieldCase,
  MonoFieldRecord,
  MonoLayoutExpression,
  MonoLayoutIntegerWidth,
} from "./mono-hir";

export interface LayoutExpressionContext {
  readonly program: TypedHirProgram;
  readonly fieldById: ReadonlyMap<FieldId, MonoFieldRecord>;
}

type InstantiateMonoLayoutExpressionResult =
  | { readonly kind: "ok"; readonly expression: MonoLayoutExpression }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateMonoLayoutExpression(input: {
  readonly expression: HirLayoutExpression;
  readonly context: LayoutExpressionContext;
}): InstantiateMonoLayoutExpressionResult {
  const sourceOrigin = String(input.expression.sourceOrigin);
  switch (input.expression.kind) {
    case "integerLiteral":
      return {
        kind: "ok",
        expression: {
          kind: "integerLiteral",
          value: input.expression.value,
          width: targetSizeWidth(),
          sourceOrigin,
        },
      };
    case "sourceLength":
      return {
        kind: "ok",
        expression: {
          kind: "sourceLength",
          width: { kind: "targetSize" },
          sourceOrigin,
        },
      };
    case "fieldValue": {
      const field = input.context.fieldById.get(input.expression.fieldId);
      if (field === undefined) {
        return {
          kind: "error",
          diagnostics: [
            monoDiagnostic({
              severity: "error",
              code: "MONO_MISSING_HIR_FIELD",
              message: "Layout expression references a missing validated-buffer field.",
              ownerKey: `field:${input.expression.fieldId}`,
              rootCauseKey: "source-field",
              stableDetail: `layout-field:${input.expression.fieldId}`,
              sourceOrigin,
            }),
          ],
        };
      }
      return {
        kind: "ok",
        expression: {
          kind: "fieldValue",
          fieldId: input.expression.fieldId,
          fieldKind: input.expression.fieldKind,
          type: field.type,
          sourceOrigin,
        },
      };
    }
    case "add":
    case "subtract":
    case "multiply": {
      const leftResult = instantiateMonoLayoutExpression({
        expression: input.expression.left,
        context: input.context,
      });
      if (leftResult.kind === "error") {
        return leftResult;
      }
      const rightResult = instantiateMonoLayoutExpression({
        expression: input.expression.right,
        context: input.context,
      });
      if (rightResult.kind === "error") {
        return rightResult;
      }
      const widthResult = arithmeticLayoutWidth(leftResult.expression, rightResult.expression);
      if (widthResult.kind === "error") {
        return { kind: "error", diagnostics: widthResult.diagnostics };
      }
      return {
        kind: "ok",
        expression: {
          kind: input.expression.kind,
          left: leftResult.expression,
          right: rightResult.expression,
          width: widthResult.width,
          sourceOrigin,
        },
      };
    }
    default: {
      const unreachable: never = input.expression;
      return unreachable;
    }
  }
}

type InstantiateMonoDerivedFieldCasesResult =
  | { readonly kind: "ok"; readonly cases: readonly MonoDerivedFieldCase[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateMonoDerivedFieldCases(input: {
  readonly cases: readonly HirDerivedFieldCase[];
  readonly context: LayoutExpressionContext;
}): InstantiateMonoDerivedFieldCasesResult {
  const cases: MonoDerivedFieldCase[] = [];
  for (const caseRecord of input.cases) {
    if (caseRecord.condition.kind === "otherwise") {
      const result = instantiateMonoLayoutExpression({
        expression: caseRecord.result,
        context: input.context,
      });
      if (result.kind === "error") {
        return { kind: "error", diagnostics: result.diagnostics };
      }
      cases.push({
        condition: { kind: "otherwise" },
        result: result.expression,
        sourceOrigin: String(caseRecord.sourceOrigin),
      });
      continue;
    }
    const conditionResult = instantiateMonoLayoutExpression({
      expression: caseRecord.condition,
      context: input.context,
    });
    if (conditionResult.kind === "error") {
      return { kind: "error", diagnostics: conditionResult.diagnostics };
    }
    const result = instantiateMonoLayoutExpression({
      expression: caseRecord.result,
      context: input.context,
    });
    if (result.kind === "error") {
      return { kind: "error", diagnostics: result.diagnostics };
    }
    cases.push({
      condition: conditionResult.expression,
      result: result.expression,
      sourceOrigin: String(caseRecord.sourceOrigin),
    });
  }
  return { kind: "ok", cases };
}

function targetSizeWidth(): MonoLayoutIntegerWidth {
  return { kind: "targetSize" };
}

type ArithmeticLayoutWidthResult =
  | { readonly kind: "ok"; readonly width: MonoLayoutIntegerWidth }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function arithmeticLayoutWidth(
  left: MonoLayoutExpression,
  right: MonoLayoutExpression,
): ArithmeticLayoutWidthResult {
  const leftWidth = layoutExpressionWidth(left);
  const rightWidth = layoutExpressionWidth(right);
  if (leftWidth.kind === "targetSize" || rightWidth.kind === "targetSize") {
    return { kind: "ok", width: targetSizeWidth() };
  }
  if (leftWidth.kind === "type" && rightWidth.kind === "type") {
    return { kind: "ok", width: leftWidth };
  }
  return { kind: "ok", width: targetSizeWidth() };
}

function layoutExpressionWidth(expression: MonoLayoutExpression): MonoLayoutIntegerWidth {
  switch (expression.kind) {
    case "integerLiteral":
    case "add":
    case "subtract":
    case "multiply":
      return expression.width;
    case "sourceLength":
      return expression.width;
    case "fieldValue":
      return { kind: "type", type: expression.type };
    default: {
      const unreachable: never = expression;
      return unreachable;
    }
  }
}
