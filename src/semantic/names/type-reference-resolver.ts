import type { ParsedModuleGraph, ParsedModule } from "../../frontend/module-graph-parser";
import { SourceFileView } from "../../frontend/ast/declaration-views";
import type { DeclarationView } from "../../frontend/ast/declaration-views";
import type {
  HasTypeParameters,
  HasFields,
  HasMemberFunctions,
} from "../../frontend/ast/declaration-views";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import { TypeReferenceView } from "../../frontend/ast/type-views";
import type { TypeParameterView } from "../../frontend/ast/type-views";
import type { QualifiedNameView } from "../../frontend/ast/name-views";
import { ImageDeclarationView } from "../../frontend/ast/image-views";
import { ValidatedBufferDeclarationView } from "../../frontend/ast/validated-buffer-views";
import { presentTokenText, presentTokenSpan } from "../../frontend/ast/syntax-query";
import { SourceSpan, SourceText } from "../../frontend";
import type { ItemIndex } from "../item-index";
import type { ItemRecord, TypeParameterOwner } from "../item-index/item-records";
import type { ModuleId } from "../ids";
import type { CoreTypeCatalog } from "./core-types";
import type { ModuleNamespace } from "./module-namespace";
import type { MemberNamespace } from "./member-namespace";
import { ReferenceKeyBuilder } from "./reference-key";
import { ResolvedReferencesBuilder } from "./resolution-result";
import type { ResolvedReferences } from "./resolution-result";
import type { Scope } from "./scope";
import { resolvedReferenceForItem, scopeBuilder, typeParameterCandidate } from "./scope";
import * as DiagnosticsModule from "./diagnostics";
import type { NameResolutionDiagnostic, NameReferenceKind } from "./diagnostics";
import { buildMemberFunctionScope, findMemberFunctionItem } from "./member-function-scope";
import { walkPatternsInBlock } from "./pattern-reference-resolver";

export interface ModuleResolutionContext {
  readonly moduleId: ModuleId;
  readonly source: SourceText;
  readonly scope: Scope;
}

export interface NameResolutionPartResult {
  readonly references: ResolvedReferences;
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}

export interface ResolveTypeReferencesInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly moduleNamespace: ModuleNamespace;
  readonly memberNamespace: MemberNamespace;
  readonly moduleContexts: readonly ModuleResolutionContext[];
  readonly referenceKeys: ReferenceKeyBuilder;
}

function chainScope(higher: Scope, lower: Scope): Scope {
  return {
    lookup(namespace, name) {
      const result = higher.lookup(namespace, name);
      if (result.kind !== "unresolved") return result;
      return lower.lookup(namespace, name);
    },
    lookupType(name) {
      return this.lookup("type", name);
    },
    lookupValue(name) {
      return this.lookup("value", name);
    },
  };
}

export interface TypeResolutionContext {
  readonly moduleId: ModuleId;
  readonly source: SourceText;
  readonly scope: Scope;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly moduleNamespace: ModuleNamespace;
  readonly memberNamespace: MemberNamespace;
  readonly referenceKeys: ReferenceKeyBuilder;
  readonly references: ResolvedReferencesBuilder;
  readonly diagnostics: NameResolutionDiagnostic[];
}

export function resolveTypeReferences(input: ResolveTypeReferencesInput): NameResolutionPartResult {
  const {
    graph,
    index,
    coreTypes,
    moduleNamespace,
    memberNamespace,
    moduleContexts,
    referenceKeys,
  } = input;
  const references = new ResolvedReferencesBuilder();
  const diagnostics: NameResolutionDiagnostic[] = [];

  const moduleByPathKey = new Map<string, ParsedModule>();
  for (const mod of graph.modules) {
    moduleByPathKey.set(mod.path.key, mod);
  }

  const contextBase: Omit<TypeResolutionContext, "scope" | "moduleId" | "source"> = {
    index,
    coreTypes,
    moduleNamespace,
    memberNamespace,
    referenceKeys,
    references,
    diagnostics,
  };

  for (const context of moduleContexts) {
    const parsedModule = moduleByPathKey.get(index.module(context.moduleId)?.pathKey ?? "");
    if (parsedModule === undefined) continue;

    const root = parsedModule.tree.root();
    const sourceFile = SourceFileView.fromRoot(root);
    if (sourceFile === undefined) continue;

    const moduleItems = index
      .itemsInModule(context.moduleId)
      .filter((item) => item.parentItemId === undefined);

    const itemsByName = new Map<string, ItemRecord>();
    for (const item of moduleItems) {
      itemsByName.set(item.name, item);
    }

    const decls = sourceFile.declarations();
    for (const decl of decls) {
      const declName = decl.nameText();
      const topItem = declName !== undefined ? itemsByName.get(declName) : undefined;
      const tCtx: TypeResolutionContext = {
        ...contextBase,
        moduleId: context.moduleId,
        source: context.source,
        scope: context.scope,
      };

      walkDeclaration(decl, topItem, tCtx);
    }
  }

  return {
    references: references.build(),
    diagnostics: DiagnosticsModule.sortNameResolutionDiagnostics(diagnostics),
  };
}

