import { describe, expect, test } from "bun:test";

import {
  createUefiAArch64TargetMetadata,
  fingerprintUefiAArch64ImageBytes,
} from "../../../src/target/uefi-aarch64/compile-uefi-aarch64-image";
import {
  authenticateUefiAArch64TargetDriverSurface,
  type UefiAArch64BinarySpineOutput,
} from "../../../src/target/uefi-aarch64";
import { uefiTargetSurfaceFixture } from "../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("W7-02d/e UEFI artifact typed-array byte boundary", () => {
  test("manual image fingerprinting iterates Uint8Array bytes", () => {
    expect(fingerprintUefiAArch64ImageBytes(Uint8Array.of(0x4d, 0x5a))).toBe(
      fingerprintUefiAArch64ImageBytes([0x4d, 0x5a]),
    );
  });

  test("target metadata accepts Uint8Array PE artifact bytes", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") throw new Error("expected target fixture");
    const metadata = createUefiAArch64TargetMetadata({
      target: target.value,
      entryThunkFingerprint: "entry",
      peCoffArtifact: {
        deterministicMetadata: { imageFingerprint: "pe:image" },
        bytes: Uint8Array.of(0x4d, 0x5a),
      } as UefiAArch64BinarySpineOutput["peCoffArtifact"],
    });

    expect(metadata.finalImageFingerprint).toBe(fingerprintUefiAArch64ImageBytes([0x4d, 0x5a]));
  });
});
