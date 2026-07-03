import type { ParsedModuleGraph } from "../../frontend/module-graph-parser";
import type { ItemIndex } from "../item-index/item-index";
import type { CoreTypeCatalog } from "./core-types";
import type { PlatformPrimitiveNameCatalog } from "./platform-primitives";
import type { TargetTypeKindSpec } from "../surface/platform-surface";
import { ResolvedReferencesBuilder, ResolvedPlatformBindingsBuilder } from "./resolution-result";
import type { ResolvedReferences, ResolvedPlatformBindings } from "./resolution-result";
import { ReferenceKeyBuilder } from "./reference-key";
import { buildModuleNamespace } from "./module-namespace";
import { buildMemberNamespace } from "./member-namespace";
import { resolveImports } from "./import-resolver";
import { resolveTypeReferences } from "./type-reference-resolver";
import type { ModuleResolutionContext } from "./type-reference-resolver";
import { bindPlatformFunctions } from "./platform-binding";
import { resolveExpressions } from "./expression-resolver";
import { scopeBuilder, typeCandidate, functionCandidate, itemCandidate } from "./scope";
import type { ScopeCandidate } from "./scope";
import { sortNameResolutionDiagnostics } from "./diagnostics";
import type { NameResolutionDiagnostic } from "./diagnostics";
import type { CompilerIntrinsicNameCatalog } from "./reference";

export interface ResolveNamesInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly platformPrimitiveNames: PlatformPrimitiveNameCatalog;
  readonly compilerIntrinsics?: CompilerIntrinsicNameCatalog;
  readonly targetTypes?: readonly TargetTypeKindSpec[];
}

export interface ResolveNamesResult {
  readonly references: ResolvedReferences;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}

export function resolveNames(input: ResolveNamesInput): ResolveNamesResult {
  const { graph, index, coreTypes, platformPrimitiveNames } = input;
  const referenceKeys = new ReferenceKeyBuilder();

  const moduleNamespace = buildModuleNamespace(index);
  const memberNamespace = buildMemberNamespace(index);

  const importResult = resolveImports({
    graph,
    index,
    moduleNamespace,
    referenceKeys,
  });

  const moduleByPathKey = new Map<string, (typeof graph.modules)[number]>();
  for (const mod of graph.modules) {
    moduleByPathKey.set(mod.path.key, mod);
  }

  const moduleContexts: ModuleResolutionContext[] = [];

  for (const mod of index.modules()) {
    const parsedModule = moduleByPathKey.get(mod.pathKey);
    if (parsedModule === undefined) continue;

    const source = parsedModule.source;
    const moduleItems = index.itemsInModule(mod.id);
    const builder = scopeBuilder();

    const ownCandidates: ScopeCandidate[] = [];
    for (const item of moduleItems) {
      if (item.parentItemId !== undefined) continue;

      if (item.typeId !== undefined) {
        ownCandidates.push(typeCandidate(item.name, item.id, item.typeId));
      } else if (item.functionId !== undefined) {
        ownCandidates.push(functionCandidate(item.name, item.id, item.functionId));
      } else if (item.imageId !== undefined) {
        ownCandidates.push({
          namespace: "value",
          name: item.name,
          reference: { kind: "image", itemId: item.id, imageId: item.imageId },
          display: {
            modulePath: "",
            itemKind: "image",
            name: item.name,
            denseId: item.id as number,
          },
        });
      } else {
        ownCandidates.push(itemCandidate("type", item.name, item.id));
        ownCandidates.push(itemCandidate("value", item.name, item.id));
      }
    }
    if (ownCandidates.length > 0) {
      builder.addTier("moduleItems", ownCandidates);
    }

    const targetTypeCandidates = targetTypeScopeCandidates(input.targetTypes ?? []);
    if (targetTypeCandidates.length > 0) {
      builder.addTier("targetTypes", targetTypeCandidates);
    }

    const intrinsicCandidates = compilerIntrinsicScopeCandidates(input.compilerIntrinsics);
    if (intrinsicCandidates.length > 0) {
      builder.addTier("compilerIntrinsics", intrinsicCandidates);
    }

    const importedScope = importResult.importedScopes.find((scope) => scope.moduleId === mod.id);
    if (importedScope !== undefined && importedScope.candidates.length > 0) {
      builder.addTier("imports", importedScope.candidates);
    }

    moduleContexts.push({
      moduleId: mod.id,
      source,
      scope: builder.build(),
    });
  }

  const typeResult = resolveTypeReferences({
    graph,
    index,
    coreTypes,
    moduleNamespace,
    memberNamespace,
    moduleContexts,
    referenceKeys,
  });

  const platformResult = bindPlatformFunctions({
    index,
    platformPrimitiveNames,
  });

  const expressionResult = resolveExpressions({
    graph,
    index,
    coreTypes,
    moduleNamespace,
    memberNamespace,
    moduleContexts,
    referenceKeys,
  });

  const referencesBuilder = new ResolvedReferencesBuilder();
  referencesBuilder.merge(importResult.references);
  referencesBuilder.merge(typeResult.references);
  referencesBuilder.merge(expressionResult.references);

  const bindingsBuilder = new ResolvedPlatformBindingsBuilder();
  bindingsBuilder.merge(platformResult.bindings);

  const allDiagnostics: NameResolutionDiagnostic[] = [
    ...importResult.diagnostics,
    ...typeResult.diagnostics,
    ...platformResult.diagnostics,
    ...expressionResult.diagnostics,
  ];

  return {
    references: referencesBuilder.build(),
    platformBindings: bindingsBuilder.build(),
    diagnostics: sortNameResolutionDiagnostics(allDiagnostics),
  };
}

function targetTypeScopeCandidates(targetTypes: readonly TargetTypeKindSpec[]): ScopeCandidate[] {
  return targetTypes.map((targetType) => {
    const fullName = String(targetType.targetTypeId);
    const name = fullName.includes(".") ? fullName.slice(fullName.lastIndexOf(".") + 1) : fullName;
    return {
      namespace: "type" as const,
      name,
      reference: { kind: "targetType" as const, targetTypeId: targetType.targetTypeId },
      display: { modulePath: "", itemKind: "targetType", name, denseId: 0 },
    };
  });
}

function compilerIntrinsicScopeCandidates(
  catalog: CompilerIntrinsicNameCatalog | undefined,
): ScopeCandidate[] {
  return (catalog?.intrinsics ?? []).map((intrinsic) => ({
    namespace: "value" as const,
    name: intrinsic.sourceName,
    reference: { kind: "compilerIntrinsic" as const, ...intrinsic },
    display: {
      modulePath: "",
      itemKind: "compilerIntrinsic",
      name: intrinsic.sourceName,
      denseId: 0,
    },
  }));
}
