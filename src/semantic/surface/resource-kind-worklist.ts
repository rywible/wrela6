import type { ItemIndex } from "../item-index";
import type { TypeId } from "../ids";
import type { CoreTypeCatalog } from "../names/core-types";
import type { SemanticTargetSurface } from "./platform-surface";
import type { ResourceKindContext } from "./resource-kind-checker";
import { emptyKindContext, resourceKindForType } from "./resource-kind-checker";
import type { CheckedResourceKind } from "./resource-kind";
import { joinResourceKinds, resourceKindFingerprint } from "./resource-kind";
import type { CheckedType } from "./type-model";
import { targetResourceKindContext } from "./mono-closure-builder";

export interface ResourceKindFieldEntry {
  readonly itemTypeId: TypeId | undefined;
  readonly type: CheckedType;
}

export function buildSourceResourceKindFixpoint(input: {
  readonly coreTypes: CoreTypeCatalog;
  readonly index: ItemIndex;
  readonly targetSurface: SemanticTargetSurface;
  readonly fields: readonly ResourceKindFieldEntry[];
}): ResourceKindContext {
  let sourceTypeKinds = new Map<TypeId, CheckedResourceKind>();
  let previousFingerprint = "";
  const targetTypeKindContext = targetResourceKindContext(input.targetSurface);
  const emptyContext = emptyKindContext(input.coreTypes, input.index);
  const maxIterations = Math.max(1, input.index.types().length + 1);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const kindsByType = new Map<TypeId, CheckedResourceKind[]>();
    for (const { itemTypeId, type } of input.fields) {
      const fieldKind = resourceKindForType({
        type,
        context: {
          ...emptyContext,
          targetTypeKinds: targetTypeKindContext,
          sourceTypeKinds,
        },
      });
      if (itemTypeId !== undefined) {
        const kinds = kindsByType.get(itemTypeId) ?? [];
        kinds.push(fieldKind);
        kindsByType.set(itemTypeId, kinds);
      }
    }
    const newKinds = new Map<TypeId, CheckedResourceKind>();
    for (const [typeId, kinds] of kindsByType) {
      newKinds.set(typeId, joinResourceKinds(kinds));
    }
    const fingerprint = [...newKinds.entries()]
      .sort(([leftId], [rightId]) => leftId - rightId)
      .map(([typeId, kind]) => `${typeId}:${resourceKindFingerprint(kind)}`)
      .join("|");
    if (fingerprint === previousFingerprint) break;
    previousFingerprint = fingerprint;
    sourceTypeKinds = newKinds;
  }

  return {
    coreTypes: input.coreTypes,
    index: input.index,
    sourceTypeKinds,
    targetTypeKinds: targetTypeKindContext,
  };
}
