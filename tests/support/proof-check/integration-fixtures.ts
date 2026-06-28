import { expect } from "bun:test";
import { lowerTypedHirForTest } from "../hir/typed-hir-fixtures";
import { parseModuleGraphForTest } from "../frontend/module-graph-test-support";
import {
  proofMirBuildInputForSource,
  type ProofMirBuildInput,
} from "../proof-mir/proof-mir-build-input";
import { checkSemanticSurfaceForTest } from "../semantic/semantic-surface-fakes";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import type { CheckProofAndResourcesInput } from "../../../src/proof-check/input-contract";
import {
  checkProofAndResources,
  type CheckProofAndResourcesResult,
} from "../../../src/proof-check/proof-checker";
import {
  checkProofAndResourcesForClosedFixture,
  proofCheckClosedFixture,
  withProofCheckAuthoritiesForTest,
  type ProofCheckClosedFixtureOptions,
  type ProofCheckInvalidFixtureCase,
} from "./proof-check-fixtures";
import { functionCanonicalKey } from "../../../src/proof-mir/canonicalization/program-freeze-shared";
import { draftOriginKey } from "../../../src/proof-mir/draft/draft-keys";
import type { ProofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type { ProofMirFunction } from "../../../src/proof-mir/model/graph";
import type { ProofMirOrigin, ProofMirOriginOwner } from "../../../src/proof-mir/model/origins";
import type { MonoInstanceId } from "../../../src/mono/ids";
import type {
  ProofMirBlockId,
  ProofMirControlEdgeId,
  ProofMirStatementId,
  ProofMirTerminatorId,
} from "../../../src/proof-mir/ids";
import {
  proofCheckDiagnostic,
  proofCheckDiagnosticCode,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../../../src/proof-check/diagnostics";
import { compareCodeUnitStrings } from "../../../src/semantic/surface/deterministic-sort";

export type ProofCheckSourceSyntaxSupport = "supported" | "unsupported-source-syntax";

export interface ProofCheckDomainIntegrationFixture {
  readonly sourceSyntax: ProofCheckSourceSyntaxSupport;
  readonly mir: ProofMirProgram;
  readonly originKeys: readonly string[];
  readonly functionKeys: readonly string[];
  readonly blockKeys: readonly string[];
  readonly programPointKeys: readonly string[];
}

export interface ProofCheckDiagnosticOrderExpectation {
  readonly code: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
}

function sourceFilesForProofCheckTest(source: string): readonly [string, string][] {
  return [["main.wr", source]];
}

function hasErrorDiagnostics(diagnostics: readonly object[]): boolean {
  return diagnostics.some(
    (diagnostic) => "severity" in diagnostic && diagnostic.severity === "error",
  );
}

function sortStableKeys(keys: readonly string[]): readonly string[] {
  return [...keys].sort(compareCodeUnitStrings);
}

function originOwnerForFrozenOrigin(
  owner: ProofMirOriginOwner,
): Parameters<typeof draftOriginKey>[0]["owner"] {
  switch (owner.kind) {
    case "function":
      return { kind: "function", functionInstanceId: owner.functionInstanceId };
    case "image":
      return { kind: "image", imageInstanceId: owner.imageInstanceId };
    case "platform":
      return {
        kind: "platform",
        ...(owner.edgeId !== undefined ? { edgeId: owner.edgeId } : {}),
        ...(owner.primitiveId !== undefined ? { primitiveId: String(owner.primitiveId) } : {}),
      };
    case "runtimeCatalog":
      return {
        kind: "runtimeCatalog",
        ...(owner.runtimeId !== undefined ? { runtimeId: owner.runtimeId } : {}),
      };
    case "program":
      return { kind: "program" };
    default: {
      const unreachable: never = owner;
      return unreachable;
    }
  }
}

function originKeyForFrozenOrigin(origin: ProofMirOrigin): string {
  return String(
    draftOriginKey({
      owner: originOwnerForFrozenOrigin(origin.owner),
      ...(origin.sourceOrigin !== undefined ? { sourceOrigin: String(origin.sourceOrigin) } : {}),
      ...(origin.note !== undefined ? { note: origin.note } : {}),
      ...(origin.monoExpressionId !== undefined
        ? { monoExpressionId: origin.monoExpressionId }
        : {}),
      ...(origin.monoStatementId !== undefined ? { monoStatementId: origin.monoStatementId } : {}),
    }),
  );
}

function blockKeyForFrozenBlock(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
}): string {
  return `block:function:${String(input.functionInstanceId)}/blockId:${String(input.blockId)}`;
}

function programPointKeyForFunctionEntry(functionInstanceId: MonoInstanceId): string {
  return `functionEntry:function:${String(functionInstanceId)}`;
}

function programPointKeyForStatement(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly statementId: ProofMirStatementId;
}): string {
  return [
    "statement",
    `function:${String(input.functionInstanceId)}`,
    `block:${String(input.blockId)}`,
    `statement:${String(input.statementId)}`,
  ].join("/");
}

