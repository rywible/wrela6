import type { ModuleImportRequest } from "./module-import-request";
import type { ModulePath, ModulePathResult } from "./module-path";
import { ModulePath as ModulePathClass } from "./module-path";

export type ModuleResolveResult =
  | { kind: "resolved"; path: ModulePath }
  | { kind: "unresolved"; reason: string }
  | {
      kind: "pathInvalid";
      path: string;
      reason: string;
      ownerKey: string;
      stableDetail: string;
    };

export interface ModuleResolver {
  resolve(request: ModuleImportRequest): ModuleResolveResult;
}

interface DottedModuleResolverDependencies {
  readonly modulePathFromFilePath?: (filePath: string) => ModulePathResult;
}

export class DottedModuleResolver implements ModuleResolver {
  constructor(private readonly dependencies: DottedModuleResolverDependencies = {}) {}

  resolve(request: ModuleImportRequest): ModuleResolveResult {
    const { moduleName } = request;

    if (moduleName.length === 0) {
      return { kind: "unresolved", reason: "Module name must not be empty." };
    }

    if (!isValidDottedName(moduleName)) {
      return {
        kind: "unresolved",
        reason: `Module name contains invalid characters: ${moduleName}`,
      };
    }

    const filePath = moduleName.replace(/\./g, "/") + ".wr";
    const result = (this.dependencies.modulePathFromFilePath ?? ModulePathClass.tryFrom)(filePath);

    if (result.kind === "invalid") {
      return {
        kind: "pathInvalid",
        path: result.path,
        reason: result.reason,
        ownerKey: modulePathOwnerKey(request),
        stableDetail: `module-path:invalid:${moduleName}:${result.path}`,
      };
    }

    return { kind: "resolved", path: result.path };
  }
}

function modulePathOwnerKey(request: ModuleImportRequest): string {
  return `module-path:${request.importer.key}:${request.moduleName}:${request.span.start}:${request.span.end}`;
}

function isValidDottedName(name: string): boolean {
  const segments = name.split(".");

  for (const segment of segments) {
    if (segment.length === 0) {
      return false;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      return false;
    }
  }

  return true;
}
