import type { ItemIndex } from "../item-index";
import type { TypeParameterOwner, TypeParameterRecord } from "../item-index/item-records";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import type { CoreTypeCatalog } from "../names/core-types";
import { checkTypeReference } from "./type-reference-checker";
import type { CheckedType } from "./type-model";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { duplicateGenericParameter, genericBoundCycle, invalidGenericBound } from "./diagnostics";
import type { ItemId, ModuleId } from "../ids";
import { moduleId } from "../ids";
import type { SourceText } from "../../frontend";
import { SourceSpan, presentTokenSpan } from "../../frontend";
import type { RedToken } from "../../frontend/syntax";
import type {
  CheckedGenericParameter,
  CheckedGenericSignature,
  CheckedInterfaceConstraint,
} from "./checked-program";

export interface CheckGenericSignatureInput {
  readonly owner: TypeParameterOwner;
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
}

export interface CheckGenericSignatureResult {
  readonly signature: CheckedGenericSignature;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function resolveOwnerModuleId(owner: TypeParameterOwner, index: ItemIndex): ModuleId | undefined {
  const itemRecord = index.item(owner.itemId);
  return itemRecord?.moduleId;
}

function resolveSource(owner: TypeParameterOwner, index: ItemIndex): SourceText | undefined {
  const modId = resolveOwnerModuleId(owner, index);
  if (modId === undefined) return undefined;
  const moduleRecord = index.module(modId);
  return moduleRecord?.source;
}

function boundSpan(boundView: {
  qualifiedName(): { segments(): readonly RedToken[] } | undefined;
}): SourceSpan | undefined {
  const qualifiedName = boundView.qualifiedName();
  if (qualifiedName === undefined) return undefined;
  const segments = qualifiedName.segments();
  if (segments.length === 0) return undefined;
  const firstSpan = presentTokenSpan(segments[0]);
  const lastSpan = presentTokenSpan(segments[segments.length - 1]);
  if (firstSpan === undefined || lastSpan === undefined) return undefined;
  return SourceSpan.from(firstSpan.start, lastSpan.end);
}

function resolvedTypeItemId(type: CheckedType, index: ItemIndex): ItemId | undefined {
  if (type.kind === "source") return type.itemId;
  if (type.kind === "applied" && type.constructor.kind === "source") {
    const typeRecord = index.type(type.constructor.typeId);
    return typeRecord?.itemId;
  }
  return undefined;
}

function checkBound(
  record: TypeParameterRecord,
  input: CheckGenericSignatureInput,
  diagnostics: SemanticSurfaceDiagnostic[],
): CheckedInterfaceConstraint | undefined {
  if (record.bound === undefined) return undefined;

  const modId = resolveOwnerModuleId(input.owner, input.index);
  if (modId === undefined) return undefined;
  const source = resolveSource(input.owner, input.index);
  const typeResult = checkTypeReference({
    moduleId: modId,
    view: record.bound,
    index: input.index,
    referenceLookup: input.referenceLookup,
    coreTypes: input.coreTypes,
    allowInterfaces: true,
  });

  diagnostics.push(...typeResult.diagnostics);

  const checkedType = typeResult.type;
  if (checkedType.kind === "error") return undefined;

  const constraintSpan = boundSpan(record.bound) ?? record.nameSpan;

  // Sibling generic parameter bounds are valid (used for cycle detection)
  if (checkedType.kind === "genericParameter") {
    const sameOwner =
      input.owner.kind === checkedType.parameter.owner.kind &&
      input.owner.kind === "item" &&
      checkedType.parameter.owner.kind === "item"
        ? input.owner.itemId === checkedType.parameter.owner.itemId
        : input.owner.kind === "function" && checkedType.parameter.owner.kind === "function"
          ? input.owner.functionId === checkedType.parameter.owner.functionId
          : false;
    if (sameOwner) {
      return {
        interfaceType: checkedType,
        span: constraintSpan,
      };
    }
    diagnostics.push(
      invalidGenericBound(record.bound.qualifiedNameText() ?? record.name, constraintSpan, source, {
        moduleId: modId,
        span: constraintSpan,
        codeTieBreaker: "generic",
      }),
    );
    return undefined;
  }

  const boundTypeItemId = resolvedTypeItemId(checkedType, input.index);
  const boundItem = boundTypeItemId !== undefined ? input.index.item(boundTypeItemId) : undefined;

  if (boundItem?.kind === "interface") {
    return {
      interfaceType: checkedType,
      span: constraintSpan,
    };
  }

  diagnostics.push(
    invalidGenericBound(record.bound.qualifiedNameText() ?? record.name, constraintSpan, source, {
      moduleId: modId,
      span: constraintSpan,
      codeTieBreaker: "generic",
    }),
  );
  return undefined;
}

function collectBoundDependencies(
  bounds: readonly CheckedInterfaceConstraint[],
  input: CheckGenericSignatureInput,
): Set<number> {
  const deps = new Set<number>();
  for (const bound of bounds) {
    const type = bound.interfaceType;
    if (type.kind === "genericParameter") {
      if (type.parameter.owner.kind !== input.owner.kind) continue;
      const sameOwner =
        input.owner.kind === "item"
          ? type.parameter.owner.itemId === input.owner.itemId
          : "functionId" in input.owner &&
            "functionId" in type.parameter.owner &&
            input.owner.functionId === type.parameter.owner.functionId;
      if (sameOwner) {
        deps.add(type.parameter.index);
      }
    }
  }
  return deps;
}

function detectBoundCycles(
  parameters: readonly CheckedGenericParameter[],
  input: CheckGenericSignatureInput,
  diagnostics: SemanticSurfaceDiagnostic[],
): void {
  const edges = new Map<number, Set<number>>();
  for (let paramIndex = 0; paramIndex < parameters.length; paramIndex++) {
    edges.set(paramIndex, collectBoundDependencies(parameters[paramIndex]!.bounds, input));
  }

  const reportedCycles = new Set<string>();

  function dfs(current: number, path: number[]): void {
    const cycleIndex = path.indexOf(current);
    if (cycleIndex >= 0) {
      const cyclePath = path.slice(cycleIndex);
      const key = [...cyclePath].sort((left, right) => left - right).join(",");
      if (reportedCycles.has(key)) return;
      reportedCycles.add(key);
      const cycleNames = cyclePath.map((idx) => parameters[idx]?.name ?? `#${idx}`);
      const source = resolveSource(input.owner, input.index);
      const modId = resolveOwnerModuleId(input.owner, input.index);
      const cycleModuleId: ModuleId = modId ?? moduleId(0);
      diagnostics.push(
        genericBoundCycle(cycleNames.join(" -> "), parameters[cyclePath[0]!]!.span, source, {
          moduleId: cycleModuleId,
          span: parameters[cyclePath[0]!]!.span,
          codeTieBreaker: "generic",
        }),
      );
      return;
    }
    const deps = edges.get(current);
    if (deps !== undefined) {
      for (const dep of deps) {
        dfs(dep, [...path, current]);
      }
    }
  }

  for (let start = 0; start < parameters.length; start++) {
    dfs(start, []);
  }
}

export function checkGenericSignature(
  input: CheckGenericSignatureInput,
): CheckGenericSignatureResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];

  const records =
    input.owner.kind === "item"
      ? input.index.typeParametersForItem(input.owner.itemId)
      : input.index.typeParametersForFunction(input.owner.functionId);

  const seenNames = new Map<string, TypeParameterRecord>();
  const source = resolveSource(input.owner, input.index);
  const ownerModuleId: ModuleId | undefined = resolveOwnerModuleId(input.owner, input.index);

  const parameters = records.map((record) => {
    const previous = seenNames.get(record.name);
    if (previous !== undefined) {
      diagnostics.push(
        duplicateGenericParameter(record.name, record.nameSpan, source, {
          moduleId: ownerModuleId ?? moduleId(0),
          span: record.nameSpan,
          codeTieBreaker: "generic",
        }),
      );
    }
    seenNames.set(record.name, record);

    const bounds: CheckedInterfaceConstraint[] = [];
    const constraint = checkBound(record, input, diagnostics);
    if (constraint !== undefined) {
      bounds.push(constraint);
    }

    return {
      key: { owner: record.owner, index: record.index },
      name: record.name,
      bounds,
      span: SourceSpan.from(record.nameSpan.start, record.nameSpan.end),
    };
  });

  detectBoundCycles(parameters, input, diagnostics);

  return { signature: { owner: input.owner, parameters }, diagnostics };
}
