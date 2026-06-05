import type { ItemIndex } from "../item-index";
import type { TypeParameterOwner, TypeParameterRecord } from "../item-index/item-records";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import type { CoreTypeCatalog } from "../names/core-types";
import { checkTypeReference } from "./type-reference-checker";
import type { CheckedType } from "./type-model";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { duplicateGenericParameter, invalidGenericBound } from "./diagnostics";
import type { ModuleId } from "../ids";
import { SourceSpan, presentTokenSpan } from "../../frontend";

export interface CheckedGenericParameter {
  readonly key: { owner: TypeParameterOwner; index: number };
  readonly name: string;
  readonly bounds: readonly CheckedInterfaceConstraint[];
  readonly span: SourceSpan;
}

export interface CheckedInterfaceConstraint {
  readonly interfaceType: CheckedType;
  readonly arguments: readonly CheckedType[];
  readonly span: SourceSpan;
}

export interface CheckedGenericSignature {
  readonly owner: TypeParameterOwner;
  readonly parameters: readonly CheckedGenericParameter[];
  readonly constraints: readonly CheckedInterfaceConstraint[];
}

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

function resolveModuleId(owner: TypeParameterOwner, index: ItemIndex): ModuleId | undefined {
  const itemRecord = index.item(owner.itemId);
  return itemRecord?.moduleId;
}

function resolveSource(owner: TypeParameterOwner, index: ItemIndex) {
  const moduleId = resolveModuleId(owner, index);
  if (moduleId === undefined) return undefined;
  const moduleRecord = index.module(moduleId);
  return moduleRecord?.source;
}

function boundSpan(boundView: {
  qualifiedName(): { segments(): readonly any[] } | undefined;
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

function resolvedTypeItemId(type: CheckedType): number | undefined {
  if (type.kind === "source") return type.itemId as number;
  if (type.kind === "applied" && type.constructor.kind === "source")
    return type.constructor.typeId as number;
  return undefined;
}

function checkBound(
  record: TypeParameterRecord,
  input: CheckGenericSignatureInput,
  diagnostics: SemanticSurfaceDiagnostic[],
): CheckedInterfaceConstraint | undefined {
  if (record.bound === undefined) return undefined;

  const moduleId = resolveModuleId(input.owner, input.index);
  const typeResult = checkTypeReference({
    moduleId: moduleId as any,
    view: record.bound,
    index: input.index,
    referenceLookup: input.referenceLookup,
    coreTypes: input.coreTypes,
  });

  diagnostics.push(...typeResult.diagnostics);

  const checkedType = typeResult.type;
  if (checkedType.kind === "error") return undefined;

  const boundTypeItemId = resolvedTypeItemId(checkedType);
  const boundItem =
    boundTypeItemId !== undefined ? input.index.item(boundTypeItemId as any) : undefined;
  const constraintSpan = boundSpan(record.bound) ?? record.nameSpan;

  if (boundItem?.kind === "interface") {
    return {
      interfaceType: checkedType,
      arguments: [],
      span: constraintSpan,
    };
  }

  if (checkedType.kind !== "genericParameter") {
    const source = resolveSource(input.owner, input.index);
    diagnostics.push(
      invalidGenericBound(
        record.bound.qualifiedNameText() ?? record.name,
        constraintSpan,
        source as any,
        {
          moduleId: moduleId as any,
          span: constraintSpan,
          codeTieBreaker: "generic",
        },
      ),
    );
  }

  return undefined;
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
  const moduleId = resolveModuleId(input.owner, input.index);

  const parameters = records.map((record, index) => {
    const previous = seenNames.get(record.name);
    if (previous !== undefined) {
      diagnostics.push(
        duplicateGenericParameter(record.name, record.nameSpan, source as any, {
          moduleId: moduleId as any,
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
      key: { owner: input.owner, index },
      name: record.name,
      bounds,
      span: SourceSpan.from(record.nameSpan.start, record.nameSpan.end),
    };
  });

  return { signature: { owner: input.owner, parameters, constraints: [] }, diagnostics };
}
