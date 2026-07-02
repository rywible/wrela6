import { describe, expect, test } from "bun:test";
import { AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA } from "../../../../src/target/aarch64";
import { verifyAArch64ObjectModule } from "../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  materializeUefiAArch64StaticChar16ObjectModule,
  materializeUefiAArch64StaticChar16String,
  uefiAArch64StaticChar16StringPointer,
} from "../../../../src/target/uefi-aarch64";
import { productionUefiAArch64ResolvedTargetSurfaces } from "../../../../src/target/uefi-aarch64/target-surfaces";

describe("UEFI static CHAR16 object materialization", () => {
  test("defines certified firmware strings as read-only data symbols", () => {
    const surfaces = productionUefiAArch64ResolvedTargetSurfaces();
    expect(surfaces.kind).toBe("ok");
    if (surfaces.kind !== "ok") throw new Error("expected target surfaces");
    const staticString = materializeUefiAArch64StaticChar16String({
      stableKey: "console-marker",
      value: "OK\r\n",
    });
    expect(staticString.kind).toBe("ok");
    if (staticString.kind !== "ok") throw new Error("expected static firmware string");
    const pointer = uefiAArch64StaticChar16StringPointer(staticString.value);

    const result = materializeUefiAArch64StaticChar16ObjectModule({
      backendTarget: surfaces.value.backendTarget,
      staticChar16Strings: [staticString.value],
      staticChar16Pointers: [{ valueKey: "optir.value:1", pointer }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected static object module");
    const objectModule = result.value.modules[0]?.objectModule;
    expect(objectModule?.sections[0]?.classKey).toBe(AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA);
    expect(objectModule?.sections[0]?.bytes).toEqual([0x4f, 0, 0x4b, 0, 0x0d, 0, 0x0a, 0, 0, 0]);
    expect(objectModule?.symbols).toContainEqual(
      expect.objectContaining({
        kind: "global-definition",
        linkageName: pointer.symbolName,
        offsetBytes: 0,
      }),
    );
    expect(
      verifyAArch64ObjectModule({
        objectModule: objectModule!,
        target: surfaces.value.backendTarget,
      }).kind,
    ).toBe("ok");
  });
});
