import { isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";

import type { FileReadResult, FileRepository } from "./file-repository";
import type { ModulePath } from "./module-path";
import { SourceText } from "./source-text";

export class BunFileRepository implements FileRepository {
  constructor(private readonly options: { root: string }) {}

  async read(path: ModulePath): Promise<FileReadResult> {
    const root = resolve(this.options.root);
    const resolved = resolve(root, path.key);

    if (!isContainedPath(root, resolved)) {
      return {
        kind: "unreadable",
        path,
        message: `Path '${path.key}' resolves outside the repository root '${root}'.`,
      };
    }

    let realResolved: string;

    try {
      realResolved = await realpath(resolved);
    } catch {
      return { kind: "missing", path };
    }

    const realRoot = await realpath(root);

    if (!isContainedPath(realRoot, realResolved)) {
      return {
        kind: "unreadable",
        path,
        message: `Path '${path.key}' resolves outside the repository root via symlink.`,
      };
    }

    const file = Bun.file(realResolved);
    const exists = await file.exists();

    if (!exists) {
      return { kind: "missing", path };
    }

    try {
      const text = await file.text();
      return {
        kind: "found",
        path,
        source: SourceText.from(path.display, text),
      };
    } catch (error) {
      return {
        kind: "unreadable",
        path,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function isContainedPath(root: string, target: string): boolean {
  const result = relative(root, target);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}
