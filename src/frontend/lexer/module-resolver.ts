import type { ModuleImportRequest } from "./module-import-request";
import type { ModulePath } from "./module-path";
import { ModulePath as ModulePathClass } from "./module-path";

export type ModuleResolveResult =
  | { kind: "resolved"; path: ModulePath }
  | { kind: "unresolved"; reason: string };

export interface ModuleResolver {
  resolve(request: ModuleImportRequest): ModuleResolveResult;
}

export class DottedModuleResolver implements ModuleResolver {
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

    try {
      const resolvedPath = ModulePathClass.from(filePath);
      return { kind: "resolved", path: resolvedPath };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "unresolved", reason: message };
    }
  }
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
