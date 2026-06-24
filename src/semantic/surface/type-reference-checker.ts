import type { CoreTypeId, ModuleId, TargetTypeId, TypeId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { CoreTypeCatalog } from "../names/core-types";
import type { CheckedType } from "./type-model";
import type { CheckedResourceKind } from "./resource-kind";
import { concreteKind, errorKind, joinResourceKinds, parametricKind } from "./resource-kind";
import {
  coreCheckedType,
  sourceCheckedType,
  genericParameterCheckedType,
  appliedType,
  errorCheckedType,
  checkedTypesEqual,
} from "./type-model";
import type { SurfaceReferenceLookup, ReferenceLookupResult } from "./reference-lookup";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import {
  invalidInterfaceConstraint,
  invalidTypeReference,
  nonTypeReference,
  wrongGenericArgumentCount,
} from "./diagnostics";
import type { ResolvedReferenceEntry } from "../names/reference";
import type { SourceSpan, SourceText, TypeReferenceView } from "../../frontend";
import { SourceSpan as SourceSpanConstructor, presentTokenSpan } from "../../frontend";
import type { RedToken } from "../../frontend/syntax";

export interface CheckTypeReferenceInput {
  readonly moduleId: ModuleId;
  readonly view: TypeReferenceView | undefined;
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
  readonly allowInterfaces?: boolean;
}

export interface CheckTypeReferenceResult {
  readonly type: CheckedType;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function qualifiedNameSpan(qualifiedName: {
  segments(): readonly RedToken[];
}): SourceSpan | undefined {
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

function declaredTypeParameterBounds(
  constructorType: CheckedType,
  index: ItemIndex,
): readonly import("../item-index/item-records").TypeParameterRecord[] {
  if (constructorType.kind !== "source") return [];
  return index.typeParametersForItem(constructorType.itemId);
}

function typeReferenceSpan(view: TypeReferenceView): SourceSpan | undefined {
  const qualifiedName = view.qualifiedName();
  return qualifiedName !== undefined ? qualifiedNameSpan(qualifiedName) : undefined;
}

function argumentSatisfiesBound(input: {
  readonly argument: CheckedType;
  readonly bound: CheckedType;
  readonly checkInput: CheckTypeReferenceInput & { span: SourceSpan; source: SourceText };
  readonly visitedGenericParameters?: ReadonlySet<string>;
}): boolean {
  if (input.bound.kind === "error" || input.argument.kind === "error") return true;
  if (checkedTypesEqual(input.argument, input.bound)) return true;

  if (input.argument.kind === "genericParameter") {
    const owner = input.argument.parameter.owner;
    const parameterKey =
      owner.kind === "item"
        ? `item:${owner.itemId}:${input.argument.parameter.index}`
        : `function:${owner.functionId}:${input.argument.parameter.index}`;
    if (input.visitedGenericParameters?.has(parameterKey)) return false;

    const records =
      owner.kind === "item"
        ? input.checkInput.index.typeParametersForItem(owner.itemId)
        : input.checkInput.index.typeParametersForFunction(owner.functionId);
    const record = records[input.argument.parameter.index];
    if (record?.bound === undefined) return false;
    const boundResult = checkTypeReference({
      ...input.checkInput,
      view: record.bound,
      allowInterfaces: true,
    });
    const nextVisited = new Set(input.visitedGenericParameters ?? []);
    nextVisited.add(parameterKey);
    return argumentSatisfiesBound({
      argument: boundResult.type,
      bound: input.bound,
      checkInput: input.checkInput,
      visitedGenericParameters: nextVisited,
    });
  }

  return false;
}

function checkTypeArgumentBounds(input: {
  readonly constructorType: CheckedType;
  readonly argumentTypes: readonly CheckedType[];
  readonly argumentViews: readonly TypeReferenceView[];
  readonly checkInput: CheckTypeReferenceInput & { span: SourceSpan; source: SourceText };
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): void {
  const parameters = declaredTypeParameterBounds(input.constructorType, input.checkInput.index);
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index]!;
    const argument = input.argumentTypes[index];
    if (argument === undefined || parameter.bound === undefined) continue;

    const boundResult = checkTypeReference({
      ...input.checkInput,
      view: parameter.bound,
      allowInterfaces: true,
    });
    input.diagnostics.push(...boundResult.diagnostics);
    if (
      argumentSatisfiesBound({
        argument,
        bound: boundResult.type,
        checkInput: input.checkInput,
        visitedGenericParameters: new Set(),
      })
    ) {
      continue;
    }

    const argView = input.argumentViews[index];
    const span =
      argView !== undefined
        ? (typeReferenceSpan(argView) ?? input.checkInput.span)
        : input.checkInput.span;
    input.diagnostics.push(
      invalidInterfaceConstraint(
        argView?.qualifiedNameText() ?? "<unknown>",
        span,
        input.checkInput.source,
        {
          moduleId: input.checkInput.moduleId,
          span,
          codeTieBreaker: "type",
        },
      ),
    );
  }
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
        invalidTypeReference({
          source: input.source,
          span: input.span,
          order: { moduleId: input.moduleId, span: input.span, codeTieBreaker: "type" },
          typeName: name,
          relatedInformation,
        }),
      ],
    };
  }

  const entry = lookup.entry;
  return checkedTypeFromReference(entry, input);
}

