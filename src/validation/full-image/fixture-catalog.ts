import {
  defaultUefiAArch64SourceRoots,
  packageInputFromFixtureProject,
  type CompilerPackageInput,
  type FixtureProjectFilesystem,
  type UefiAArch64ValidationFixturePacketSource,
} from "../../target/uefi-aarch64/package-input";
import {
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_FEATURE,
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_PRIMITIVE_ID,
} from "../../target/uefi-aarch64/validation-fixture-packet-rule";
import {
  fullImageValidationV1Cases,
  type FullImageValidationCaseKey,
  type FullImageValidationScenarioKey,
  type FullImageValidationStdlibMode,
} from "./matrix";
import type { UefiAArch64TargetResult } from "../../target/uefi-aarch64/result";

export interface FullImageValidationFixtureSpec extends FullImageValidationCaseKey {
  readonly scenario: FullImageValidationScenarioKey;
  readonly stdlibMode: FullImageValidationStdlibMode;
  readonly fixtureProjectPath: string;
  readonly packageKey: string;
  readonly entryModuleName: "image";
  readonly artifactName: string;
  readonly packageStdlibMode: "toolchain" | "project-ejected" | "none";
  readonly enabledTargetFeatures: readonly string[];
  readonly validationFixturePacketSource?: UefiAArch64ValidationFixturePacketSource;
  readonly expectedConsoleMarkers: readonly string[];
  readonly expectedStatus?: "bad_buffer_size";
  readonly expectedPrimitive?: "set_watchdog_timer";
}

const FIXTURE_PROJECT_ROOT = "tests/fixtures/full-image-validation";
const ENTRY_MODULE_NAME = "image";
const POSITIVE_PACKET_COUNTER_FIXTURE_BYTES = Object.freeze([
  0x01, 0x02, 0x03, 0x41, 0x42,
] as const);
const ENABLED_TARGET_FEATURES_BY_SCENARIO = Object.freeze({
  "smoke-console": Object.freeze([]),
  "packet-counter": Object.freeze([UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_FEATURE]),
  "status-error": Object.freeze([]),
  "watchdog-or-boot-policy": Object.freeze([]),
} satisfies Record<FullImageValidationScenarioKey, readonly string[]>);
const EXPECTED_CONSOLE_MARKERS_BY_SCENARIO = Object.freeze({
  "smoke-console": Object.freeze(["WRELA_UEFI_SMOKE_OK"]),
  "packet-counter": Object.freeze(["WRELA_PACKET_COUNTER_OK"]),
  "status-error": Object.freeze([]),
  "watchdog-or-boot-policy": Object.freeze([]),
} satisfies Record<FullImageValidationScenarioKey, readonly string[]>);
const EXPECTED_OPTIONAL_FIELDS_BY_SCENARIO = Object.freeze({
  "smoke-console": Object.freeze({}),
  "packet-counter": Object.freeze({}),
  "status-error": Object.freeze({ expectedStatus: "bad_buffer_size" as const }),
  "watchdog-or-boot-policy": Object.freeze({
    expectedPrimitive: "set_watchdog_timer" as const,
  }),
} satisfies Record<
  FullImageValidationScenarioKey,
  {
    readonly expectedStatus?: "bad_buffer_size";
    readonly expectedPrimitive?: "set_watchdog_timer";
  }
>);
const BAD_PAYLOAD_PACKET_COUNTER_FIXTURE_BYTES = Object.freeze([0x01, 0x09, 0x03, 0x41] as const);

export type PacketCounterFixtureByteCase =
  | "packet-counter/toolchain-stdlib"
  | "packet-counter/ejected-stdlib"
  | "packet-counter/direct-platform"
  | "packet-counter-bad-payload/toolchain-stdlib";

export function packetCounterFixtureBytes(
  caseKey: PacketCounterFixtureByteCase,
): readonly number[] {
  if (caseKey === "packet-counter-bad-payload/toolchain-stdlib") {
    return BAD_PAYLOAD_PACKET_COUNTER_FIXTURE_BYTES;
  }
  return POSITIVE_PACKET_COUNTER_FIXTURE_BYTES;
}

export function fixtureSpecForFullImageCase(
  input: FullImageValidationCaseKey,
): FullImageValidationFixtureSpec {
  return Object.freeze({
    scenario: input.scenario,
    stdlibMode: input.stdlibMode,
    fixtureProjectPath: `${FIXTURE_PROJECT_ROOT}/${input.scenario}/${input.stdlibMode}`,
    packageKey: `full-image-validation:${input.scenario}:${input.stdlibMode}`,
    entryModuleName: ENTRY_MODULE_NAME,
    artifactName: `${input.scenario}-${input.stdlibMode}.efi`,
    packageStdlibMode: packageStdlibModeForFullImageCase(input.stdlibMode),
    enabledTargetFeatures: enabledTargetFeaturesForFullImageCase(input.scenario),
    ...validationFixturePacketSourceForFullImageCase(input),
    expectedConsoleMarkers: expectedConsoleMarkersForFullImageCase(input.scenario),
    ...expectedOptionalFieldsForFullImageCase(input.scenario),
  });
}

