import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseModuleGraph } from "../../../src/frontend/module-graph-parser";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  ModulePath,
  SourceText,
} from "../../../src/frontend/lexer";
import type { Diagnostic } from "../../../src/shared/diagnostics";
import {
  authenticateUefiAArch64TargetDriverSurface,
  compilerPackageInput,
  lowerTypedHir,
  packageParsedGraphToHirInput,
  parseModuleGraph as parsePackageModuleGraph,
  productionPackagePipelineDependencies,
  runUefiAArch64PackagePipelineToOptIr,
  type CompilerPackageInput,
  type PackageProofMirAdapter,
  type PackageProofMirInput,
  type UefiAArch64TargetDiagnostic,
  type UefiAArch64TargetDiagnosticSource,
  type UefiAArch64TargetDriverSurface,
  type UefiAArch64PackagePipelineDependencies,
  type UefiAArch64PackageStageResult,
  uefiAArch64TargetDiagnostic,
} from "../../../src/target/uefi-aarch64";
import { buildProofMir as buildSourceProofMir } from "../../../src/proof-mir/proof-mir-builder";
import type { ProofMirDiagnostic } from "../../../src/proof-mir/diagnostics";
import { runtimeCatalog } from "../../../src/runtime/runtime-catalog";
import { canonicalUefiAArch64ProofMirRuntimeCatalog } from "../../../src/target/uefi-aarch64/runtime-catalog";
import { hirOriginId } from "../../../src/hir/ids";
import { uefiTargetSurfaceFixture } from "../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

type FixturePhase = "parse" | "semantic" | "pipeline";

interface ExpectedDiagnostic {
  readonly code: string;
  readonly spanText?: string;
  readonly count?: number;
}

interface ExpectedFixture {
  readonly phase: FixturePhase;
  readonly diagnostics: readonly ExpectedDiagnostic[];
  readonly enabledTargetFeatures?: readonly string[];
  readonly proofMirTargetFeatures?: readonly string[];
  readonly trackedBy?: string;
}

interface CorpusFixture {
  readonly name: string;
  readonly directory: string;
}

interface ActualDiagnostic {
  readonly code: string;
  readonly spanText: string;
  readonly detail?: string;
}

type CorpusDiagnostic = Diagnostic | UefiAArch64TargetDiagnostic;

const trackedByPattern = /^W[0-8]-[0-9]{2}[a-z]?$/;
const fixtureRoots = [
  path.join(process.cwd(), "tests", "fixtures", "diagnostics"),
  path.join(process.cwd(), "tests", "system", "diagnostics", "cases"),
];
const fixtures = await loadFixtures(fixtureRoots);

describe("diagnostics corpus", () => {
  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const expected = await loadExpectedFixture(fixture);
      const actualDiagnostics = await runFixturePhase(fixture, expected);
      const sourceText = await readFile(path.join(fixture.directory, "input.wr"), "utf8");
      const actual = actualDiagnostics.map((diagnostic) =>
        toActualDiagnostic(diagnostic, sourceText),
      );

      assertDiagnosticsMatch({
        fixture,
        expectedDiagnostics: expected.diagnostics,
        actual,
      });
    });
  }
});

describe("diagnostics corpus expected schema", () => {
  test("requires trackedBy for empty wrong-behavior fixtures", () => {
    expect(() =>
      validateExpectedFixture({
        fixtureName: "bad-escape",
        expected: {
          phase: "parse",
          diagnostics: [],
        },
      }),
    ).toThrow("Fixture bad-escape has no expected diagnostics and must include trackedBy");
  });

  test("rejects trackedBy on ok fixtures", () => {
    expect(() =>
      validateExpectedFixture({
        fixtureName: "ok-empty",
        expected: {
          phase: "parse",
          diagnostics: [],
          trackedBy: "W1-02",
        },
      }),
    ).toThrow("Fixture ok-empty is an ok-* fixture and must not include trackedBy");
  });
});

