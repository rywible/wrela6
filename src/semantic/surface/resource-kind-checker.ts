import type { CoreTypeId } from "../ids";
import type { CoreTypeCatalog } from "../names/core-types";
import type { CheckedType } from "./type-model";
import type { CheckedResourceKind } from "./resource-kind";
import { concreteKind, parametricKind, errorKind } from "./resource-kind";

export interface ResourceKindContext {
  readonly coreTypes: CoreTypeCatalog;
  readonly sourceTypeKinds: ReadonlyMap<number, CheckedResourceKind>;
  readonly targetTypeKinds: ReadonlyMap<string, CheckedResourceKind>;
  readonly constructorRules: ReadonlyMap<string, string>;
}

export function emptyKindContext(coreTypes: CoreTypeCatalog): ResourceKindContext {
  return {
    coreTypes,
    sourceTypeKinds: new Map(),
    targetTypeKinds: new Map(),
    constructorRules: new Map(),
  };
}

const neverCoreTypeId: CoreTypeId = "Never" as unknown as CoreTypeId;

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
      const cached = input.context.sourceTypeKinds.get(input.type.typeId as number);
      if (cached !== undefined) return cached;
      return concreteKind("Copy");
    }
    case "genericParameter": {
      return parametricKind(input.type.parameter);
    }
    case "applied": {
      return input.type.resourceKind;
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