function walkDeclaration(
  decl: DeclarationView,
  topItem: ItemRecord | undefined,
  context: TypeResolutionContext,
): void {
  if (decl instanceof FunctionDeclarationView) {
    walkFunction(decl, topItem, context);
  } else if (decl instanceof ImageDeclarationView) {
    walkImage(decl, topItem, context);
  } else if (decl instanceof ValidatedBufferDeclarationView) {
    walkValidatedBuffer(decl, topItem, context);
  } else if (hasTypeParameters(decl)) {
    walkTypeLike(decl, topItem, context);
  }
}

function hasTypeParameters(decl: DeclarationView): decl is DeclarationView & HasTypeParameters {
  return (
    typeof (decl as DeclarationView & { readonly typeParameters?: unknown }).typeParameters ===
    "function"
  );
}

function hasFields(decl: DeclarationView): decl is DeclarationView & HasFields {
  return typeof (decl as DeclarationView & { readonly fields?: unknown }).fields === "function";
}

function hasMemberFunctions(decl: DeclarationView): decl is DeclarationView & HasMemberFunctions {
  return (
    typeof (decl as DeclarationView & { readonly memberFunctions?: unknown }).memberFunctions ===
    "function"
  );
}

function buildTypeParamScopeCandidates(
  typeParams: TypeParameterView[],
  owner: TypeParameterOwner,
): ReturnType<typeof typeParameterCandidate>[] {
  return typeParams
    .map((typeParam, index) => {
      const name = typeParam.nameText();
      if (name === undefined) return undefined;
      return typeParameterCandidate(name, owner, index);
    })
    .filter(
      (candidate): candidate is ReturnType<typeof typeParameterCandidate> =>
        candidate !== undefined,
    );
}

function resolveTypeParamBounds(
  typeParams: TypeParameterView[],
  context: TypeResolutionContext,
): void {
  for (const typeParam of typeParams) {
    const bound = typeParam.bound();
    if (bound !== undefined) {
      resolveTypeReference(bound, context);
    }
  }
}

function walkFunction(
  func: FunctionDeclarationView,
  topItem: ItemRecord | undefined,
  context: TypeResolutionContext,
): void {
  const typeParams = func.typeParameters();

  let typeParamOwner: TypeParameterOwner | undefined;
  if (topItem?.functionId !== undefined) {
    typeParamOwner = { kind: "function", itemId: topItem.id, functionId: topItem.functionId };
  } else if (topItem !== undefined) {
    typeParamOwner = { kind: "item", itemId: topItem.id };
  }

  const funcScope: Scope =
    typeParams.length > 0 && typeParamOwner !== undefined
      ? chainScope(
          scopeBuilder()
            .addTier(
              "functionTypeParameters",
              buildTypeParamScopeCandidates(typeParams, typeParamOwner),
            )
            .build(),
          context.scope,
        )
      : context.scope;

  const funcCtx: TypeResolutionContext = { ...context, scope: funcScope };

  resolveTypeParamBounds(typeParams, funcCtx);

  for (const param of func.parameters()) {
    const paramType = param.type();
    if (paramType !== undefined) {
      resolveTypeReference(paramType, funcCtx);
    }
  }

  const returnType = func.returnType();
  if (returnType !== undefined) {
    resolveTypeReference(returnType, funcCtx);
  }

  walkPatternsInBlock(func, funcCtx);
}

function getSegmentSpan(
  segments: ReturnType<QualifiedNameView["segments"]>,
  index: number,
): SourceSpan | undefined {
  const seg = segments[index];
  if (seg === undefined) return undefined;
  const span = presentTokenSpan(seg);
  if (span === undefined) return undefined;
  return SourceSpan.from(span.start, span.end);
}