function programPointKeyForTerminator(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly terminatorId: ProofMirTerminatorId;
}): string {
  return [
    "terminator",
    `function:${String(input.functionInstanceId)}`,
    `block:${String(input.blockId)}`,
    `terminator:${String(input.terminatorId)}`,
  ].join("/");
}

function programPointKeyForEdge(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly edgeId: ProofMirControlEdgeId;
}): string {
  return `edge:function:${String(input.functionInstanceId)}/edge:${String(input.edgeId)}`;
}

function programPointKeyForExit(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly exitIndex: number;
}): string {
  return `exit:function:${String(input.functionInstanceId)}/exit:${String(input.exitIndex)}`;
}

function collectProgramPointKeysForFunction(functionInstance: ProofMirFunction): readonly string[] {
  const functionInstanceId = functionInstance.functionInstanceId;
  const programPointKeys: string[] = [programPointKeyForFunctionEntry(functionInstanceId)];

  for (const block of functionInstance.blocks.entries()) {
    for (const statement of block.statements) {
      programPointKeys.push(
        programPointKeyForStatement({
          functionInstanceId,
          blockId: block.blockId,
          statementId: statement.statementId,
        }),
      );
    }
    programPointKeys.push(
      programPointKeyForTerminator({
        functionInstanceId,
        blockId: block.blockId,
        terminatorId: block.terminator.terminatorId,
      }),
    );
  }

  for (const edge of functionInstance.edges.entries()) {
    programPointKeys.push(
      programPointKeyForEdge({
        functionInstanceId,
        edgeId: edge.edgeId,
      }),
    );
  }

  functionInstance.exits.forEach((_exit, exitIndex) => {
    programPointKeys.push(
      programPointKeyForExit({
        functionInstanceId,
        exitIndex,
      }),
    );
  });

  return programPointKeys;
}

export function proofCheckIntegrationFixtureKeysForMir(
  mir: ProofMirProgram,
): Pick<
  ProofCheckDomainIntegrationFixture,
  "originKeys" | "functionKeys" | "blockKeys" | "programPointKeys"
> {
  const originKeys = sortStableKeys(
    mir.origins.entries().map((origin) => originKeyForFrozenOrigin(origin)),
  );
  const functionKeys = sortStableKeys(
    mir.functions
      .entries()
      .map((functionInstance) =>
        String(functionCanonicalKey(functionInstance.functionInstanceId) as ProofMirCanonicalKey),
      ),
  );
  const blockKeys = sortStableKeys(
    mir.functions.entries().flatMap((functionInstance) =>
      functionInstance.blocks.entries().map((block) =>
        blockKeyForFrozenBlock({
          functionInstanceId: functionInstance.functionInstanceId,
          blockId: block.blockId,
        }),
      ),
    ),
  );
  const programPointKeys = sortStableKeys(
    mir.functions
      .entries()
      .flatMap((functionInstance) => collectProgramPointKeysForFunction(functionInstance)),
  );

  return {
    originKeys,
    functionKeys,
    blockKeys,
    programPointKeys,
  };
}

function probeProofCheckSourceSyntaxFromFiles(
  files: readonly [string, string][],
): ProofCheckSourceSyntaxSupport {
  try {
    const graph = parseModuleGraphForTest(files);
    if (hasErrorDiagnostics(graph.diagnostics)) {
      return "unsupported-source-syntax";
    }

    const surfaceResult = checkSemanticSurfaceForTest(files);
    if (hasErrorDiagnostics(surfaceResult.diagnostics)) {
      return "unsupported-source-syntax";
    }

    const hirResult = lowerTypedHirForTest(files);
    if (hasErrorDiagnostics(hirResult.diagnostics)) {
      return "unsupported-source-syntax";
    }

    const buildInput = proofMirBuildInputForSource(files[0]![1]);
    const mirResult = buildProofMir(buildInput);
    if (mirResult.kind !== "ok") {
      return "unsupported-source-syntax";
    }

    return "supported";
  } catch {
    return "unsupported-source-syntax";
  }
}

export function probeProofCheckSourceSyntaxForTest(source: string): ProofCheckSourceSyntaxSupport {
  return probeProofCheckSourceSyntaxFromFiles(sourceFilesForProofCheckTest(source));
}

