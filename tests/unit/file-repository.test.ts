import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BunFileRepository } from "../../src/lexer/bun-file-repository";
import type { FileReadResult, FileRepository } from "../../src/lexer/file-repository";
import type { ModulePath } from "../../src/lexer/module-path";
import { SourceText } from "../../src/lexer/source-text";

// ---------------------------------------------------------------------------
// FakeFileRepository – contract verification without disk I/O
// ---------------------------------------------------------------------------

class FakeFileRepository implements FileRepository {
  constructor(private readonly files: Map<string, string>) {}

  async read(path: ModulePath): Promise<FileReadResult> {
    const text = this.files.get(path.key);

    if (text === undefined) {
      return { kind: "missing", path };
    }

    return { kind: "found", path, source: SourceText.from(path.display, text) };
  }
}

describe("FakeFileRepository", () => {
  function createFixture(): FakeFileRepository {
    const files = new Map<string, string>();
    files.set("main.wr", "uefi image Main:");
    return new FakeFileRepository(files);
  }

  test("reading an existing file returns found with correct source", async () => {
    const repository = createFixture();
    const { ModulePath } = await import("../../src/lexer/module-path");
    const path = ModulePath.from("main.wr");
    const result = await repository.read(path);

    expect(result.kind).toBe("found");

    if (result.kind === "found") {
      expect(result.path.key).toBe("main.wr");
      expect(result.source.text).toBe("uefi image Main:");
      expect(result.source.name).toBe("main.wr");
    }
  });

  test("reading a missing file returns missing", async () => {
    const repository = createFixture();
    const { ModulePath } = await import("../../src/lexer/module-path");
    const path = ModulePath.from("missing.wr");
    const result = await repository.read(path);

    expect(result.kind).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// BunFileRepository – real file-system integration tests
// ---------------------------------------------------------------------------

describe("BunFileRepository", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  test("reading a file that exists returns found with correct source text", async () => {
    root = await mkdtemp(join(tmpdir(), "wrela-lexer-"));
    await writeFile(join(root, "main.wr"), "uefi image Main:\n");

    const repository = new BunFileRepository({ root });
    const { ModulePath } = await import("../../src/lexer/module-path");
    const path = ModulePath.from("main.wr");
    const result = await repository.read(path);

    expect(result.kind).toBe("found");

    if (result.kind === "found") {
      expect(result.source.text).toBe("uefi image Main:\n");
      expect(result.source.name).toBe("main.wr");
    }
  });

  test("reading a missing file returns missing", async () => {
    root = await mkdtemp(join(tmpdir(), "wrela-lexer-"));
    await writeFile(join(root, "present.wr"), "");

    const repository = new BunFileRepository({ root });
    const { ModulePath } = await import("../../src/lexer/module-path");
    const result = await repository.read(ModulePath.from("absent.wr"));

    expect(result.kind).toBe("missing");
  });
});
