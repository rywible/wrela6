import { concreteKind } from "../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import type { CheckedType } from "../semantic/surface/type-model";
import type { HirLoweringContext } from "./lowering-context";

export function resourceKindForCheckedType(
  context: HirLoweringContext,
  type: CheckedType,
): CheckedResourceKind {
  const fingerprint = checkedTypeFingerprint(type);
  return (
    context.program.proofSurface.resourceKindByType
      .entries()
      .find((entry) => entry.fingerprint === fingerprint)?.resourceKind ?? concreteKind("Copy")
  );
}
