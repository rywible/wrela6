import { coreTypeId } from "../ids";
import type { TargetTypeId, TypeId } from "../ids";
import type { CoreTypeCatalog } from "../names/core-types";
import type { ItemIndex } from "../item-index";
import type { SourceItemKind } from "../item-index/item-records";
import type { CheckedType } from "./type-model";
import type { CheckedResourceKind, ConcreteResourceKind } from "./resource-kind";
import { concreteKind, parametricKind, errorKind, joinResourceKinds } from "./resource-kind";

export interface ResourceKindContext {
  readonly coreTypes: CoreTypeCatalog;
  readonly index: ItemIndex;
  readonly sourceTypeKinds: ReadonlyMap<TypeId, CheckedResourceKind>;
  readonly targetTypeKinds: ReadonlyMap<TargetTypeId, CheckedResourceKind>;
}

export function emptyKindContext(
  coreTypes: CoreTypeCatalog,
  index: ItemIndex,
): ResourceKindContext {
  return {
    coreTypes,
    index,
    sourceTypeKinds: new Map(),
    targetTypeKinds: new Map(),
  };
}

function declarationKindForItem(input: {
  readonly kind: SourceItemKind;
  readonly modifiers: readonly string[];
}): ConcreteResourceKind | undefined {
  const modifiers = new Set(input.modifiers);
  if (input.kind === "edgeClass" && modifiers.has("unique")) {
    return "UniqueEdgeRoot";
  }
  if (input.kind === "class" && modifiers.has("private")) {
    return "PrivateState";
  }

  switch (input.kind) {
    case "stream":
      return "Stream";
    case "validatedBuffer":
      return "ValidatedBuffer";
    case "edgeClass":
      return "EdgePath";
    case "interface":
      return "Copy";
    default:
      return undefined;
  }
}

const neverCoreTypeId = coreTypeId("Never");

export function resourceKindForType(input: {
  readonly type: CheckedType;
  readonly context: ResourceKindContext;
}): CheckedResourceKind {
  switch (input.type.kind) {
    case "core": {
      if (input.type.coreTypeId === neverCoreTypeId) {
        return concreteKind("Never");
      }
      return concreteKind("Copy");
    }
    case "source": {
      const itemRecord = input.context.index.item(input.type.itemId);
      if (itemRecord !== undefined) {
        const declKind = declarationKindForItem({
          kind: itemRecord.kind,
          modifiers: itemRecord.modifiers,
        });
        if (declKind !== undefined) {
          return concreteKind(declKind);
        }
      }
      const cached = input.context.sourceTypeKinds.get(input.type.typeId);
      if (cached !== undefined) return cached;
      return concreteKind("Copy");
    }
    case "genericParameter": {
      return parametricKind(input.type.parameter);
    }
    case "applied": {
      if (input.type.arguments.length === 0) return input.type.resourceKind;
      return joinResourceKinds(
        input.type.arguments.map((argument) =>
          resourceKindForType({ type: argument, context: input.context }),
        ),
      );
    }
    case "target": {
      const cached = input.context.targetTypeKinds.get(input.type.targetTypeId);
      if (cached !== undefined) return cached;
      return concreteKind("Copy");
    }
    case "error": {
      return errorKind();
    }
  }
}
