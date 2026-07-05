import { describe, expect, test } from "bun:test";

import { platformPrimitiveId, type PlatformPrimitiveId } from "../../../src/semantic/ids";
import { diffUefiAArch64RuntimeHelperPrimitiveCoverage } from "../../../src/target/uefi-aarch64/binary-spine";
import type { UefiAArch64PackageOptIrPipelineOutput } from "../../../src/target/uefi-aarch64/package-pipeline-adapters";

describe("W2-07 runtime helper primitive coverage", () => {
  test("keeps reachable platform primitive IDs typed at the package output seam", () => {
    const reachablePlatformPrimitiveIds: UefiAArch64PackageOptIrPipelineOutput["reachablePlatformPrimitiveIds"] =
      [platformPrimitiveId("uefi.boot.exitBootServices")];
    const ids: readonly PlatformPrimitiveId[] = reachablePlatformPrimitiveIds;

    expect(ids.map(String)).toEqual(["uefi.boot.exitBootServices"]);
  });

  test("reports stable missing and extra runtime helper primitive coverage", () => {
    const result = diffUefiAArch64RuntimeHelperPrimitiveCoverage({
      reachablePlatformPrimitiveIds: [
        platformPrimitiveId("uefi.source.exitBootServices"),
        platformPrimitiveId("uefi.boot.exitBootServices"),
      ],
      coveredPlatformPrimitiveIds: [
        platformPrimitiveId("uefi.boot.setWatchdogTimer"),
        platformPrimitiveId("uefi.boot.exitBootServices"),
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected coverage mismatch");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "UEFI_AARCH64_PRIMITIVE_COVERAGE_MISMATCH",
      ownerKey: "runtime-helper-objects",
      stableDetail: "missing:[uefi.source.exitBootServices];extra:[uefi.boot.setWatchdogTimer]",
    });
  });
});
