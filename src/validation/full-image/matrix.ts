export type FullImageValidationStdlibMode =
  | "toolchain-stdlib"
  | "ejected-stdlib"
  | "direct-platform";

export type FullImageValidationScenarioKey =
  | "smoke-console"
  | "packet-counter"
  | "status-error"
  | "watchdog-or-boot-policy";

export interface FullImageValidationCaseKey {
  readonly scenario: FullImageValidationScenarioKey;
  readonly stdlibMode: FullImageValidationStdlibMode;
}

export const FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS = Object.freeze([
  "target-driver-authenticate",
  "frontend",
  "semantic",
  "monomorphization",
  "layout-facts",
  "proof-mir",
  "proof-check",
  "opt-ir",
  "aarch64-lowering",
  "aarch64-backend",
  "static-char16-objects",
  "validation-fixture-objects",
  "runtime-helper-objects",
  "synthetic-entry-object",
  "linker",
  "pe-coff-writer",
] as const);

export const FULL_IMAGE_VALIDATION_ALLOWED_EXTRA_STAGE_KEYS = Object.freeze([
  "artifact-sink",
  "qemu-smoke",
] as const);

export const FULL_IMAGE_VALIDATION_CASES = Object.freeze([
  ["smoke-console", "toolchain-stdlib"],
  ["smoke-console", "ejected-stdlib"],
  ["smoke-console", "direct-platform"],
  ["packet-counter", "toolchain-stdlib"],
  ["packet-counter", "ejected-stdlib"],
  ["packet-counter", "direct-platform"],
  ["status-error", "toolchain-stdlib"],
  ["watchdog-or-boot-policy", "toolchain-stdlib"],
] as const);

export type FullImageValidationRequiredStageKey =
  (typeof FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS)[number];

export function fullImageValidationV1Cases(): readonly FullImageValidationCaseKey[] {
  return Object.freeze(
    FULL_IMAGE_VALIDATION_CASES.map(([scenario, stdlibMode]) =>
      Object.freeze({ scenario, stdlibMode }),
    ),
  );
}

export function fullImageValidationCaseKey(input: FullImageValidationCaseKey): string {
  return `${input.scenario}/${input.stdlibMode}`;
}