function walkTypeLike(
  decl: DeclarationView & HasTypeParameters,
  topItem: ItemRecord | undefined,
  context: TypeResolutionContext,
): void {
  const typeParams = decl.typeParameters();

  let typeParamOwner: TypeParameterOwner | undefined;
  if (topItem !== undefined) {
    typeParamOwner = { kind: "item", itemId: topItem.id };
  }

  const declScope: Scope =
    typeParams.length > 0 && typeParamOwner !== undefined
      ? chainScope(
          scopeBuilder()
            .addTier(
              "declarationTypeParameters",
              buildTypeParamScopeCandidates(typeParams, typeParamOwner),
            )
            .build(),
          context.scope,
        )
      : context.scope;

  const declCtx: TypeResolutionContext = { ...context, scope: declScope };

  resolveTypeParamBounds(typeParams, declCtx);

  if (hasFields(decl)) {
    for (const field of decl.fields()) {
      const fieldType = field.type();
      if (fieldType !== undefined) {
        resolveTypeReference(fieldType, declCtx);
      }
    }
  }

  if (hasMemberFunctions(decl)) {
    walkMemberFunctions(decl.memberFunctions(), topItem, declCtx);
  }
}

function walkImage(
  image: ImageDeclarationView,
  topItem: ItemRecord | undefined,
  context: TypeResolutionContext,
): void {
  for (const field of image.fields()) {
    const fieldType = field.type();
    if (fieldType !== undefined) {
      resolveTypeReference(fieldType, context);
    }
  }

  for (const devField of image.deviceFields()) {
    const fieldType = devField.type();
    if (fieldType !== undefined) {
      resolveTypeReference(fieldType, context);
    }
  }

  walkMemberFunctions(image.memberFunctions(), topItem, context);
}

function walkMemberFunctions(
  memberFunctions: readonly FunctionDeclarationView[],
  ownerItem: ItemRecord | undefined,
  context: TypeResolutionContext,
): void {
  const memberFunctionScope =
    ownerItem === undefined
      ? undefined
      : buildMemberFunctionScope({ index: context.index, ownerItem });
  const memberContext =
    memberFunctionScope === undefined
      ? context
      : { ...context, scope: chainScope(memberFunctionScope, context.scope) };

  for (const memberFunction of memberFunctions) {
    const functionItem =
      ownerItem === undefined
        ? undefined
        : findMemberFunctionItem({
            index: context.index,
            ownerItem,
            functionView: memberFunction,
          });
    walkFunction(memberFunction, functionItem ?? ownerItem, memberContext);
  }
}

function walkValidatedBuffer(
  validatedBuffer: ValidatedBufferDeclarationView,
  topItem: ItemRecord | undefined,
  context: TypeResolutionContext,
): void {
  for (const paramField of validatedBuffer.paramFields()) {
    const fieldType = paramField.type();
    if (fieldType !== undefined) {
      resolveTypeReference(fieldType, context);
    }
  }

  for (const layoutField of validatedBuffer.layoutFields()) {
    const fieldType = layoutField.type();
    if (fieldType !== undefined) {
      resolveTypeReference(fieldType, context);
    }
  }

  for (const deriveSection of validatedBuffer.deriveSections()) {
    for (const derivedField of deriveSection.fields()) {
      const fieldType = derivedField.type();
      if (fieldType !== undefined) {
        resolveTypeReference(fieldType, context);
      }
    }
  }
}

export function resolveTypeReference(
  typeRef: TypeReferenceView,
  context: TypeResolutionContext,
): void {
  const qualifiedName = typeRef.qualifiedName();
  if (qualifiedName === undefined) return;

  const segments = qualifiedName.segments();
  const segTexts = segments
    .map((token) => presentTokenText(token))
    .filter((token): token is string => token !== undefined);

  if (segTexts.length === 0) return;

  const firstSpan = presentTokenSpan(segments[0]);
  const lastSpan = presentTokenSpan(segments[segments.length - 1]);
  if (firstSpan === undefined || lastSpan === undefined) return;
  const qnSpan = SourceSpan.from(firstSpan.start, lastSpan.end);

  if (segTexts.length === 1) {
    resolveSimpleTypeName(segTexts[0]!, qnSpan, typeRef, context);
  } else {
    resolveQualifiedTypeRef(segments, segTexts, qnSpan, typeRef, context);
  }
}

