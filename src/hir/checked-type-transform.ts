import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";

export interface CheckedTypeTransformVisitor {
  readonly checkedType?: (source: CheckedType) => CheckedType;
  readonly resourceKind?: (source: CheckedResourceKind) => CheckedResourceKind;
}

export function transformCheckedResourceKind(
  source: CheckedResourceKind,
  visitor: CheckedTypeTransformVisitor,
): CheckedResourceKind {
  const transformed =
    source.kind === "derived" ? transformDerivedResourceKind(source, visitor) : source;
  return visitor.resourceKind?.(transformed) ?? transformed;
}

function transformDerivedResourceKind(
  source: Extract<CheckedResourceKind, { readonly kind: "derived" }>,
  visitor: CheckedTypeTransformVisitor,
): CheckedResourceKind {
  const argumentsResult = transformArray(source.arguments, (argument) =>
    transformCheckedResourceKind(argument, visitor),
  );
  return argumentsResult.changed ? { ...source, arguments: argumentsResult.values } : source;
}

export function transformCheckedType(
  source: CheckedType,
  visitor: CheckedTypeTransformVisitor,
): CheckedType {
  const transformed =
    source.kind === "applied" ? transformAppliedCheckedType(source, visitor) : source;
  return visitor.checkedType?.(transformed) ?? transformed;
}

function transformAppliedCheckedType(
  source: Extract<CheckedType, { readonly kind: "applied" }>,
  visitor: CheckedTypeTransformVisitor,
): CheckedType {
  const argumentsResult = transformArray(source.arguments, (argument) =>
    transformCheckedType(argument, visitor),
  );
  const resourceKind = transformCheckedResourceKind(source.resourceKind, visitor);
  return argumentsResult.changed || resourceKind !== source.resourceKind
    ? { ...source, arguments: argumentsResult.values, resourceKind }
    : source;
}

function transformArray<Value>(
  values: readonly Value[],
  transform: (value: Value) => Value,
): { readonly changed: boolean; readonly values: readonly Value[] } {
  let changed = false;
  const transformed = values.map((value) => {
    const result = transform(value);
    changed ||= result !== value;
    return result;
  });
  return changed ? { changed, values: transformed } : { changed, values };
}
