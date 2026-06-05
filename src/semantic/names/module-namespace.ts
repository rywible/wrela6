import type { ItemIndex } from "../item-index/item-index";
import type { ModuleId } from "../ids";

export interface ModuleNamespace {
  resolveDottedModule(moduleName: string): ModuleLookupResult;
  resolveQualifiedPrefix(segments: readonly string[]): QualifiedModulePrefixResult;
}

export type ModuleLookupResult =
  | {
      readonly kind: "resolved";
      readonly moduleId: ModuleId;
      readonly pathKey: string;
      readonly moduleSegments: readonly string[];
    }
  | { readonly kind: "unresolved"; readonly moduleName: string; readonly pathKey: string };

export type QualifiedModulePrefixResult =
  | {
      readonly kind: "resolved";
      readonly moduleId: ModuleId;
      readonly pathKey: string;
      readonly moduleSegments: readonly string[];
      readonly itemSegment: string;
      readonly memberSegments: readonly string[];
    }
  | {
      readonly kind: "prefixConsumesAllSegments";
      readonly moduleId: ModuleId;
      readonly pathKey: string;
      readonly moduleSegments: readonly string[];
    }
  | { readonly kind: "noModulePrefix"; readonly segments: readonly string[] };

interface IndexEntry {
  readonly moduleId: ModuleId;
  readonly pathKey: string;
  readonly moduleSegments: readonly string[];
}

export function dottedModuleNameToPathKey(moduleName: string): string {
  return moduleName.replace(/\./g, "/") + ".wr";
}

export function buildModuleNamespace(index: ItemIndex): ModuleNamespace {
  const modules = index.modules();
  const byPathKey = new Map<string, IndexEntry>();

  for (const mod of modules) {
    const segments = mod.pathKey.replace(/\.wr$/, "").split("/");
    const entry: IndexEntry = { moduleId: mod.id, pathKey: mod.pathKey, moduleSegments: segments };
    byPathKey.set(mod.pathKey, entry);
  }

  return {
    resolveDottedModule(moduleName: string): ModuleLookupResult {
      const pathKey = dottedModuleNameToPathKey(moduleName);
      const entry = byPathKey.get(pathKey);
      if (entry) {
        return {
          kind: "resolved",
          moduleId: entry.moduleId,
          pathKey: entry.pathKey,
          moduleSegments: entry.moduleSegments,
        };
      }
      return { kind: "unresolved", moduleName, pathKey };
    },

    resolveQualifiedPrefix(segments: readonly string[]): QualifiedModulePrefixResult {
      if (segments.length === 0) return { kind: "noModulePrefix", segments };

      for (let len = segments.length; len >= 1; len--) {
        const prefix = segments.slice(0, len);
        const pathKey = prefix.join("/") + ".wr";
        const entry = byPathKey.get(pathKey);
        if (entry) {
          if (len === segments.length) {
            return {
              kind: "prefixConsumesAllSegments",
              moduleId: entry.moduleId,
              pathKey: entry.pathKey,
              moduleSegments: entry.moduleSegments,
            };
          }
          return {
            kind: "resolved",
            moduleId: entry.moduleId,
            pathKey: entry.pathKey,
            moduleSegments: entry.moduleSegments,
            itemSegment: segments[len]!,
            memberSegments: segments.slice(len + 1),
          };
        }
      }

      return { kind: "noModulePrefix", segments };
    },
  };
}
