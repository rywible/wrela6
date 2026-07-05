import { expect, test } from "bun:test";

import {
  fixtureSpecForFullImageCase,
  fixtureSpecsForFullImageV1Cases,
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
  packageInputForFullImageFixture,
} from "../../../../src/validation/full-image";
import { defaultUefiAArch64SourceRoots } from "../../../../src/target/uefi-aarch64/package-input";

test("every v1 case resolves to exactly one fixture project path", () => {
  const specs = fixtureSpecsForFullImageV1Cases();

  expect(specs.map(fullImageValidationCaseKey)).toEqual(
    fullImageValidationV1Cases().map(fullImageValidationCaseKey),
  );
  expect(new Set(specs.map((spec) => spec.fixtureProjectPath)).size).toBe(specs.length);
  expect(specs.map((spec) => [fullImageValidationCaseKey(spec), spec.fixtureProjectPath])).toEqual([
    [
      "smoke-console/toolchain-stdlib",
      "tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib",
    ],
    [
      "smoke-console/ejected-stdlib",
      "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib",
    ],
    [
      "smoke-console/direct-platform",
      "tests/fixtures/full-image-validation/smoke-console/direct-platform",
    ],
    [
      "packet-counter/toolchain-stdlib",
      "tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib",
    ],
    [
      "packet-counter/ejected-stdlib",
      "tests/fixtures/full-image-validation/packet-counter/ejected-stdlib",
    ],
    [
      "packet-counter/direct-platform",
      "tests/fixtures/full-image-validation/packet-counter/direct-platform",
    ],
    [
      "packet-counter-real-stream/toolchain-stdlib",
      "tests/fixtures/full-image-validation/packet-counter-real-stream/toolchain-stdlib",
    ],
    [
      "packet-counter-real-stream/ejected-stdlib",
      "tests/fixtures/full-image-validation/packet-counter-real-stream/ejected-stdlib",
    ],
    [
      "packet-counter-real-stream/direct-platform",
      "tests/fixtures/full-image-validation/packet-counter-real-stream/direct-platform",
    ],
    [
      "two-branch-control-flow/toolchain-stdlib",
      "tests/fixtures/full-image-validation/two-branch-control-flow/toolchain-stdlib",
    ],
    [
      "two-branch-control-flow/ejected-stdlib",
      "tests/fixtures/full-image-validation/two-branch-control-flow/ejected-stdlib",
    ],
    [
      "two-branch-control-flow/direct-platform",
      "tests/fixtures/full-image-validation/two-branch-control-flow/direct-platform",
    ],
    [
      "status-error/toolchain-stdlib",
      "tests/fixtures/full-image-validation/status-error/toolchain-stdlib",
    ],
    [
      "watchdog-or-boot-policy/toolchain-stdlib",
      "tests/fixtures/full-image-validation/watchdog-or-boot-policy/toolchain-stdlib",
    ],
    [
      "stdlib-core-option-result/toolchain-stdlib",
      "tests/fixtures/full-image-validation/stdlib-core-option-result/toolchain-stdlib",
    ],
    [
      "stdlib-bits/toolchain-stdlib",
      "tests/fixtures/full-image-validation/stdlib-bits/toolchain-stdlib",
    ],
  ]);
});

test("fixture specs map stdlib modes, package keys, artifacts, markers, and feature gates", () => {
  expect(
    fixtureSpecForFullImageCase({
      scenario: "packet-counter",
      stdlibMode: "direct-platform",
    }),
  ).toEqual({
    scenario: "packet-counter",
    stdlibMode: "direct-platform",
    fixtureProjectPath: "tests/fixtures/full-image-validation/packet-counter/direct-platform",
    packageKey: "full-image-validation:packet-counter:direct-platform",
    entryModuleName: "image",
    artifactName: "packet-counter-direct-platform.efi",
    packageStdlibMode: "none",
    enabledTargetFeatures: ["full-image-validation-fixture"],
    validationFixturePacketSource: {
      primitiveId: "uefi.validation.fixturePacketSource",
      feature: "full-image-validation-fixture",
      stableKey: "full-image-validation:packet-counter:direct-platform:fixture-packet-source",
      bytes: [0x01, 0x02, 0x03, 0x41, 0x42],
    },
    expectedConsoleMarkers: ["WRELA_PACKET_COUNTER_OK"],
  });

  expect(
    fixtureSpecForFullImageCase({
      scenario: "packet-counter-real-stream",
      stdlibMode: "toolchain-stdlib",
    }),
  ).toMatchObject({
    scenario: "packet-counter-real-stream",
    stdlibMode: "toolchain-stdlib",
    fixtureProjectPath:
      "tests/fixtures/full-image-validation/packet-counter-real-stream/toolchain-stdlib",
    packageKey: "full-image-validation:packet-counter-real-stream:toolchain-stdlib",
    artifactName: "packet-counter-real-stream-toolchain-stdlib.efi",
    packageStdlibMode: "toolchain",
    enabledTargetFeatures: ["full-image-validation-fixture"],
    expectedConsoleMarkers: ["WRELA_PACKET_COUNTER_OK"],
  });
  expect(
    fixtureSpecForFullImageCase({
      scenario: "packet-counter-real-stream",
      stdlibMode: "toolchain-stdlib",
    }).validationFixturePacketSource,
  ).toEqual({
    primitiveId: "uefi.validation.fixturePacketSource",
    feature: "full-image-validation-fixture",
    stableKey:
      "full-image-validation:packet-counter-real-stream:toolchain-stdlib:fixture-packet-source",
    bytes: [0x01, 0x02, 0x03, 0x41, 0x42],
  });

  expect(
    fixtureSpecForFullImageCase({
      scenario: "smoke-console",
      stdlibMode: "toolchain-stdlib",
    }),
  ).toMatchObject({
    packageStdlibMode: "toolchain",
    expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    enabledTargetFeatures: [],
  });
  expect(
    fixtureSpecForFullImageCase({
      scenario: "status-error",
      stdlibMode: "toolchain-stdlib",
    }).expectedStatus,
  ).toBe("bad_buffer_size");
  expect(
    fixtureSpecForFullImageCase({
      scenario: "watchdog-or-boot-policy",
      stdlibMode: "toolchain-stdlib",
    }).expectedPrimitive,
  ).toBe("set_watchdog_timer");
});

