import type { MonoExpression } from "../../mono/mono-hir";

export function objectNeedsPlace(expression: MonoExpression): boolean {
  if (expression.kind.kind !== "object") {
    return false;
  }
  if (expression.place !== undefined) {
    return true;
  }
  if (expression.resourceKind !== "Copy") {
    return true;
  }
  for (const field of expression.kind.fields) {
    if (field.value.resourceKind !== "Copy") {
      return true;
    }
    if (field.value.place !== undefined) {
      return true;
    }
    if (field.value.kind.kind === "name") {
      const localId = field.value.kind.localId;
      if (localId !== undefined) {
        // Field values that are already place-backed force aggregate storage.
        void localId;
      }
    }
  }
  return expression.kind.fields.some((field) => field.value.resourceKind !== "Copy");
}
