import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import {
  AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
  type AArch64ObjectRelocation,
} from "../../../target/aarch64";
import type { AArch64LinkInputModule } from "../../../linker";
import type { FullImageValidationCheckReport, FullImageValidationEvidenceRecord } from "../report";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";

const CHECKER_KEY = "aarch64-object-reference";
const INPUT_AUTHORITY = Object.freeze(["compiler-trace"] as const);
const EXPECTED_RELOCATION_FAMILIES = new Set([
  "branch26",
  "branch19",
  "branch14",
  "pagebase-rel21",
  "pageoffset-12a",
  "pageoffset-12l",
  "addr64",
  "addr32",
  "addr32nb",
  "rel32",
  "section-relative",
]);

export function aarch64ObjectReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runAArch64ObjectReferenceChecker,
  });
}

function runAArch64ObjectReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  const binarySpine = input.trace?.binarySpine;
  if (binarySpine === undefined) {
    return Object.freeze([
      report("skipped", "aarch64-object:binary-spine-missing", [
        evidence("binary-spine", "trace.binarySpine unavailable"),
      ]),
    ]);
  }

  const modules = allModules(input);
  const definedLinkageNames = linkageDefinitions(modules);
  const staticChar16Required = binarySpineStaticChar16PointerCount(input) > 0;
  const reports = [
    moduleCategoryReport("backend", binarySpine.backendObjects),
    moduleCategoryReport("static-char16", binarySpine.staticChar16Objects, staticChar16Required),
    moduleCategoryReport(
      "validation-fixture",
      binarySpine.validationFixtureObjects,
      input.scenario === "packet-counter",
    ),
    moduleCategoryReport("helper", binarySpine.helperObjects),
    targetFingerprintReport(input),
    ...modules.flatMap((module) => moduleReports(module, definedLinkageNames)),
    ...binarySpine.staticChar16Objects.flatMap(staticChar16Reports),
  ];
  const failures = reports.filter((candidate) => candidate.status === "failed");
  if (failures.length > 0) return Object.freeze(failures.sort(compareReports));
  return Object.freeze(reports.sort(compareReports));
}

function binarySpineStaticChar16PointerCount(input: FullImageReferenceCheckerInput): number {
  return input.trace?.packagePipeline?.optIr?.staticChar16Pointers.length ?? 0;
}

function moduleCategoryReport(
  category: string,
  modules: readonly AArch64LinkInputModule[],
  required = true,
): FullImageValidationCheckReport {
  return report(
    modules.length > 0 || !required ? "passed" : "failed",
    modules.length > 0
      ? `aarch64-object:${category}:modules:${moduleKeys(modules)}`
      : !required
        ? `aarch64-object:${category}:modules:not-required`
        : `aarch64-object:${category}:modules-missing`,
    [evidence(`${category}-modules`, moduleKeys(modules))],
  );
}

function targetFingerprintReport(
  input: FullImageReferenceCheckerInput,
): FullImageValidationCheckReport {
  const expected = input.trace?.target.backendTargetFingerprint;
  const mismatches = allModules(input)
    .filter(
      (module) =>
        expected !== undefined && module.objectModule.targetBackendSurfaceFingerprint !== expected,
    )
    .map(
      (module) =>
        `${module.moduleKey}:${module.objectModule.targetBackendSurfaceFingerprint}:${expected}`,
    )
    .sort(compareCodeUnitStrings);
  return report(
    mismatches.length === 0 ? "passed" : "failed",
    mismatches.length === 0
      ? `aarch64-object:target-fingerprints:matched:${expected ?? "unavailable"}`
      : `aarch64-object:target-fingerprints:mismatch:${mismatches.join(",")}`,
    [evidence("target-backend-fingerprint", expected ?? "unavailable")],
  );
}

function moduleReports(
  module: AArch64LinkInputModule,
  definedLinkageNames: ReadonlySet<string>,
): readonly FullImageValidationCheckReport[] {
  return Object.freeze([
    deterministicKeyReport(module),
    undefinedSymbolsReport(module, definedLinkageNames),
    relocationFamilyReport(module),
  ]);
}

function deterministicKeyReport(module: AArch64LinkInputModule): FullImageValidationCheckReport {
  const objectModule = module.objectModule;
  const badKeys = [
    ...duplicateOrUnsorted(
      "section",
      objectModule.sections.map((section) => String(section.stableKey)),
    ),
    ...duplicateOrUnsorted(
      "symbol",
      objectModule.symbols.map((symbol) => String(symbol.stableKey)),
    ),
    ...duplicateOrUnsorted(
      "relocation",
      objectModule.relocations.map((relocation) => String(relocation.stableKey)),
    ),
  ];
  return report(
    badKeys.length === 0 ? "passed" : "failed",
    badKeys.length === 0
      ? `aarch64-object:deterministic-keys:${module.moduleKey}`
      : `aarch64-object:deterministic-keys:${module.moduleKey}:${badKeys.join(",")}`,
    [evidence("object-module", module.moduleKey)],
  );
}

