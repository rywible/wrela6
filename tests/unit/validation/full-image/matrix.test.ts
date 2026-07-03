import { expect, test } from "bun:test";

import {
  FULL_IMAGE_VALIDATION_ALLOWED_EXTRA_STAGE_KEYS,
  FULL_IMAGE_VALIDATION_CASES,
  FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS,
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
} from "../../../../src/validation/full-image";
import { fullImageValidationV1Cases as barrelCases } from "../../../../src/validation";

test("v1 matrix is explicit and deterministic", () => {
  expect(fullImageValidationV1Cases().map(fullImageValidationCaseKey)).toEqual([
    "smoke-console/toolchain-stdlib",
    "smoke-console/ejected-stdlib",
    "smoke-console/direct-platform",
    "packet-counter/toolchain-stdlib",
    "packet-counter/ejected-stdlib",
    "packet-counter/direct-platform",
    "status-error/toolchain-stdlib",
    "watchdog-or-boot-policy/toolchain-stdlib",
  ]);
  expect(barrelCases().map(fullImageValidationCaseKey)).toEqual(
    fullImageValidationV1Cases().map(fullImageValidationCaseKey),
  );
});

test("public constants expose the closed v1 stage and case contracts", () => {
  expect(FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS).toEqual([
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
  ]);
  expect(FULL_IMAGE_VALIDATION_ALLOWED_EXTRA_STAGE_KEYS).toEqual(["artifact-sink", "qemu-smoke"]);
  expect(FULL_IMAGE_VALIDATION_CASES).toEqual([
    ["smoke-console", "toolchain-stdlib"],
    ["smoke-console", "ejected-stdlib"],
    ["smoke-console", "direct-platform"],
    ["packet-counter", "toolchain-stdlib"],
    ["packet-counter", "ejected-stdlib"],
    ["packet-counter", "direct-platform"],
    ["status-error", "toolchain-stdlib"],
    ["watchdog-or-boot-policy", "toolchain-stdlib"],
  ]);
});
