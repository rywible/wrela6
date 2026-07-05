import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import { uefiAArch64PlatformPrimitiveNameCatalog } from "../../../target/uefi-aarch64";
import {
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_PRIMITIVE_ID,
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_STREAM_PRIMITIVE_ID,
} from "../../../target/uefi-aarch64/validation-fixture-packet-rule";
import type {
  FullImageValidationCheckReport,
  FullImageValidationEvidenceAuthority,
  FullImageValidationEvidenceRecord,
} from "../report";
import type { FullImageValidationScenarioKey } from "../matrix";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";

const CHECKER_KEY = "semantic-platform-reference";
const INPUT_AUTHORITY = Object.freeze(["source-package", "compiler-trace"] as const);
const PLATFORM_FUNCTION_PATTERN = /^\s*platform\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
const PACKET_COUNTER_UEFI_SOURCE_PRIMITIVES = Object.freeze([
  "uefi.source.bindVirtioNet",
  "uefi.source.discoverVirtio",
  "uefi.source.exitBootServices",
  "uefi.source.planMachine",
  "uefi.source.reserveRestrictedMemory",
  "uefi.source.splitNetworkDevice",
]);
const EXPECTED_REACHABLE_PRIMITIVES_BY_SCENARIO = Object.freeze({
  "smoke-console": Object.freeze(["uefi.console.outputString"]),
  "two-branch-control-flow": Object.freeze(["uefi.console.outputString"]),
  "packet-counter": Object.freeze([
    "uefi.console.outputString",
    ...PACKET_COUNTER_UEFI_SOURCE_PRIMITIVES,
    UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_PRIMITIVE_ID,
  ]),
  "packet-counter-real-stream": Object.freeze([
    "uefi.console.outputString",
    ...PACKET_COUNTER_UEFI_SOURCE_PRIMITIVES,
    UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_STREAM_PRIMITIVE_ID,
  ]),
  "status-error": Object.freeze([]),
  "watchdog-or-boot-policy": Object.freeze(["uefi.boot.setWatchdogTimer"]),
  "stdlib-core-option-result": Object.freeze([]),
  "stdlib-bits": Object.freeze([]),
} satisfies Record<FullImageValidationScenarioKey, readonly string[]>);

export function semanticPlatformReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runSemanticPlatformReferenceChecker,
  });
}

function runSemanticPlatformReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  if (input.trace === undefined) {
    return Object.freeze([
      report({
        status: "skipped",
        stableDetail: "semantic-platform:trace-missing",
        evidence: [
          evidence(
            "source-package",
            "declared-platform-primitives",
            declaredPrimitiveDetail(input),
          ),
          evidence(
            "compiler-trace",
            "reachable-platform-primitives",
            "trace packagePipeline unavailable",
          ),
        ],
      }),
    ]);
  }

  const declarations = platformPrimitiveDeclarations(input);
  const unknownNames = declarations
    .filter((declaration) => declaration.primitiveId === undefined)
    .map((declaration) => declaration.name)
    .sort(compareCodeUnitStrings);
  if (input.stdlibMode === "direct-platform" && unknownNames.length > 0) {
    return Object.freeze([
      report({
        status: "failed",
        stableDetail: `semantic-platform:direct-platform:unknown-platform-primitive:${joined(unknownNames)}`,
        evidence: [
          evidence(
            "source-package",
            "declared-platform-primitives",
            declarationDetail(declarations),
          ),
          evidence(
            "compiler-trace",
            "uefi-platform-primitive-name-catalog",
            platformPrimitiveCatalogDetail(),
          ),
        ],
      }),
    ]);
  }

  const expectedReachable = expectedReachablePrimitiveIds(input.scenario);
  const reachable = reachablePlatformPrimitiveIds(input);
  const missing = expectedReachable.filter((primitiveId) => !reachable.includes(primitiveId));
  if (missing.length > 0) {
    return Object.freeze([
      report({
        status: "failed",
        stableDetail: `semantic-platform:reachable:mismatch:missing:${joined(missing)}`,
        evidence: reachabilityEvidence(input, declarations, expectedReachable, reachable),
      }),
    ]);
  }

  return Object.freeze([
    report({
      status: "passed",
      stableDetail: `semantic-platform:reachable:${joined(expectedReachable)}`,
      evidence: reachabilityEvidence(input, declarations, expectedReachable, reachable),
    }),
  ]);
}

interface PlatformPrimitiveDeclaration {
  readonly name: string;
  readonly primitiveId?: string;
}

function platformPrimitiveDeclarations(
  input: FullImageReferenceCheckerInput,
): readonly PlatformPrimitiveDeclaration[] {
  const catalog = uefiAArch64PlatformPrimitiveNameCatalog();
  const declarations = new Map<string, PlatformPrimitiveDeclaration>();
  for (const source of input.packageInput.sourceFiles) {
    for (const match of source.text.matchAll(PLATFORM_FUNCTION_PATTERN)) {
      const name = match[1];
      if (name === undefined) continue;
      declarations.set(name, {
        name,
        primitiveId:
          catalog.byName(name) === undefined
            ? undefined
            : String(catalog.byName(name)?.primitiveId),
      });
    }
  }
  return Object.freeze(
    [...declarations.values()].sort((left, right) => compareCodeUnitStrings(left.name, right.name)),
  );
}

function expectedReachablePrimitiveIds(
  scenario: FullImageValidationScenarioKey,
): readonly string[] {
  return EXPECTED_REACHABLE_PRIMITIVES_BY_SCENARIO[scenario];
}

function reachablePlatformPrimitiveIds(input: FullImageReferenceCheckerInput): readonly string[] {
  return Object.freeze(
    [
      ...new Set((input.trace?.packagePipeline.reachablePlatformPrimitiveIds ?? []).map(String)),
    ].sort(compareCodeUnitStrings),
  );
}

function reachabilityEvidence(
  input: FullImageReferenceCheckerInput,
  declarations: readonly PlatformPrimitiveDeclaration[],
  expectedReachable: readonly string[],
  reachable: readonly string[],
): readonly FullImageValidationEvidenceRecord[] {
  return Object.freeze([
    evidence("source-package", "declared-platform-primitives", declarationDetail(declarations)),
    evidence("compiler-trace", "expected-reachable-primitives", joined(expectedReachable)),
    evidence("compiler-trace", "reachable-platform-primitives", joined(reachable)),
  ]);
}

function declaredPrimitiveDetail(input: FullImageReferenceCheckerInput): string {
  return declarationDetail(platformPrimitiveDeclarations(input));
}

function declarationDetail(declarations: readonly PlatformPrimitiveDeclaration[]): string {
  return joined(
    declarations.map(
      (declaration) => `${declaration.name}=${declaration.primitiveId ?? "<unknown>"}`,
    ),
  );
}

function platformPrimitiveCatalogDetail(): string {
  return joined(
    uefiAArch64PlatformPrimitiveNameCatalog().primitives.map(
      (primitive) => `${primitive.name}=${String(primitive.primitiveId)}`,
    ),
  );
}

function joined(values: readonly string[]): string {
  return values.join(",");
}

function report(input: {
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: CHECKER_KEY,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: INPUT_AUTHORITY,
    evidence: input.evidence,
  });
}

function evidence(
  authority: FullImageValidationEvidenceAuthority,
  evidenceKey: string,
  stableDetail: string,
): FullImageValidationEvidenceRecord {
  return referenceEvidence({
    evidenceKey,
    authority,
    stableDetail,
  });
}