function buildProofMirFromSupportedSource(source: string): ProofMirProgram {
  const buildInput: ProofMirBuildInput = proofMirBuildInputForSource(source);
  const result = buildProofMir(buildInput);
  if (result.kind !== "ok") {
    throw new Error(
      `supported source failed to build Proof MIR: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

export function domainIntegrationFixtureForTest(input: {
  readonly source: string;
  readonly fixtureFallback?: () => ProofMirProgram;
}): ProofCheckDomainIntegrationFixture {
  const sourceSyntax = probeProofCheckSourceSyntaxForTest(input.source);
  const mir =
    sourceSyntax === "supported"
      ? buildProofMirFromSupportedSource(input.source)
      : (() => {
          if (input.fixtureFallback === undefined) {
            throw new Error(
              "domainIntegrationFixtureForTest requires fixtureFallback when source syntax is unsupported.",
            );
          }
          return input.fixtureFallback();
        })();

  return {
    sourceSyntax,
    mir,
    ...proofCheckIntegrationFixtureKeysForMir(mir),
  };
}

export function expectProofCheckDiagnosticOrderForTest(
  diagnostics: readonly ProofCheckDiagnostic[],
  expected: readonly ProofCheckDiagnosticOrderExpectation[],
): void {
  const sorted = sortProofCheckDiagnostics(diagnostics);
  expect(sorted.map((diagnostic) => diagnostic.code)).toEqual(
    expected.map((entry) => proofCheckDiagnosticCode(entry.code)),
  );
  expect(sorted.map((diagnostic) => diagnostic.ownerKey)).toEqual(
    expected.map((entry) => entry.ownerKey),
  );
  expect(sorted.map((diagnostic) => diagnostic.rootCauseKey)).toEqual(
    expected.map((entry) => entry.rootCauseKey),
  );
}

export const PROOF_CHECK_SUPPORTED_CLOSED_SOURCE = [
  "uefi image Boot:",
  "    fn main() -> Never:",
  "        return",
].join("\n");

export type BuildProofMirInputFromSourceForProofCheckTestResult =
  | { readonly kind: "ok"; readonly mir: ProofMirProgram }
  | { readonly kind: "unsupported-source-syntax" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

function proofCheckDiagnosticsForMirBuildFailure(
  diagnostics: readonly { readonly code: unknown; readonly message?: string }[],
): readonly ProofCheckDiagnostic[] {
  return diagnostics.map((diagnostic, index) =>
    proofCheckDiagnostic({
      severity: "error",
      code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
      messageTemplateId: "proof-check.source-build.failed",
      messageArguments: [{ kind: "text", value: String(diagnostic.code) }],
      message: diagnostic.message ?? `Proof MIR build failed: ${String(diagnostic.code)}`,
      ownerKey: "proof-check:source-build",
      rootCauseKey: `proof-mir:${String(diagnostic.code)}`,
      stableDetail: String(diagnostic.code),
      sourceOrigin: "proof-check:source-build",
      pathFrameKey: `diagnostic:${String(index)}`,
    }),
  );
}

export function buildProofMirInputFromSourceForProofCheckTest(
  source: string,
): BuildProofMirInputFromSourceForProofCheckTestResult {
  const syntaxSupport = probeProofCheckSourceSyntaxForTest(source);
  if (syntaxSupport === "unsupported-source-syntax") {
    return { kind: "unsupported-source-syntax" };
  }

  const buildInput: ProofMirBuildInput = proofMirBuildInputForSource(source);
  const result = buildProofMir(buildInput);
  if (result.kind !== "ok") {
    return {
      kind: "error",
      diagnostics: proofCheckDiagnosticsForMirBuildFailure(result.diagnostics),
    };
  }
  return { kind: "ok", mir: result.mir };
}

export function checkProofSourceForTest(
  source: string,
  options?: {
    readonly fixtureFallback?: ProofCheckClosedFixtureOptions | CheckProofAndResourcesInput;
  },
): CheckProofAndResourcesResult {
  const syntaxSupport = probeProofCheckSourceSyntaxForTest(source);
  const built = buildProofMirInputFromSourceForProofCheckTest(source);
  if (
    (syntaxSupport === "unsupported-source-syntax" || built.kind === "unsupported-source-syntax") &&
    options?.fixtureFallback !== undefined
  ) {
    const fallback = options.fixtureFallback;
    if ("semantics" in fallback && fallback.mir !== undefined) {
      return checkProofAndResources(withProofCheckAuthoritiesForTest(fallback));
    }
    return checkProofAndResourcesForClosedFixture(fallback);
  }
  if (built.kind === "unsupported-source-syntax") {
    return {
      kind: "error",
      diagnostics: [
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
          messageTemplateId: "proof-check.source-syntax.unsupported",
          messageArguments: [{ kind: "text", value: "unsupported-source-syntax" }],
          message: "Source syntax is not supported for proof-check integration.",
          ownerKey: "proof-check:source-syntax",
          rootCauseKey: "unsupported-source-syntax",
          stableDetail: "unsupported-source-syntax",
          sourceOrigin: "proof-check:source-syntax",
        }),
      ],
    };
  }
  if (built.kind !== "ok") {
    return { kind: "error", diagnostics: sortProofCheckDiagnostics(built.diagnostics) };
  }
  return checkProofAndResources(withProofCheckAuthoritiesForTest({ mir: built.mir }));
}

export function proofCheckFixtureFallbackForInvalidCase(
  invalidCase: ProofCheckInvalidFixtureCase,
): CheckProofAndResourcesInput {
  return proofCheckClosedFixture({ invalidCase });
}
