export class ModulePath {
  readonly key: string;
  readonly display: string;

  private constructor(key: string) {
    this.key = key;
    this.display = key;
  }

  static from(path: string): ModulePath {
    const result = ModulePath.tryFrom(path);

    if (result.kind === "valid") {
      return result.path;
    }

    throw new Error(result.reason);
  }

  static tryFrom(path: string): ModulePathResult {
    if (path.length === 0) {
      return invalidModulePath(path, "ModulePath must not be empty.");
    }

    if (path.includes("\0")) {
      return invalidModulePath(path, `ModulePath must not contain NUL bytes: ${path}`);
    }

    if (/^[A-Za-z]:/.test(path)) {
      return invalidModulePath(path, `ModulePath must not have a Windows drive prefix: ${path}`);
    }

    if (path.startsWith("/")) {
      return invalidModulePath(path, `ModulePath must not be absolute: ${path}`);
    }

    const normalized = normalize(path);
    const segments = normalized.split("/");

    if (segments.includes("..")) {
      return invalidModulePath(path, `ModulePath must not contain '..' segments: ${path}`);
    }

    for (const segment of segments) {
      if (segment.length === 0) {
        return invalidModulePath(path, `ModulePath must not contain empty segments: ${path}`);
      }
    }

    return { kind: "valid", path: new ModulePath(normalized) };
  }

  equals(other: ModulePath): boolean {
    return this.key === other.key;
  }
}

export type ModulePathResult =
  | { readonly kind: "valid"; readonly path: ModulePath }
  | { readonly kind: "invalid"; readonly path: string; readonly reason: string };

function invalidModulePath(path: string, reason: string): ModulePathResult {
  return { kind: "invalid", path, reason };
}

function normalize(path: string): string {
  let result = path.replace(/\\/g, "/");
  result = result.replace(/\/{2,}/g, "/");

  while (result.startsWith("./")) {
    result = result.slice(2);
  }

  return result;
}
