import { describe, expect, test } from "bun:test";

import { createPeByteWriter, planPeCoffSections } from "../../../src/pe-coff";
import {
  linkedImageLayoutForPeCoffTest,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";

describe("W7-02a PE byte writer typed-array pipeline", () => {
  test("returns Uint8Array snapshots without changing byte content", () => {
    const writer = createPeByteWriter();

    expect(writer.writeU8(0x4d).kind).toBe("ok");
    expect(writer.writeU8(0x5a).kind).toBe("ok");

    const bytes = writer.bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([0x4d, 0x5a]);
  });

  test("PE section planning preserves Uint8Array section bytes", () => {
    const layout = linkedImageLayoutForPeCoffTest();
    const result = planPeCoffSections({
      target: writerTargetForTest(),
      layout,
      baseRelocationTableBytes: Uint8Array.of(1, 2),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sections[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect(result.value.sections.at(-1)!.bytes).toBeInstanceOf(Uint8Array);
    expect([...result.value.sections[0]!.bytes]).toEqual([...layout.sections[0]!.bytes]);
    expect([...result.value.sections.at(-1)!.bytes]).toEqual([1, 2]);
  });
});
