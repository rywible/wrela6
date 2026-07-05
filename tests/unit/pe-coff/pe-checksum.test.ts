import { describe, expect, test } from "bun:test";

import { computePeImageChecksum } from "../../../src/pe-coff";

describe("PE image checksum", () => {
  test("ignores the checksum field bytes while computing the image checksum", () => {
    const first = Uint8Array.from([0x4d, 0x5a, 0x11, 0x22, 0x33, 0x44, 0x90, 0x00]);
    const second = Uint8Array.from([0x4d, 0x5a, 0xaa, 0xbb, 0xcc, 0xdd, 0x90, 0x00]);

    expect(computePeImageChecksum(first, 2)).toBe(computePeImageChecksum(second, 2));
  });

  test("handles odd byte lengths as a final low-order checksum byte", () => {
    const oddBytes = Uint8Array.from([0x01, 0x02, 0x03]);
    const paddedBytes = Uint8Array.from([0x01, 0x02, 0x03, 0x00]);

    expect(computePeImageChecksum(oddBytes, 8)).toBe(computePeImageChecksum(paddedBytes, 8) - 1);
  });

  test("returns deterministic nonzero checksums for nonempty image bytes", () => {
    const bytes = Uint8Array.from([0x4d, 0x5a, 0x50, 0x45, 0x00, 0x00]);
    const checksum = computePeImageChecksum(bytes, 2);

    expect(checksum).not.toBe(0);
    expect(checksum).toBe(computePeImageChecksum(bytes, 2));
  });
});