export function fixtureSpecsForFullImageV1Cases(): readonly FullImageValidationFixtureSpec[] {
  return Object.freeze(fullImageValidationV1Cases().map(fixtureSpecForFullImageCase));
}

export function packetCounterBadPayloadFixtureSpec(): FullImageValidationFixtureSpec {
  return Object.freeze({
    scenario: "packet-counter",
    stdlibMode: "toolchain-stdlib",
    fixtureProjectPath: `${FIXTURE_PROJECT_ROOT}/packet-counter-bad-payload/toolchain-stdlib`,
    packageKey: "full-image-validation:packet-counter-bad-payload:toolchain-stdlib",
    entryModuleName: ENTRY_MODULE_NAME,
    artifactName: "packet-counter-bad-payload-toolchain-stdlib.efi",
    packageStdlibMode: "toolchain",
    enabledTargetFeatures: Object.freeze([UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_FEATURE]),
    validationFixturePacketSource: Object.freeze({
      primitiveId: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_PRIMITIVE_ID,
      feature: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_FEATURE,
      stableKey:
        "full-image-validation:packet-counter-bad-payload:toolchain-stdlib:fixture-packet-source",
      bytes: Object.freeze([...BAD_PAYLOAD_PACKET_COUNTER_FIXTURE_BYTES]),
    }),
    expectedConsoleMarkers: Object.freeze([]),
    expectedStatus: "bad_buffer_size",
  });
}

export function packageInputForFullImageFixture(
  spec: FullImageValidationFixtureSpec,
  filesystem: FixtureProjectFilesystem,
): UefiAArch64TargetResult<CompilerPackageInput> {
  return packageInputFromFixtureProject(spec.fixtureProjectPath, {
    packageKey: spec.packageKey,
    entryModuleName: spec.entryModuleName,
    sourceRoots:
      spec.packageStdlibMode === "toolchain"
        ? defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" })
        : undefined,
    stdlibMode: spec.packageStdlibMode === "toolchain" ? undefined : spec.packageStdlibMode,
    projectSourceRoot: "src",
    enabledTargetFeatures: spec.enabledTargetFeatures,
    validationFixturePacketSource: spec.validationFixturePacketSource,
    filesystem,
  });
}

function packageStdlibModeForFullImageCase(
  stdlibMode: FullImageValidationStdlibMode,
): FullImageValidationFixtureSpec["packageStdlibMode"] {
  switch (stdlibMode) {
    case "toolchain-stdlib":
      return "toolchain";
    case "ejected-stdlib":
      return "project-ejected";
    case "direct-platform":
      return "none";
  }
}

function enabledTargetFeaturesForFullImageCase(
  scenario: FullImageValidationScenarioKey,
): readonly string[] {
  return ENABLED_TARGET_FEATURES_BY_SCENARIO[scenario];
}

function validationFixturePacketSourceForFullImageCase(input: FullImageValidationCaseKey): {
  readonly validationFixturePacketSource?: UefiAArch64ValidationFixturePacketSource;
} {
  switch (input.scenario) {
    case "packet-counter":
      return {
        validationFixturePacketSource: Object.freeze({
          primitiveId: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_PRIMITIVE_ID,
          feature: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SOURCE_FEATURE,
          stableKey: `full-image-validation:${input.scenario}:${input.stdlibMode}:fixture-packet-source`,
          bytes: Object.freeze([...POSITIVE_PACKET_COUNTER_FIXTURE_BYTES]),
        }),
      };
    case "smoke-console":
    case "status-error":
    case "watchdog-or-boot-policy":
      return {};
  }
}

function expectedConsoleMarkersForFullImageCase(
  scenario: FullImageValidationScenarioKey,
): readonly string[] {
  return EXPECTED_CONSOLE_MARKERS_BY_SCENARIO[scenario];
}

function expectedOptionalFieldsForFullImageCase(scenario: FullImageValidationScenarioKey): {
  readonly expectedStatus?: "bad_buffer_size";
  readonly expectedPrimitive?: "set_watchdog_timer";
} {
  return EXPECTED_OPTIONAL_FIELDS_BY_SCENARIO[scenario];
}