function undefinedSymbolsReport(
  module: AArch64LinkInputModule,
  definedLinkageNames: ReadonlySet<string>,
): FullImageValidationCheckReport {
  const externals = module.objectModule.symbols
    .filter((symbol) => symbol.kind === "external-declaration")
    .map((symbol) => symbol.linkageName)
    .filter((linkageName) => !definedLinkageNames.has(linkageName))
    .sort(compareCodeUnitStrings);
  return report(
    externals.length === 0 ? "passed" : "failed",
    externals.length === 0
      ? `aarch64-object:undefined-symbols:absent:${module.moduleKey}`
      : `aarch64-object:undefined-symbols:${module.moduleKey}:${externals.join(",")}`,
    [evidence("external-symbols", externals.join(","))],
  );
}

function relocationFamilyReport(module: AArch64LinkInputModule): FullImageValidationCheckReport {
  const unexpected = module.objectModule.relocations
    .filter((relocation) => !EXPECTED_RELOCATION_FAMILIES.has(relocation.family))
    .map((relocation) => relocationDetail(relocation))
    .sort(compareCodeUnitStrings);
  return report(
    unexpected.length === 0 ? "passed" : "failed",
    unexpected.length === 0
      ? `aarch64-object:relocation-families:expected:${module.moduleKey}`
      : `aarch64-object:relocation-families:unexpected:${module.moduleKey}:${unexpected.join(",")}`,
    [
      evidence(
        "relocation-families",
        module.objectModule.relocations
          .map((relocation) => relocation.family)
          .sort(compareCodeUnitStrings)
          .join(","),
      ),
    ],
  );
}

function staticChar16Reports(
  module: AArch64LinkInputModule,
): readonly FullImageValidationCheckReport[] {
  return Object.freeze(
    module.objectModule.sections.flatMap((section) => {
      const detail = `${module.moduleKey}:${String(section.stableKey)}`;
      const reports: FullImageValidationCheckReport[] = [];
      if (section.classKey !== AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA) {
        reports.push(
          report("failed", `aarch64-object:static-char16:section-not-read-only:${detail}`, [
            evidence("static-char16-section", detail),
          ]),
        );
      }
      if (!isNulTerminatedChar16Bytes(section.bytes)) {
        reports.push(
          report("failed", `aarch64-object:static-char16:not-nul-terminated:${detail}`, [
            evidence("static-char16-bytes", `bytes:${section.bytes.length}`),
          ]),
        );
      }
      return reports.length === 0
        ? [
            report("passed", `aarch64-object:static-char16:read-only-nul-terminated:${detail}`, [
              evidence("static-char16-section", detail),
            ]),
          ]
        : reports;
    }),
  );
}

function allModules(input: FullImageReferenceCheckerInput): readonly AArch64LinkInputModule[] {
  const binarySpine = input.trace?.binarySpine;
  if (binarySpine === undefined) return Object.freeze([]);
  const modules = [
    ...binarySpine.backendObjects,
    ...binarySpine.staticChar16Objects,
    ...binarySpine.validationFixtureObjects,
    ...binarySpine.helperObjects,
  ];
  const deduped = new Map<string, AArch64LinkInputModule>();
  for (const module of modules) {
    if (!deduped.has(module.moduleKey)) deduped.set(module.moduleKey, module);
  }
  return Object.freeze([...deduped.values()].sort(compareModules));
}

function linkageDefinitions(modules: readonly AArch64LinkInputModule[]): ReadonlySet<string> {
  const definitions = new Set<string>();
  for (const module of modules) {
    for (const symbol of module.objectModule.symbols) {
      if (
        symbol.kind !== "external-declaration" &&
        "linkageName" in symbol &&
        typeof symbol.linkageName === "string"
      ) {
        definitions.add(symbol.linkageName);
      }
    }
  }
  return definitions;
}

function duplicateOrUnsorted(label: string, keys: readonly string[]): readonly string[] {
  const sorted = [...keys].sort(compareCodeUnitStrings);
  const diagnostics: string[] = [];
  if (keys.join("\0") !== sorted.join("\0")) diagnostics.push(`${label}:order`);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1])
      diagnostics.push(`${label}:duplicate:${sorted[index]}`);
  }
  return diagnostics;
}

function isNulTerminatedChar16Bytes(bytes: readonly number[]): boolean {
  return bytes.length >= 2 && bytes.length % 2 === 0 && bytes.at(-1) === 0 && bytes.at(-2) === 0;
}

function moduleKeys(modules: readonly AArch64LinkInputModule[]): string {
  return modules
    .map((module) => module.moduleKey)
    .sort(compareCodeUnitStrings)
    .join(",");
}

function relocationDetail(relocation: AArch64ObjectRelocation): string {
  return `${String(relocation.stableKey)}:${relocation.family}`;
}

function compareModules(left: AArch64LinkInputModule, right: AArch64LinkInputModule): number {
  return compareCodeUnitStrings(left.moduleKey, right.moduleKey);
}

function report(
  status: FullImageValidationCheckReport["status"],
  stableDetail: string,
  evidenceRecords: readonly FullImageValidationEvidenceRecord[],
): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: CHECKER_KEY,
    status,
    stableDetail,
    inputAuthority: INPUT_AUTHORITY,
    evidence: evidenceRecords,
  });
}

function evidence(evidenceKey: string, stableDetail: string): FullImageValidationEvidenceRecord {
  return referenceEvidence({ evidenceKey, authority: "compiler-trace" as const, stableDetail });
}

function compareReports(
  left: FullImageValidationCheckReport,
  right: FullImageValidationCheckReport,
): number {
  return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
}