function resolveSimpleTypeName(
  name: string,
  nameSpan: SourceSpan,
  typeRef: TypeReferenceView,
  context: TypeResolutionContext,
): void {
  const coreType = context.coreTypes.byName(name);
  const scopeResult = context.scope.lookupType(name);

  if (coreType !== undefined) {
    if (scopeResult.kind === "resolved") {
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: nameSpan,
        kind: "typeName",
      });
      context.diagnostics.push(
        DiagnosticsModule.builtinTypeShadowed({
          source: context.source,
          span: nameSpan,
          order: {
            moduleId: context.moduleId,
            span: nameSpan,
            kind: "typeName",
            ordinal: key.ordinal,
          },
          name,
        }),
      );
    }
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: nameSpan,
      kind: "typeName",
    });
    context.references.add(key, { kind: "builtinType", coreTypeId: coreType.id });
  } else if (scopeResult.kind === "resolved") {
    const refKind: NameReferenceKind =
      scopeResult.reference.kind === "typeParameter" ? "typeParameter" : "typeName";
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: nameSpan,
      kind: refKind,
    });
    context.references.add(key, scopeResult.reference);
  } else {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: nameSpan,
      kind: "typeName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: nameSpan,
        order: {
          moduleId: context.moduleId,
          span: nameSpan,
          kind: "typeName",
          ordinal: key.ordinal,
        },
        name,
      }),
    );
  }

  resolveTypeArguments(typeRef, context);
}