test("package input loader uses the fixture project helper with injected filesystem effects", () => {
  const spec = fixtureSpecForFullImageCase({
    scenario: "smoke-console",
    stdlibMode: "toolchain-stdlib",
  });
  const reads: string[] = [];
  const filesystem = fakeFixtureFilesystem({
    [`${spec.fixtureProjectPath}/src`]: ["image.wr", "ignore.txt"],
    "stdlib/wrela-std": ["console.wr"],
    [`${spec.fixtureProjectPath}/src/image.wr`]: "export image",
    "stdlib/wrela-std/console.wr": "export console",
  });

  const result = packageInputForFullImageFixture(spec, filesystem);

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected package input loader to succeed");
  expect(result.value).toEqual({
    packageKey: spec.packageKey,
    sourceRoots: defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" }),
    sourceFiles: [
      {
        sourceKey: "src/image.wr",
        moduleName: "image",
        text: "export image",
      },
      {
        sourceKey: "stdlib/wrela-std/console.wr",
        moduleName: "wrela_std.console",
        text: "export console",
      },
    ],
    entryModuleName: "image",
    enabledTargetFeatures: [],
  });
  expect(reads).toEqual([`${spec.fixtureProjectPath}/src/image.wr`, "stdlib/wrela-std/console.wr"]);

  function fakeFixtureFilesystem(
    entries: Record<string, readonly string[] | string>,
  ): Parameters<typeof packageInputForFullImageFixture>[1] {
    return {
      readDirectory: (path) => {
        const entry = entries[path];
        return Array.isArray(entry) ? entry : [];
      },
      isDirectory: (path) => Array.isArray(entries[path]),
      readTextFile: (path) => {
        reads.push(path);
        const entry = entries[path];
        if (typeof entry !== "string") throw new Error(`missing text fixture ${path}`);
        return entry;
      },
      realPath: (path) => path,
    };
  }
});

test("package input loader maps ejected and direct platform stdlib modes exactly", () => {
  const ejectedSpec = fixtureSpecForFullImageCase({
    scenario: "smoke-console",
    stdlibMode: "ejected-stdlib",
  });
  const directSpec = fixtureSpecForFullImageCase({
    scenario: "smoke-console",
    stdlibMode: "direct-platform",
  });

  const ejectedResult = packageInputForFullImageFixture(ejectedSpec, emptyFilesystem());
  const directResult = packageInputForFullImageFixture(directSpec, emptyFilesystem());

  expect(ejectedResult.kind).toBe("ok");
  if (ejectedResult.kind !== "ok") throw new Error("expected ejected fixture input to succeed");
  expect(directResult.kind).toBe("ok");
  if (directResult.kind !== "ok") throw new Error("expected direct fixture input to succeed");

  expect(ejectedResult.value).toMatchObject({
    sourceRoots: defaultUefiAArch64SourceRoots({
      projectSourceRoot: "src",
      stdlibMode: "project-ejected",
    }),
  });
  expect(directResult.value).toMatchObject({
    sourceRoots: defaultUefiAArch64SourceRoots({
      projectSourceRoot: "src",
      stdlibMode: "none",
    }),
  });
});

function emptyFilesystem(): Parameters<typeof packageInputForFullImageFixture>[1] {
  return {
    readDirectory: () => [],
    isDirectory: () => false,
    readTextFile: () => "",
    realPath: (path) => path,
  };
}