function checkedTypeFromReference(
  entry: ResolvedReferenceEntry,
  input: CheckTypeReferenceInput & { span: SourceSpan; source: SourceText },
): CheckTypeReferenceResult {
  const reference = entry.reference;

  switch (reference.kind) {
    case "builtinType":
      return checkTypeArguments(coreCheckedType(reference.coreTypeId), input);
    case "type": {
      if (!input.allowInterfaces) {
        const itemRecord = input.index.item(reference.itemId);
        if (itemRecord?.kind === "interface") {
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
      return checkTypeArguments(
        sourceCheckedType({ itemId: reference.itemId, typeId: reference.typeId }),
        input,
      );
    }
    case "typeParameter":
      return checkTypeArguments(
        genericParameterCheckedType({ owner: reference.owner, index: reference.index }),
        input,
      );
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
  const maxArity = expectedArity ?? 0;
  if (typeArgs.length !== maxArity) {
    const name = input.view?.qualifiedNameText() ?? "<unknown>";
    diagnostics.push(
      wrongGenericArgumentCount(name, maxArity, typeArgs.length, input.span, input.source, {
        moduleId: input.moduleId,
        span: input.span,
        codeTieBreaker: "type",
      }),
    );
    return { type: errorCheckedType(), diagnostics };
  }

  for (const argView of typeArgs) {
    const argResult = checkTypeReference({ ...input, view: argView });
    resolvedTypeArgs.push(argResult.type);
    diagnostics.push(...argResult.diagnostics);
  }

  checkTypeArgumentBounds({
    constructorType,
    argumentTypes: resolvedTypeArgs,
    argumentViews: typeArgs,
    checkInput: input,
    diagnostics,
  });

  if (resolvedTypeArgs.length === 0) {
    return { type: constructorType, diagnostics };
  }

  const constructorId = typeConstructorIdFromCheckedType(constructorType);
  if (constructorId === undefined) {
    return { type: errorCheckedType(), diagnostics };
  }

  return {
    type: appliedType({
      constructor: constructorId,
      arguments: resolvedTypeArgs,
      resourceKind: resourceKindForAppliedType(resolvedTypeArgs),
    }),
    diagnostics,
  };
}

function resourceKindForAppliedType(arguments_: readonly CheckedType[]): CheckedResourceKind {
  if (arguments_.length === 0) return concreteKind("Copy");
  return joinResourceKinds(arguments_.map(resourceKindSeedForType));
}

function resourceKindSeedForType(type: CheckedType): CheckedResourceKind {
  switch (type.kind) {
    case "genericParameter":
      return parametricKind(type.parameter);
    case "error":
      return errorKind();
    case "applied":
      return type.resourceKind;
    case "core":
      return type.coreTypeId === "Never" ? concreteKind("Never") : concreteKind("Copy");
    case "source":
    case "target":
      return concreteKind("Copy");
  }
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
