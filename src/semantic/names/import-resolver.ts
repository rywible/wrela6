import type { ParsedModule, ParsedModuleGraph } from "../../frontend/module-graph-parser";
import { SourceFileView } from "../../frontend/ast/declaration-views";
import { presentTokenText, presentTokenSpan } from "../../frontend/ast/syntax-query";
import { SourceSpan } from "../../shared";
import type { ItemIndex } from "../item-index/item-index";
import type { ItemRecord } from "../item-index/item-records";
import type { ModuleId } from "../ids";
import type { ModuleNamespace } from "./module-namespace";
import { ReferenceKeyBuilder } from "./reference-key";
import { ResolvedReferencesBuilder } from "./resolution-result";
import type { ResolvedReferences } from "./resolution-result";
import type { ScopeCandidate } from "./scope";
import { resolvedReferenceForItem, typeCandidate, functionCandidate, itemCandidate } from "./scope";
import type { NameResolutionDiagnostic } from "./diagnostics";
import { unresolvedModule, unresolvedImport, privateImport, ambiguousImport } from "./diagnostics";

export interface ResolveImportsInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly moduleNamespace: ModuleNamespace;
  readonly referenceKeys: ReferenceKeyBuilder;
}

export interface ImportedScopeByModule {
  readonly moduleId: ModuleId;
  readonly candidates: readonly ScopeCandidate[];
}

export interface ImportResolutionResult {
  readonly references: ResolvedReferences;
  readonly importedScopes: readonly ImportedScopeByModule[];
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}

