import { describe, expect, test } from "bun:test";

import {
  applyFactTransferRule,
  copyFactTransferRule,
  identityFactTransferRule,
  invalidateFactTransferRule,
  moveFactTransferRule,
  rederiveFromCatalogFactTransferRule,
  rejectFactTransferRule,
  splitFactTransferRule,
  weakenFactTransferRule,
} from "../../../../src/shared/facts";

const subject = { kind: "value", stableKey: "v0" } as const;
const rewritten = { kind: "value", stableKey: "v1" } as const;
const payload = { label: "secret" } as const;

describe("fact transfer rules", () => {
  test.each([
    ["identity", identityFactTransferRule()],
    ["move", moveFactTransferRule()],
    ["split", splitFactTransferRule()],
    ["copy", copyFactTransferRule()],
    ["weaken", weakenFactTransferRule({ strength: "conservative" })],
    ["invalidate", invalidateFactTransferRule({ reason: "deleted-subject" })],
    ["rederive-from-catalog", rederiveFromCatalogFactTransferRule({ catalogKey: "ct.movz" })],
  ] as const)("applies %s transfer behavior", (behavior, rule) => {
    const result = applyFactTransferRule(rule, {
      extensionKey: "security.no-spill",
      rewriteKind: "rewrite",
      subject,
      rewrittenSubjects: [rewritten],
      payload,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(`expected ${behavior} transfer`);
    expect(result.transfer.behavior).toBe(behavior);
  });

  test("reject behavior returns deterministic diagnostics", () => {
    const result = applyFactTransferRule(rejectFactTransferRule({ reason: "no-spill" }), {
      extensionKey: "security.no-spill",
      rewriteKind: "spill-insertion",
      subject,
      rewrittenSubjects: [rewritten],
      payload,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected rejected transfer");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "fact-transfer:rejected:security.no-spill:spill-insertion:value:v0:no-spill",
    ]);
  });
});
