import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BunFileRepository } from "../../../../src/frontend/lexer/bun-file-repository";
import { ModulePath } from "../../../../src/frontend/lexer/module-path";
import { FakeFileRepository } from "../../../support/frontend/lexer-fakes";

describe("FakeFileRepository", () => {
  test("reading an existing file returns found with correct source", async () => {
    const repository = new FakeFileRepository(new Map([["main.wr", "uefi image Main:"]]));
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
    const repository = new FakeFileRepository(new Map());
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
    const { ModulePath } = await import("../../../../src/frontend/lexer/module-path");
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
    const { ModulePath } = await import("../../../../src/frontend/lexer/module-path");
    const result = await repository.read(ModulePath.from("absent.wr"));

    expect(result.kind).toBe("missing");
  });

  test("symlink pointing outside root returns unreadable", async () => {
    root = await mkdtemp(join(tmpdir(), "wrela-lexer-"));
    const outsideFile = join(tmpdir(), "wrela-lexer-outside-target");
    const symlinkPath = join(root, "link.wr");

    await writeFile(outsideFile, "SECRET OUTSIDE ROOT\n");
    await symlink(outsideFile, symlinkPath);

    const repository = new BunFileRepository({ root });
    const result = await repository.read(ModulePath.from("link.wr"));

    expect(result.kind).toBe("unreadable");
  });

  test("symlink pointing inside root returns found", async () => {
    root = await mkdtemp(join(tmpdir(), "wrela-lexer-"));
    await writeFile(join(root, "target.wr"), "uefi image Linked:\n");
    await symlink("target.wr", join(root, "link.wr"));

    const repository = new BunFileRepository({ root });
    const result = await repository.read(ModulePath.from("link.wr"));

    expect(result.kind).toBe("found");

    if (result.kind === "found") {
      expect(result.source.text).toBe("uefi image Linked:\n");
      expect(result.source.name).toBe("link.wr");
    }
  });

  test("symlink pointing to root-prefixed sibling returns unreadable", async () => {
    root = await mkdtemp(join(tmpdir(), "wrela-lexer-"));
    const repositoryRoot = join(root, "root");
    const outsideRoot = join(root, "root-evil");

    await mkdir(repositoryRoot);
    await mkdir(outsideRoot);
    await writeFile(join(outsideRoot, "secret.wr"), "SECRET OUTSIDE ROOT\n");
    await symlink("../root-evil/secret.wr", join(repositoryRoot, "link.wr"));

    const repository = new BunFileRepository({ root: repositoryRoot });
    const result = await repository.read(ModulePath.from("link.wr"));

    expect(result.kind).toBe("unreadable");
  });
});
