import { expect, test } from "bun:test";

import { defaultUefiAArch64SourceRoots } from "../../../../src/target/uefi-aarch64";
import {
  runFullImageReferenceCheckers,
  semanticPlatformReferenceChecker,
  stdlibSourceRootReferenceChecker,
} from "../../../../src/validation/full-image";
import { task20PackageInput, task20ReferenceInput } from "./reference-checkers-fixtures";

test("stdlib source-root reference rejects direct-platform packages with stdlib modules", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "direct-platform",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "platform fn output_string(message: Utf16Static) -> UefiStatus\n",
          },
          {
            sourceKey: "src/wrela-std/target/uefi/console.wr",
            moduleName: "wrela_std.target.uefi.console",
            text: "platform fn output_string(message: Utf16Static) -> UefiStatus\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "stdlib-source-root-reference",
    status: "failed",
    stableDetail: "stdlib-source-root:direct-platform:unexpected-wrela-std-modules:1",
    inputAuthority: ["source-package"],
    evidence: [
      {
        evidenceKey: "expected-source-root-shape",
        authority: "source-package",
        stableDetail: "direct-platform:project:src",
      },
      {
        evidenceKey: "wrela-std-modules",
        authority: "source-package",
        stableDetail: "wrela_std.target.uefi.console",
      },
    ],
  });
});

test("stdlib source-root reference rejects ejected stdlib packages using toolchain root", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "ejected-stdlib",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "use write_smoke_marker from wrela_std.target.uefi.console\n",
          },
          {
            sourceKey: "stdlib/wrela-std/target/uefi/console.wr",
            moduleName: "wrela_std.target.uefi.console",
            text: "platform fn output_string(message: Utf16Static) -> UefiStatus\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "stdlib-source-root-reference",
    status: "failed",
    stableDetail: "stdlib-source-root:ejected-stdlib:unexpected-toolchain-root:toolchain-wrela-std",
    inputAuthority: ["source-package"],
    evidence: [
      {
        evidenceKey: "actual-source-root-shape",
        authority: "source-package",
        stableDetail: "project:src,toolchain:stdlib/wrela-std",
      },
      {
        evidenceKey: "expected-source-root-shape",
        authority: "source-package",
        stableDetail: "ejected-stdlib:project:src,project:src/wrela-std",
      },
    ],
  });
});

test("stdlib source-root reference rejects shipped stdlib packages without toolchain stdlib root", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "toolchain-stdlib",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "use write_smoke_marker from wrela_std.target.uefi.console\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports.find((report) => report.checkerKey === "stdlib-source-root-reference")).toEqual({
    checkerKey: "stdlib-source-root-reference",
    status: "failed",
    stableDetail: "stdlib-source-root:toolchain-stdlib:missing-toolchain-stdlib-root",
    inputAuthority: ["source-package"],
    evidence: [
      {
        evidenceKey: "actual-source-root-shape",
        authority: "source-package",
        stableDetail: "project:src",
      },
      {
        evidenceKey: "expected-source-root-shape",
        authority: "source-package",
        stableDetail: "toolchain-stdlib:project:src,toolchain:stdlib/wrela-std",
      },
    ],
  });
});

test("semantic platform reference checks scenario reachable primitive ids", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      scenario: "packet-counter",
      stdlibMode: "direct-platform",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: [
              "platform fn output_string(message: Utf16Static) -> UefiStatus",
              "platform fn validation_fixture_packet_source() -> U64",
            ].join("\n"),
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "failed",
    stableDetail:
      "semantic-platform:reachable:mismatch:missing:uefi.source.bindVirtioNet,uefi.source.discoverVirtio,uefi.source.exitBootServices,uefi.source.planMachine,uefi.source.reserveRestrictedMemory,uefi.source.splitNetworkDevice,uefi.validation.fixturePacketSource",
    inputAuthority: ["compiler-trace", "source-package"],
    evidence: [
      {
        evidenceKey: "expected-reachable-primitives",
        authority: "compiler-trace",
        stableDetail:
          "uefi.console.outputString,uefi.source.bindVirtioNet,uefi.source.discoverVirtio,uefi.source.exitBootServices,uefi.source.planMachine,uefi.source.reserveRestrictedMemory,uefi.source.splitNetworkDevice,uefi.validation.fixturePacketSource",
      },
      {
        evidenceKey: "reachable-platform-primitives",
        authority: "compiler-trace",
        stableDetail: "uefi.console.outputString",
      },
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail:
          "output_string=uefi.console.outputString,validation_fixture_packet_source=uefi.validation.fixturePacketSource",
      },
    ],
  });
});