export function resolveImports(input: ResolveImportsInput): ImportResolutionResult {
  const { graph, index, moduleNamespace, referenceKeys } = input;
  const references = new ResolvedReferencesBuilder();
  const diagnostics: NameResolutionDiagnostic[] = [];
  const importedScopes: ImportedScopeByModule[] = [];

  const moduleByPathKey = new Map<string, ParsedModule>();
  for (const mod of graph.modules) {
    moduleByPathKey.set(mod.path.key, mod);
  }

  for (const moduleRecord of index.modules()) {
    const moduleId = moduleRecord.id;
    const parsedModule = moduleByPathKey.get(moduleRecord.pathKey);
    if (parsedModule === undefined) continue;

    const source = parsedModule.source;
    const root = parsedModule.tree.root();
    const sourceFile = SourceFileView.fromRoot(root);
    if (sourceFile === undefined) continue;

    const imports = sourceFile.imports();
    const moduleScopes: ImportedScopeByModule[] = [];

    for (const importView of imports) {
      const moduleNameView = importView.moduleName();
      if (moduleNameView === undefined) continue;

      const moduleNameText = moduleNameView.text();
      if (moduleNameText === undefined) continue;

      const segments = moduleNameView.segments();
      const firstSeg = segments[0];
      const lastSeg = segments[segments.length - 1];
      let moduleNameSpan: SourceSpan | undefined;
      if (firstSeg !== undefined && lastSeg !== undefined) {
        const firstSpan = presentTokenSpan(firstSeg);
        const lastSpan = presentTokenSpan(lastSeg);
        if (firstSpan !== undefined && lastSpan !== undefined) {
          moduleNameSpan = SourceSpan.from(firstSpan.start, lastSpan.end);
        }
      }
      if (moduleNameSpan === undefined) continue;

      const moduleKey = referenceKeys.next({
        moduleId,
        span: moduleNameSpan,
        kind: "importModule",
      });
      const lookup = moduleNamespace.resolveDottedModule(moduleNameText);

      if (lookup.kind === "unresolved") {
        diagnostics.push(
          unresolvedModule({
            source,
            span: moduleNameSpan,
            order: {
              moduleId,
              span: moduleNameSpan,
              kind: "importModule",
              ordinal: moduleKey.ordinal,
            },
            moduleName: moduleNameText,
          }),
        );
        continue;
      }

      references.add(moduleKey, { kind: "module", moduleId: lookup.moduleId });

      const targetModuleId = lookup.moduleId;
      const targetItems = index.itemsInModule(targetModuleId);
      const importedNames = importView.importedNames();
      const importCandidates: ScopeCandidate[] = [];

      for (const nameToken of importedNames) {
        const name = presentTokenText(nameToken);
        if (name === undefined) continue;

        const nameSpan = presentTokenSpan(nameToken);
        if (nameSpan === undefined) continue;

        const matchingItems = targetItems.filter((item) => item.name === name);

        if (matchingItems.length === 0) {
          const nameKey = referenceKeys.next({
            moduleId,
            span: nameSpan,
            kind: "importedItem",
          });
          diagnostics.push(
            unresolvedImport({
              source,
              span: nameSpan,
              order: {
                moduleId,
                span: nameSpan,
                kind: "importedItem",
                ordinal: nameKey.ordinal,
              },
              moduleName: moduleNameText,
              importedName: name,
            }),
          );
          continue;
        }

        if (matchingItems.length > 1) {
          const nameKey = referenceKeys.next({
            moduleId,
            span: nameSpan,
            kind: "importedItem",
          });
          const candidates = matchingItems.map((item) => {
            const modPath = index.module(item.moduleId)?.pathKey ?? "";
            return {
              modulePath: modPath,
              itemKind: item.kind,
              name: item.name,
              denseId: item.id as number,
            };
          });
          diagnostics.push(
            ambiguousImport({
              source,
              span: nameSpan,
              order: {
                moduleId,
                span: nameSpan,
                kind: "importedItem",
                ordinal: nameKey.ordinal,
              },
              moduleName: moduleNameText,
              importedName: name,
              candidates,
            }),
          );
          for (const item of matchingItems) {
            if (!item.modifiers.includes("private") || moduleId === targetModuleId) {
              importCandidates.push(candidateFromItem(item, index));
            }
          }
          continue;
        }

        const item = matchingItems[0]!;

        if (item.modifiers.includes("private") && moduleId !== targetModuleId) {
          const nameKey = referenceKeys.next({
            moduleId,
            span: nameSpan,
            kind: "importedItem",
          });
          diagnostics.push(
            privateImport({
              source,
              span: nameSpan,
              order: {
                moduleId,
                span: nameSpan,
                kind: "importedItem",
                ordinal: nameKey.ordinal,
              },
              moduleName: moduleNameText,
              importedName: name,
            }),
          );
          continue;
        }

        const itemRefKey = referenceKeys.next({
          moduleId,
          span: nameSpan,
          kind: "importedItem",
        });
        const resolvedRef = resolvedReferenceForItem(index, item);
        references.add(itemRefKey, resolvedRef);

        importCandidates.push(candidateFromItem(item, index));
      }

      if (importCandidates.length > 0) {
        moduleScopes.push({ moduleId: targetModuleId, candidates: importCandidates });
      }
    }

    if (moduleScopes.length > 0) {
      const combinedCandidates: ScopeCandidate[] = [];
      const seen = new Set<string>();
      for (const scope of moduleScopes) {
        for (const candidate of scope.candidates) {
          const key = candidateKey(candidate);
          if (seen.has(key)) continue;
          seen.add(key);
          combinedCandidates.push(candidate);
        }
      }
      importedScopes.push({ moduleId, candidates: combinedCandidates });
    } else {
      importedScopes.push({ moduleId, candidates: [] });
    }
  }

  return {
    references: references.build(),
    importedScopes,
    diagnostics,
  };
}

function candidateKey(candidate: ScopeCandidate): string {
  return `${candidate.namespace}:${candidate.name}:${JSON.stringify(candidate.reference)}`;
}

function candidateFromItem(item: ItemRecord, index: ItemIndex): ScopeCandidate {
  const ref = resolvedReferenceForItem(index, item);
  const moduleRecord = index.module(item.moduleId);
  const display = {
    modulePath: moduleRecord?.pathKey ?? "",
    itemKind: item.kind,
    name: item.name,
    denseId: item.id as number,
  };

  if (ref.kind === "type") {
    return typeCandidate(item.name, item.id, ref.typeId, display);
  } else if (ref.kind === "function") {
    return functionCandidate(item.name, item.id, ref.functionId, display);
  } else if (ref.kind === "image") {
    return { namespace: "value" as const, name: item.name, reference: ref, display };
  } else {
    const namespace: "type" | "value" = item.typeId !== undefined ? "type" : "value";
    return itemCandidate(namespace, item.name, item.id, display);
  }
}
