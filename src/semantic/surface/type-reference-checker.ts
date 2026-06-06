import type { CoreTypeId, ModuleId, TargetTypeId, TypeId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { CoreTypeCatalog } from "../names/core-types";
import type { CheckedType } from "./type-model";
import {
  coreCheckedType,
  sourceCheckedType,
  genericParameterCheckedType,
  appliedType,
  errorCheckedType,
} from "./type-model";
import { concreteKind } from "./resource-kind";
import type { SurfaceReferenceLookup, ReferenceLookupResult } from "./reference-lookup";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { invalidTypeReference, nonTypeReference, wrongGenericArgumentCount } from "./diagnostics";
import type { SourceSpan, SourceText, TypeReferenceView } from "../../frontend";
import { SourceSpan as SourceSpanConstructor, presentTokenSpan } from "../../frontend";

export interface CheckTypeReferenceInput {
  readonly moduleId: ModuleId;
  readonly view: TypeReferenceView | undefined;
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
}

export interface CheckTypeReferenceResult {
  readonly type: CheckedType;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function qualifiedNameSpan(qualifiedName: { segments(): readonly any[] }): SourceSpan | undefined {
  const segments = qualifiedName.segments();
  if (segments.length === 0) return undefined;
  const firstSpan = presentTokenSpan(segments[0]);
  const lastSpan = presentTokenSpan(segments[segments.length - 1]);
  if (firstSpan === undefined || lastSpan === undefined) return undefined;
  return SourceSpanConstructor.from(firstSpan.start, lastSpan.end);
}

function declaredTypeParameterCount(
  constructorType: CheckedType,
  index: ItemIndex,
): number | undefined {
  if (constructorType.kind === "source") {
    return index.typeParametersForItem(constructorType.itemId).length;
  }
  return undefined;
}

function checkedTypeFromLookupResult(
  lookup: ReferenceLookupResult,
  input: CheckTypeReferenceInput & { span: SourceSpan; source: SourceText },
): CheckTypeReferenceResult {
  if (lookup.kind === "missing") {
    const name = input.view?.qualifiedNameText() ?? "<unknown>";
    return {
      type: errorCheckedType(),
      diagnostics: [
        invalidTypeReference({
          source: input.source,
          span: input.span,
          order: { moduleId: input.moduleId, span: input.span, codeTieBreaker: "type" },
          typeName: name,
        }),
      ],
    };
  }

  if (lookup.kind === "ambiguous") {
    const name = input.view?.qualifiedNameText() ?? "<unknown>";
    const relatedInformation = lookup.entries.map((entry) => ({
      message: `Candidate ordinal ${entry.key.ordinal}: ${name}`,
      span: entry.key.span,
      source: input.source,
    }));
    return {
      type: errorCheckedType(),
      diagnostics: [
        {
          code: "SURFACE_INVALID_TYPE_REFERENCE" as const,
          message: `Ambiguous type reference '${name}'.`,
          severity: "error" as const,
          source: input.source,
          span: input.span,
          order: { moduleId: input.moduleId, span: input.span, codeTieBreaker: "type" },
          relatedInformation,
        },
      ],
    };
  }

  const entry = lookup.entry;
  return checkedTypeFromReference(entry, input);
}

function checkedTypeFromReference(
  entry: { readonly reference: { readonly kind: string } },
  input: CheckTypeReferenceInput & { span: SourceSpan; source: SourceText },
): CheckTypeReferenceResult {
  const reference = entry.reference as any;

  switch (reference.kind) {
    case "builtinType":
      return checkTypeArguments(coreCheckedType(reference.coreTypeId), input);
    case "type":
      return checkTypeArguments(
        sourceCheckedType({ itemId: reference.itemId, typeId: reference.typeId }),
        input,
      );
    case "typeParameter":
      return {
        type: genericParameterCheckedType({ owner: reference.owner, index: reference.index }),
        diagnostics: [],
      };
    default: {
      const name = input.view?.qualifiedNameText() ?? "<unknown>";
      return {
        type: errorCheckedType(),
        diagnostics: [
          nonTypeReference(name, input.span, input.source, {
            moduleId: input.moduleId,
            span: input.span,
            codeTieBreaker: "type",
          }),
        ],
      };
    }
  }
}

function checkTypeArguments(
  constructorType: CheckedType,
  input: CheckTypeReferenceInput & { span: SourceSpan; source: SourceText },
): CheckTypeReferenceResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const typeArgs = input.view?.typeArguments() ?? [];
  const resolvedTypeArgs: CheckedType[] = [];

  const expectedArity = declaredTypeParameterCount(constructorType, input.index);
  if (expectedArity !== undefined && typeArgs.length !== expectedArity) {
    const name = input.view?.qualifiedNameText() ?? "<unknown>";
    diagnostics.push(
      wrongGenericArgumentCount(name, expectedArity, typeArgs.length, input.span, input.source, {
        moduleId: input.moduleId,
        span: input.span,
        codeTieBreaker: "type",
      }),
    );
  }

  for (const argView of typeArgs) {
    const argResult = checkTypeReference({ ...input, view: argView });
    resolvedTypeArgs.push(argResult.type);
    diagnostics.push(...argResult.diagnostics);
  }

  if (resolvedTypeArgs.length === 0) {
    return { type: constructorType, diagnostics };
  }

  const constructorId = typeConstructorIdFromCheckedType(constructorType);
  if (constructorId === undefined) {
    return { type: errorCheckedType(), diagnostics };
  }

  if (
    diagnostics.some((diagnostic) => diagnostic.code === "SURFACE_WRONG_GENERIC_ARGUMENT_COUNT")
  ) {
    return { type: errorCheckedType(), diagnostics };
  }

  const appliedResourceKind =
    constructorType.kind === "core" ? concreteKind("Copy") : { kind: "error" as const };

  return {
    type: appliedType({
      constructor: constructorId,
      arguments: resolvedTypeArgs,
      resourceKind: appliedResourceKind,
    }),
    diagnostics,
  };
}

export type TypeConstructorId =
  | { readonly kind: "source"; readonly typeId: TypeId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

function typeConstructorIdFromCheckedType(type: CheckedType): TypeConstructorId | undefined {
  switch (type.kind) {
    case "core":
      return { kind: "core", coreTypeId: type.coreTypeId };
    case "source":
      return { kind: "source", typeId: type.typeId };
    case "target":
      return { kind: "target", targetTypeId: type.targetTypeId };
    default:
      return undefined;
  }
}

export function checkTypeReference(input: CheckTypeReferenceInput): CheckTypeReferenceResult {
  if (input.view === undefined) {
    return { type: errorCheckedType(), diagnostics: [] };
  }

  const qualifiedName = input.view.qualifiedName();
  if (qualifiedName === undefined) {
    return { type: errorCheckedType(), diagnostics: [] };
  }

  const span = qualifiedNameSpan(qualifiedName);
  if (span === undefined) {
    return { type: errorCheckedType(), diagnostics: [] };
  }

  const source = qualifiedName.source;

  let lookup = input.referenceLookup.findOne({
    moduleId: input.moduleId,
    span,
    kind: "typeName",
  });

  if (lookup.kind === "missing") {
    lookup = input.referenceLookup.findOne({
      moduleId: input.moduleId,
      span,
      kind: "typeParameter",
    });
  }

  return checkedTypeFromLookupResult(lookup, { ...input, span, source });
}