async function loadFixtures(roots: readonly string[]): Promise<CorpusFixture[]> {
  const fixturesByName = new Map<string, CorpusFixture>();

  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (fixturesByName.has(entry.name)) {
        throw new Error(`Duplicate diagnostics corpus fixture name: ${entry.name}`);
      }
      fixturesByName.set(
        entry.name,
        Object.freeze({
          name: entry.name,
          directory: path.join(root, entry.name),
        }),
      );
    }
  }

  return [...fixturesByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function loadExpectedFixture(fixture: CorpusFixture): Promise<ExpectedFixture> {
  const expectedJson = await readFile(path.join(fixture.directory, "expected.json"), "utf8");
  const expected = JSON.parse(expectedJson) as unknown;

  return validateExpectedFixture({ fixtureName: fixture.name, expected });
}

function validateExpectedFixture(context: {
  readonly fixtureName: string;
  readonly expected: unknown;
}): ExpectedFixture {
  if (!isRecord(context.expected)) {
    throw new Error(`Fixture ${context.fixtureName} expected.json must be an object.`);
  }

  const phase = context.expected.phase;
  if (phase !== "parse" && phase !== "semantic" && phase !== "pipeline") {
    throw new Error(`Fixture ${context.fixtureName} expected.json has invalid phase.`);
  }

  const diagnostics = context.expected.diagnostics;
  if (!Array.isArray(diagnostics)) {
    throw new Error(`Fixture ${context.fixtureName} expected.json diagnostics must be an array.`);
  }

  const trackedBy = context.expected.trackedBy;
  if (trackedBy !== undefined && typeof trackedBy !== "string") {
    throw new Error(`Fixture ${context.fixtureName} expected.json trackedBy must be a string.`);
  }

  const enabledTargetFeatures = optionalStringArray(
    context.expected.enabledTargetFeatures,
    `Fixture ${context.fixtureName} expected.json enabledTargetFeatures`,
  );
  const proofMirTargetFeatures = optionalStringArray(
    context.expected.proofMirTargetFeatures,
    `Fixture ${context.fixtureName} expected.json proofMirTargetFeatures`,
  );

  if (trackedBy !== undefined && !trackedByPattern.test(trackedBy)) {
    throw new Error(
      `Fixture ${context.fixtureName} expected.json trackedBy must match ${trackedByPattern}.`,
    );
  }

  const isOkFixture = context.fixtureName.startsWith("ok-");
  if (isOkFixture && trackedBy !== undefined) {
    throw new Error(
      `Fixture ${context.fixtureName} is an ok-* fixture and must not include trackedBy.`,
    );
  }

  if (!isOkFixture && diagnostics.length === 0 && trackedBy === undefined) {
    throw new Error(
      `Fixture ${context.fixtureName} has no expected diagnostics and must include trackedBy.`,
    );
  }

  return {
    phase,
    diagnostics: diagnostics as readonly ExpectedDiagnostic[],
    ...(enabledTargetFeatures === undefined ? {} : { enabledTargetFeatures }),
    ...(proofMirTargetFeatures === undefined ? {} : { proofMirTargetFeatures }),
    trackedBy,
  };
}

function optionalStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return Object.freeze([...value]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runFixturePhase(
  fixture: CorpusFixture,
  expected: ExpectedFixture,
): Promise<readonly CorpusDiagnostic[]> {
  switch (expected.phase) {
    case "parse":
      return runParsePhase(fixture);
    case "semantic":
      return runSemanticPhase(fixture, expected);
    case "pipeline":
      return runPipelinePhase(fixture, expected);
  }
}

async function runParsePhase(fixture: CorpusFixture): Promise<readonly Diagnostic[]> {
  const sourcePath = path.join(fixture.directory, "input.wr");
  const sourceText = await readFile(sourcePath, "utf8");
  const source = SourceText.from(sourcePath, sourceText);
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const lexResult = lexer.lex(source);

  const parseResult = parseModuleGraph({
    graph: {
      entry: ModulePath.from("input.wr"),
      modules: [
        {
          path: ModulePath.from("input.wr"),
          source,
          tokens: lexResult.tokens,
          imports: [],
        },
      ],
    },
    lexerDiagnostics: diagnostics.diagnostics,
  });

  return parseResult.diagnostics;
}

async function runSemanticPhase(
  fixture: CorpusFixture,
  expected: ExpectedFixture,
): Promise<readonly UefiAArch64TargetDiagnostic[]> {
  const packageInputResult = await packageInputForFixture(fixture, expected);
  if (packageInputResult.kind === "error") return packageInputResult.diagnostics;

  const target = targetSurfaceForFixture();
  const parsed = parsePackageModuleGraph({ packageInput: packageInputResult.value });
  if (parsed.kind === "error") return parsed.diagnostics;

  const typedHir = lowerTypedHir(
    packageParsedGraphToHirInput(parsed.value, packageInputResult.value, target),
  );

  return typedHir.diagnostics;
}

async function runPipelinePhase(
  fixture: CorpusFixture,
  expected: ExpectedFixture,
): Promise<readonly UefiAArch64TargetDiagnostic[]> {
  const packageInputResult = await packageInputForFixture(fixture, expected);
  if (packageInputResult.kind === "error") return packageInputResult.diagnostics;

  const result = runUefiAArch64PackagePipelineToOptIr(
    {
      packageInput: packageInputResult.value,
      target: targetSurfaceForFixture(),
    },
    packagePipelineDependenciesForFixture(expected, packageInputResult.value),
  );

  return result.diagnostics;
}

async function packageInputForFixture(
  fixture: CorpusFixture,
  expected: ExpectedFixture,
): Promise<
  | { readonly kind: "ok"; readonly value: CompilerPackageInput }
  | { readonly kind: "error"; readonly diagnostics: readonly UefiAArch64TargetDiagnostic[] }
> {
  const sourcePath = path.join(fixture.directory, "input.wr");
  const sourceText = await readFile(sourcePath, "utf8");
  return compilerPackageInput({
    packageKey: fixture.name,
    entryModuleName: "image",
    sourceRoots: [
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
    ],
    sourceFiles: [
      {
        sourceKey: "src/image.wr",
        moduleName: "image",
        text: sourceText,
      },
    ],
    enabledTargetFeatures: expected.enabledTargetFeatures,
  });
}

function packagePipelineDependenciesForFixture(
  expected: ExpectedFixture,
  packageInput: CompilerPackageInput,
): UefiAArch64PackagePipelineDependencies {
  const dependencies = productionPackagePipelineDependencies();
  if (expected.proofMirTargetFeatures === undefined) return dependencies;

  return Object.freeze({
    ...dependencies,
    buildProofMir: (input: PackageProofMirInput) =>
      buildProofMirWithTargetFeatures(input, packageInput, expected.proofMirTargetFeatures ?? []),
  });
}

function buildProofMirWithTargetFeatures(
  input: PackageProofMirInput,
  packageInput: CompilerPackageInput,
  features: readonly string[],
): UefiAArch64PackageStageResult<PackageProofMirAdapter> {
  const canonicalCatalog = canonicalUefiAArch64ProofMirRuntimeCatalog();
  const catalogResult = runtimeCatalog({
    targetId: canonicalCatalog.targetId,
    features,
    entries: canonicalCatalog.entries(),
  });
  if (catalogResult.kind === "error") {
    throw new Error(
      `Failed to construct fixture runtime catalog: ${catalogResult.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }

  const buildProofMirInput = Object.freeze({
    program: input.monomorphizedImage.monomorphizeWholeImageResult.program,
    layout: input.layoutFacts.computeRepresentationLayoutFactsResult.facts,
    target: Object.freeze({
      targetId: canonicalCatalog.targetId,
      features: Object.freeze([...catalogResult.catalog.features]),
      runtimeCatalog: catalogResult.catalog,
    }),
  });
  const buildProofMirResult = buildSourceProofMir(buildProofMirInput);
  if (buildProofMirResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: buildProofMirResult.diagnostics.map((diagnostic) =>
        proofMirDiagnosticAsPipelineDiagnostic(diagnostic, input, packageInput),
      ),
    };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      kind: "proof-mir" as const,
      buildProofMirInput,
      buildProofMirResult,
      ...(input.monomorphizedImage.sourceApiResultConstructorTypeId === undefined
        ? {}
        : {
            sourceApiResultConstructorTypeId:
              input.monomorphizedImage.sourceApiResultConstructorTypeId,
          }),
      ...(input.monomorphizedImage.validationResultConstructorTypeIds === undefined
        ? {}
        : {
            validationResultConstructorTypeIds:
              input.monomorphizedImage.validationResultConstructorTypeIds,
          }),
      ...(input.monomorphizedImage.statusCarrierPayloadTypeIds === undefined
        ? {}
        : {
            statusCarrierPayloadTypeIds: input.monomorphizedImage.statusCarrierPayloadTypeIds,
          }),
    }),
    diagnostics: [],
  };
}

function proofMirDiagnosticAsPipelineDiagnostic(
  diagnostic: ProofMirDiagnostic,
  input: PackageProofMirInput,
  packageInput: CompilerPackageInput,
): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: "uefi-aarch64-package-pipeline:proof-mir",
    stableDetail: `${diagnostic.code}:${diagnostic.stableDetail}`,
    source: sourcePayloadFromProofMirDiagnostic(diagnostic, input, packageInput),
  });
}

function sourcePayloadFromProofMirDiagnostic(
  diagnostic: ProofMirDiagnostic,
  input: PackageProofMirInput,
  packageInput: CompilerPackageInput,
): UefiAArch64TargetDiagnosticSource | undefined {
  const sourceOrigin = diagnostic.sourceOrigin;
  if (sourceOrigin === undefined || !/^[0-9]+$/.test(sourceOrigin)) return undefined;

  const origin = input.monomorphizedImage.monomorphizeWholeImageResult.program.origins.get(
    hirOriginId(Number(sourceOrigin)),
  );
  if (origin === undefined) return undefined;

  const sourceFile = packageInput.sourceFiles[origin.moduleId as number];
  if (sourceFile === undefined) return undefined;

  const source = SourceText.from(sourceFile.sourceKey, sourceFile.text);
  const start = source.positionAt(origin.span.start);
  const end = source.positionAt(origin.span.end);
  return Object.freeze({
    originalCode: diagnostic.code,
    message: diagnostic.message,
    sourceName: source.name,
    startOffset: origin.span.start,
    endOffset: origin.span.end,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  });
}

function targetSurfaceForFixture(): UefiAArch64TargetDriverSurface {
  const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
  if (targetResult.kind === "error") {
    throw new Error(
      `Failed to authenticate corpus target:\n${JSON.stringify(targetResult.diagnostics, null, 2)}`,
    );
  }

  return targetResult.value;
}

function toActualDiagnostic(diagnostic: CorpusDiagnostic, sourceText: string): ActualDiagnostic {
  if (isSourceTextDiagnostic(diagnostic)) {
    return {
      code: diagnostic.code,
      spanText: diagnostic.source.slice(diagnostic.span),
    };
  }

  return {
    code: innerPipelineDiagnosticCode(diagnostic.stableDetail) ?? diagnostic.code,
    spanText:
      diagnostic.source === undefined
        ? ""
        : sourceText.slice(diagnostic.source.startOffset, diagnostic.source.endOffset),
    detail: diagnostic.stableDetail,
  };
}

function isSourceTextDiagnostic(diagnostic: CorpusDiagnostic): diagnostic is Diagnostic {
  return (
    "span" in diagnostic && "source" in diagnostic && typeof diagnostic.source.slice === "function"
  );
}

function innerPipelineDiagnosticCode(stableDetail: string): string | undefined {
  const separator = stableDetail.indexOf(":");
  if (separator <= 0) return undefined;
  return stableDetail.slice(0, separator);
}

function assertDiagnosticsMatch(context: {
  readonly fixture: CorpusFixture;
  readonly expectedDiagnostics: readonly ExpectedDiagnostic[];
  readonly actual: readonly ActualDiagnostic[];
}): void {
  const expectedTotal = context.expectedDiagnostics.reduce(
    (total, expectedDiagnostic) => total + (expectedDiagnostic.count ?? 1),
    0,
  );

  const actualSummary = formatActualDiagnostics(context.actual);

  if (context.actual.length !== expectedTotal) {
    throw new Error(
      [
        `Fixture ${context.fixture.name} expected ${expectedTotal} diagnostics, got ${context.actual.length}.`,
        actualSummary,
      ].join("\n"),
    );
  }

  for (const expectedDiagnostic of context.expectedDiagnostics) {
    const expectedCount = expectedDiagnostic.count ?? 1;
    const actualCount = countMatchingDiagnostics(context.actual, expectedDiagnostic);

    if (actualCount !== expectedCount) {
      throw new Error(
        [
          `Fixture ${context.fixture.name} expected ${expectedCount} diagnostic(s) matching ${formatExpectedDiagnostic(expectedDiagnostic)}, got ${actualCount}.`,
          actualSummary,
        ].join("\n"),
      );
    }
  }
}

function countMatchingDiagnostics(
  actual: readonly ActualDiagnostic[],
  expected: ExpectedDiagnostic,
): number {
  return actual.filter((diagnostic) => {
    if (diagnostic.code !== expected.code) {
      return false;
    }

    if (expected.spanText !== undefined && diagnostic.spanText !== expected.spanText) {
      return false;
    }

    return true;
  }).length;
}

function formatExpectedDiagnostic(expected: ExpectedDiagnostic): string {
  return JSON.stringify({
    code: expected.code,
    spanText: expected.spanText,
    count: expected.count ?? 1,
  });
}

function formatActualDiagnostics(actual: readonly ActualDiagnostic[]): string {
  const actualCodes = actual.map((diagnostic) => diagnostic.code);
  const actualSpans = actual.map((diagnostic) => diagnostic.spanText);
  const actualDetails = actual.map((diagnostic) => diagnostic.detail ?? "");

  return [
    `Actual diagnostic codes: ${JSON.stringify(actualCodes)}`,
    `Actual diagnostic span texts: ${JSON.stringify(actualSpans)}`,
    `Actual diagnostic details: ${JSON.stringify(actualDetails)}`,
    `Actual diagnostics: ${JSON.stringify(actual, null, 2)}`,
  ].join("\n");
}
