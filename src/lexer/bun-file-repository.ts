import { resolve, relative } from "node:path";

import type { FileReadResult, FileRepository } from "./file-repository";
import type { ModulePath } from "./module-path";
import { SourceText } from "./source-text";

export class BunFileRepository implements FileRepository {
  constructor(private readonly options: { root: string }) {}

  async read(path: ModulePath): Promise<FileReadResult> {
    const root = resolve(this.options.root);
    const resolved = resolve(root, path.key);

    if (!resolved.startsWith(root) || relative(root, resolved).startsWith("..")) {
      return {
        kind: "unreadable",
        path,
        message: `Path '${path.key}' resolves outside the repository root '${root}'.`,
      };
    }

    const file = Bun.file(resolved);
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