function resolveQualifiedTypeRef(
  segments: ReturnType<QualifiedNameView["segments"]>,
  segTexts: string[],
  qnSpan: SourceSpan,
  typeRef: TypeReferenceView,
  context: TypeResolutionContext,
): void {
  const prefixResult = context.moduleNamespace.resolveQualifiedPrefix(segTexts);

  if (prefixResult.kind === "noModulePrefix") {
    const firstResult = context.scope.lookupType(segTexts[0]!);
    if (firstResult.kind === "resolved") {
      if (segTexts.length === 2) {
        // Two-segment name like Packet.value: treat as owner-qualified member access
        const firstSpan = getSegmentSpan(segments, 0);
        if (firstSpan === undefined) return;
        const ownerRef = firstResult.reference;
        if (ownerRef.kind === "type" || ownerRef.kind === "item") {
          const ownerItemId = ownerRef.kind === "type" ? ownerRef.itemId : ownerRef.itemId;
          const memberName = segTexts[1]!;
          const memberSpan = getSegmentSpan(segments, 1);
          if (memberSpan === undefined) return;

          const memberResult = context.memberNamespace.resolveMember({
            ownerItemId,
            name: memberName,
          });

          if (memberResult.kind === "resolved") {
            const memberKey = context.referenceKeys.next({
              moduleId: context.moduleId,
              span: memberSpan,
              kind: "memberName",
            });
            context.references.add(memberKey, memberResult.reference);
          } else {
            const key = context.referenceKeys.next({
              moduleId: context.moduleId,
              span: firstSpan,
              kind: "typeName",
            });
            context.diagnostics.push(
              DiagnosticsModule.qualifierNotOwner({
                source: context.source,
                span: firstSpan,
                order: {
                  moduleId: context.moduleId,
                  span: firstSpan,
                  kind: "typeName",
                  ordinal: key.ordinal,
                },
                qualifier: segTexts[0]!,
              }),
            );
          }
        } else {
          const firstSegSpan = getSegmentSpan(segments, 0);
          if (firstSegSpan === undefined) return;
          const key = context.referenceKeys.next({
            moduleId: context.moduleId,
            span: firstSegSpan,
            kind: "typeName",
          });
          context.diagnostics.push(
            DiagnosticsModule.qualifierNotOwner({
              source: context.source,
              span: firstSegSpan,
              order: {
                moduleId: context.moduleId,
                span: firstSegSpan,
                kind: "typeName",
                ordinal: key.ordinal,
              },
              qualifier: segTexts[0]!,
            }),
          );
        }
      } else {
        // 3+ segments: first segment is expected to be a module but resolved as item
        const firstSegSpan = getSegmentSpan(segments, 0);
        if (firstSegSpan === undefined) return;
        const key = context.referenceKeys.next({
          moduleId: context.moduleId,
          span: firstSegSpan,
          kind: "typeName",
        });
        context.diagnostics.push(
          DiagnosticsModule.qualifierNotModule({
            source: context.source,
            span: firstSegSpan,
            order: {
              moduleId: context.moduleId,
              span: firstSegSpan,
              kind: "typeName",
              ordinal: key.ordinal,
            },
            qualifier: segTexts[0]!,
          }),
        );
      }
    } else {
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: qnSpan,
        kind: "typeName",
      });
      context.diagnostics.push(
        DiagnosticsModule.unresolvedModule({
          source: context.source,
          span: qnSpan,
          order: {
            moduleId: context.moduleId,
            span: qnSpan,
            kind: "typeName",
            ordinal: key.ordinal,
          },
          moduleName: segTexts[0]!,
        }),
      );
    }
    return;
  }

  if (prefixResult.kind === "prefixConsumesAllSegments") {
    const qnText = segTexts.join(".");
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: qnSpan,
      kind: "typeName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: qnSpan,
        order: { moduleId: context.moduleId, span: qnSpan, kind: "typeName", ordinal: key.ordinal },
        name: `Qualified name '${qnText}' resolves to a module, not an item.`,
      }),
    );
    return;
  }

  // Resolved
  const targetItems = context.index.itemsInModule(prefixResult.moduleId);
  const matchedItems = targetItems.filter((item) => item.name === prefixResult.itemSegment);

  if (matchedItems.length === 0) {
    const itemSegIdx = prefixResult.moduleSegments.length;
    const itemSpan = getSegmentSpan(segments, itemSegIdx);
    if (itemSpan === undefined) return;
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: itemSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: itemSpan,
        order: {
          moduleId: context.moduleId,
          span: itemSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: prefixResult.itemSegment,
      }),
    );
    return;
  }

  if (matchedItems.length > 1) {
    const itemSegIdx = prefixResult.moduleSegments.length;
    const itemSpan = getSegmentSpan(segments, itemSegIdx);
    if (itemSpan === undefined) return;
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: itemSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.ambiguousName({
        source: context.source,
        span: itemSpan,
        order: {
          moduleId: context.moduleId,
          span: itemSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: prefixResult.itemSegment,
        candidates: matchedItems.map((matchedItem) => ({
          name: matchedItem.name,
          modulePath:
            context.index.module(matchedItem.moduleId)?.pathKey ?? String(matchedItem.moduleId),
          itemKind: matchedItem.kind,
          denseId: Number(matchedItem.id),
        })),
      }),
    );
    return;
  }

  const item = matchedItems[0]!;
  const itemSegIdx = prefixResult.moduleSegments.length;
  const itemSpan = getSegmentSpan(segments, itemSegIdx);
  if (itemSpan === undefined) return;

  const ref = resolvedReferenceForItem(context.index, item);
  const refKey = context.referenceKeys.next({
    moduleId: context.moduleId,
    span: itemSpan,
    kind: "moduleQualifiedItem",
  });
  context.references.add(refKey, ref);

  // Handle member segments
  if (prefixResult.memberSegments.length > 0) {
    if (item.typeId !== undefined) {
      for (let index = 0; index < prefixResult.memberSegments.length; index++) {
        const memberName = prefixResult.memberSegments[index]!;
        const memberSpan = getSegmentSpan(segments, prefixResult.moduleSegments.length + 1 + index);
        if (memberSpan === undefined) continue;

        const memberResult = context.memberNamespace.resolveMember({
          ownerItemId: item.id,
          name: memberName,
        });

        if (memberResult.kind === "resolved") {
          const memberKey = context.referenceKeys.next({
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
          });
          context.references.add(memberKey, memberResult.reference);
        } else if (memberResult.kind === "unresolved") {
          const memberKey = context.referenceKeys.next({
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
          });
          context.diagnostics.push(
            DiagnosticsModule.qualifierNotOwner({
              source: context.source,
              span: itemSpan,
              order: {
                moduleId: context.moduleId,
                span: itemSpan,
                kind: "memberName",
                ordinal: memberKey.ordinal,
              },
              qualifier: item.name,
            }),
          );
        }
      }
    } else {
      const memberSpan = getSegmentSpan(segments, prefixResult.moduleSegments.length + 1);
      if (memberSpan === undefined) return;
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: itemSpan,
        kind: "typeName",
      });
      context.diagnostics.push(
        DiagnosticsModule.qualifierNotOwner({
          source: context.source,
          span: itemSpan,
          order: {
            moduleId: context.moduleId,
            span: itemSpan,
            kind: "typeName",
            ordinal: key.ordinal,
          },
          qualifier: item.name,
        }),
      );
    }
  }

  resolveTypeArguments(typeRef, context);
}

function resolveTypeArguments(typeRef: TypeReferenceView, context: TypeResolutionContext): void {
  for (const arg of typeRef.typeArguments()) {
    resolveTypeReference(arg, context);
  }
}