test("semantic platform reference rejects direct-platform unknown primitive declarations", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "direct-platform",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "platform fn mystery_firmware_call() -> UefiStatus\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: [],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "failed",
    stableDetail:
      "semantic-platform:direct-platform:unknown-platform-primitive:mystery_firmware_call",
    inputAuthority: ["compiler-trace", "source-package"],
    evidence: [
      {
        evidenceKey: "uefi-platform-primitive-name-catalog",
        authority: "compiler-trace",
        stableDetail:
          "exit_boot_services_with_fresh_map=uefi.boot.exitBootServices,output_string=uefi.console.outputString,set_watchdog_timer=uefi.boot.setWatchdogTimer,uefi_bind_virtio_net=uefi.source.bindVirtioNet,uefi_discover_virtio=uefi.source.discoverVirtio,uefi_exit_boot_services=uefi.source.exitBootServices,uefi_plan_machine=uefi.source.planMachine,uefi_reserve_restricted_memory=uefi.source.reserveRestrictedMemory,uefi_split_network_device=uefi.source.splitNetworkDevice,validation_fixture_packet_source=uefi.validation.fixturePacketSource",
      },
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail: "mystery_firmware_call=<unknown>",
      },
    ],
  });
});

test("semantic platform reference accepts status-error cases without reachable primitives", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      scenario: "status-error",
      stdlibMode: "toolchain-stdlib",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "use UefiStatus from wrela_std.target.uefi.status\n",
          },
          {
            sourceKey: "stdlib/wrela-std/target/uefi/status.wr",
            moduleName: "wrela_std.target.uefi.status",
            text: "enum UefiStatus:\n    success\n    bad_buffer_size\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: [],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "passed",
    stableDetail: "semantic-platform:reachable:",
    inputAuthority: ["compiler-trace", "source-package"],
    evidence: [
      {
        evidenceKey: "expected-reachable-primitives",
        authority: "compiler-trace",
        stableDetail: "",
      },
      {
        evidenceKey: "reachable-platform-primitives",
        authority: "compiler-trace",
        stableDetail: "",
      },
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail: "",
      },
    ],
  });
});

test("semantic platform reference passes for matching smoke-console source and trace metadata", () => {
  const source = task20PackageInput({
    sourceRoots: defaultUefiAArch64SourceRoots({
      projectSourceRoot: "src",
      stdlibMode: "none",
    }),
    sourceFiles: [
      {
        sourceKey: "src/image.wr",
        moduleName: "image",
        text: [
          "enum UefiStatus:",
          "    success",
          "    bad_buffer_size",
          "",
          "platform fn output_string(message: Utf16Static) -> UefiStatus",
          "",
          "uefi image SmokeConsoleImage:",
          "",
          "fn boot() -> UefiStatus:",
          '    output_string(utf16_static("WRELA_UEFI_SMOKE_OK\\r\\n"))',
        ].join("\n"),
      },
    ],
  });

  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "direct-platform",
      packageInput: source,
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "passed",
    stableDetail: "semantic-platform:reachable:uefi.console.outputString",
    inputAuthority: ["compiler-trace", "source-package"],
    evidence: [
      {
        evidenceKey: "expected-reachable-primitives",
        authority: "compiler-trace",
        stableDetail: "uefi.console.outputString",
      },
      {
        evidenceKey: "reachable-platform-primitives",
        authority: "compiler-trace",
        stableDetail: "uefi.console.outputString",
      },
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail: "output_string=uefi.console.outputString",
      },
    ],
  });
});
