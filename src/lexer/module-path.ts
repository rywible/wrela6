export class ModulePath {
  readonly key: string;
  readonly display: string;

  private constructor(key: string) {
    this.key = key;
    this.display = key;
  }

  static from(path: string): ModulePath {
    if (path.length === 0) {
      throw new Error("ModulePath must not be empty.");
    }

    if (path.includes("\0")) {
      throw new Error(`ModulePath must not contain NUL bytes: ${path}`);
    }

    if (/^[A-Za-z]:/.test(path)) {
      throw new Error(`ModulePath must not have a Windows drive prefix: ${path}`);
    }

    if (path.startsWith("/")) {
      throw new Error(`ModulePath must not be absolute: ${path}`);
    }

    const normalized = normalize(path);

    if (normalized.includes("..")) {
      throw new Error(`ModulePath must not contain '..' segments: ${path}`);
    }

    const segments = normalized.split("/");

    for (const segment of segments) {
      if (segment.length === 0) {
        throw new Error(`ModulePath must not contain empty segments: ${path}`);
      }
    }

    return new ModulePath(normalized);
  }

  equals(other: ModulePath): boolean {
    return this.key === other.key;
  }
}

function normalize(path: string): string {
  let result = path.replace(/\\/g, "/");
  result = result.replace(/\/{2,}/g, "/");

  if (result.startsWith("./")) {
    result = result.slice(2);
  }

  return result;
}
