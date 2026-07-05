import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface InvalidFixtureSpec {
  readonly section: string;
  readonly slug: string;
  readonly stage: "parse";
  readonly code: string;
  readonly source: string;
}

const docsPath = path.join(process.cwd(), "docs", "language", "invalid.md");
const outputRoot = path.join(process.cwd(), "tests", "fixtures", "diagnostics", "generated");
const markerPattern = /<!--\s*invalid-diagnostic-fixtures\s*(?<json>[\s\S]*?)\s*-->/u;

const check = process.argv.includes("--check");
const documentText = await readFile(docsPath, "utf8");
const specs = parseFixtureSpecs(documentText);
validateSectionsCovered(documentText, specs);
validateSpecs(specs);

const plannedFiles = await plannedFixtureFiles(specs);

if (check) {
  await assertGeneratedFilesCurrent(plannedFiles);
} else {
  await writeGeneratedFiles(plannedFiles);
}

function parseFixtureSpecs(text: string): readonly InvalidFixtureSpec[] {
  const match = markerPattern.exec(text);
  if (match?.groups?.json === undefined) {
    throw new Error("docs/language/invalid.md is missing invalid-diagnostic-fixtures metadata.");
  }

  const value = JSON.parse(match.groups.json.trim()) as unknown;
  if (!Array.isArray(value)) {
    throw new Error("invalid-diagnostic-fixtures metadata must be a JSON array.");
  }
  return value as readonly InvalidFixtureSpec[];
}

function validateSectionsCovered(text: string, specs: readonly InvalidFixtureSpec[]): void {
  const sections = [...text.matchAll(/^## (?<section>.+)$/gmu)]
    .map((match) => match.groups?.section)
    .filter((section): section is string => section !== undefined);
  const covered = new Set(specs.map((spec) => spec.section));
  const missing = sections.filter((section) => !covered.has(section));
  if (missing.length > 0) {
    throw new Error(
      `Missing invalid diagnostic fixture metadata for sections: ${missing.join(", ")}`,
    );
  }
}

function validateSpecs(specs: readonly InvalidFixtureSpec[]): void {
  const slugs = new Set<string>();
  for (const spec of specs) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.slug)) {
      throw new Error(`Invalid generated fixture slug: ${spec.slug}`);
    }
    if (slugs.has(spec.slug)) {
      throw new Error(`Duplicate generated fixture slug: ${spec.slug}`);
    }
    slugs.add(spec.slug);
    if (spec.stage !== "parse") {
      throw new Error(`Generated fixture ${spec.slug} uses unsupported stage ${spec.stage}.`);
    }
    if (!/^[A-Z][A-Z0-9_]+$/.test(spec.code)) {
      throw new Error(`Generated fixture ${spec.slug} is missing a stable diagnostic code.`);
    }
    if (spec.source.length === 0) {
      throw new Error(`Generated fixture ${spec.slug} has empty source.`);
    }
  }
}

async function plannedFixtureFiles(
  specs: readonly InvalidFixtureSpec[],
): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for (const spec of [...specs].sort((left, right) => left.slug.localeCompare(right.slug))) {
    const directory = path.join(outputRoot, spec.slug);
    files.set(path.join(directory, "input.wr"), `${spec.source}\n`);
    files.set(
      path.join(directory, "expected.json"),
      `${JSON.stringify(
        {
          sourceSection: spec.section,
          stage: spec.stage,
          diagnostics: [{ code: spec.code }],
        },
        null,
        2,
      )}\n`,
    );
  }
  return files;
}

async function assertGeneratedFilesCurrent(files: ReadonlyMap<string, string>): Promise<void> {
  const stale: string[] = [];
  for (const [file, expected] of files) {
    let actual: string;
    try {
      actual = await readFile(file, "utf8");
    } catch {
      stale.push(path.relative(process.cwd(), file));
      continue;
    }
    if (actual !== expected) {
      stale.push(path.relative(process.cwd(), file));
    }
  }

  const generatedEntries = await readdir(outputRoot, { recursive: true }).catch(() => []);
  const expectedRelative = new Set(
    [...files.keys()].map((file) => path.relative(outputRoot, file)),
  );
  for (const entry of generatedEntries) {
    if (typeof entry !== "string" || entry.endsWith(".DS_Store")) continue;
    if (!entry.endsWith("input.wr") && !entry.endsWith("expected.json")) continue;
    if (!expectedRelative.has(entry))
      stale.push(path.join("tests/fixtures/diagnostics/generated", entry));
  }

  if (stale.length > 0) {
    throw new Error(
      `Generated invalid diagnostic fixtures are stale. Run bun run generate:diagnostics.\n${stale.join(
        "\n",
      )}`,
    );
  }
}

async function writeGeneratedFiles(files: ReadonlyMap<string, string>): Promise<void> {
  await rm(outputRoot, { force: true, recursive: true });
  for (const [file, contents] of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}
