import { describe, expect, test } from "bun:test";

import { relaxAArch64Branches } from "../../../../../src/target/aarch64/backend/object/branch-relaxation";

describe("AArch64 branch relaxation", () => {
  test("keeps signed scaled branch ranges asymmetric at their boundaries", () => {
    const result = relaxAArch64Branches({
      branches: [
        {
          stableKey: "b:negative-limit",
          sectionKey: ".text",
          targetKey: "near",
          kind: "b",
          distanceBytes: -128 * 1024 * 1024,
        },
        {
          stableKey: "b:positive-limit-minus-4",
          sectionKey: ".text",
          targetKey: "near",
          kind: "b",
          distanceBytes: 128 * 1024 * 1024 - 4,
        },
        {
          stableKey: "b.eq:negative-limit",
          sectionKey: ".text",
          targetKey: "near",
          kind: "b-cond",
          distanceBytes: -1024 * 1024,
        },
        {
          stableKey: "b.eq:positive-limit-minus-4",
          sectionKey: ".text",
          targetKey: "near",
          kind: "b-cond",
          distanceBytes: 1024 * 1024 - 4,
        },
        {
          stableKey: "tbz:negative-limit",
          sectionKey: ".text",
          targetKey: "near",
          kind: "tbz",
          distanceBytes: -32 * 1024,
        },
        {
          stableKey: "tbz:positive-limit-minus-4",
          sectionKey: ".text",
          targetKey: "near",
          kind: "tbz",
          distanceBytes: 32 * 1024 - 4,
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected branch decisions");
    expect(result.value.map((decision) => decision.state)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });

  test("expands or exhausts branches at the unreachable positive symmetric limit", () => {
    const result = relaxAArch64Branches({
      branches: [
        {
          stableKey: "b:positive-limit",
          sectionKey: ".text",
          targetKey: "far",
          kind: "b",
          distanceBytes: 128 * 1024 * 1024,
          veneerPolicy: "none",
        },
        {
          stableKey: "b.eq:positive-limit",
          sectionKey: ".text",
          targetKey: "far",
          kind: "b-cond",
          distanceBytes: 1024 * 1024,
        },
        {
          stableKey: "tbz:positive-limit",
          sectionKey: ".text",
          targetKey: "far",
          kind: "tbz",
          distanceBytes: 32 * 1024,
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected branch26 range exhaustion");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "branch-relaxation:range-exhausted:b:b:positive-limit:section:.text:target:far",
    ]);
  });

  test("widens out-of-range conditional branches monotonically", () => {
    const result = relaxAArch64Branches({
      branches: [
        {
          stableKey: "b.eq:1",
          sectionKey: ".text",
          targetKey: "far",
          kind: "b-cond",
          distanceBytes: 2_000_000,
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected branch decision");
    expect(result.value.map((decision) => decision.state)).toEqual(["expanded-invert-and-b"]);
    expect(
      relaxAArch64Branches({
        branches: [
          {
            stableKey: "b.eq:1",
            sectionKey: ".text",
            targetKey: "near",
            kind: "b-cond",
            distanceBytes: 4,
            previousState: result.value[0]!.state,
          },
        ],
      }),
    ).toMatchObject({ kind: "ok", value: [{ state: "expanded-invert-and-b" }] });
  });

  test("emits finite range exhaustion when no growth state remains", () => {
    const result = relaxAArch64Branches({
      branches: [
        {
          stableKey: "b:too_far",
          sectionKey: ".text",
          targetKey: "far_target",
          kind: "b",
          distanceBytes: 200_000_000,
          veneerPolicy: "none",
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected range exhaustion");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "branch-relaxation:range-exhausted:b:b:too_far:section:.text:target:far_target",
    ]);
  });

  test("expanded conditional and test branches must still fit branch26 reach", () => {
    const result = relaxAArch64Branches({
      branches: [
        {
          stableKey: "b.eq:too_far",
          sectionKey: ".text",
          targetKey: "far_cond",
          kind: "b-cond",
          distanceBytes: 200_000_000,
        },
        {
          stableKey: "tbz:too_far",
          sectionKey: ".text",
          targetKey: "far_test",
          kind: "tbz",
          distanceBytes: 200_000_000,
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected expanded range exhaustion");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "branch-relaxation:range-exhausted:b-cond:b.eq:too_far:section:.text:target:far_cond",
      "branch-relaxation:range-exhausted:tbz:tbz:too_far:section:.text:target:far_test",
    ]);
  });

  test("sticky expanded branches become exhausted if later growth exceeds branch26 reach", () => {
    const result = relaxAArch64Branches({
      branches: [
        {
          stableKey: "b.eq:grew_too_far",
          sectionKey: ".text",
          targetKey: "far_cond",
          kind: "b-cond",
          distanceBytes: 200_000_000,
          previousState: "expanded-invert-and-b",
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected sticky expanded range exhaustion");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "branch-relaxation:range-exhausted:b-cond:b.eq:grew_too_far:section:.text:target:far_cond",
    ]);
  });
});
