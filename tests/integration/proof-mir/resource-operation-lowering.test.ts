import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import {
  resourceOperationProofMirFixture,
  terminalResourceProofMirFixture,
} from "../../support/proof-mir/integration-fixtures";
import { proofMirSummary } from "../../support/proof-mir/proof-mir-fixtures";

describe("buildProofMir resource operation lowering", () => {
  test("resource operations keep load, store, and take evidence explicit", () => {
    const result = buildProofMir(resourceOperationProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"load"');
    expect(summary).toContain('"kind":"movePlace"');
    expect(summary).toContain('"kind":"store"');
    expect(summary).toContain('"kind":"take"');
    expect(summary).toContain('"kind":"openSessionMember"');
    expect(summary).toContain('"kind":"openObligation"');
    expect(summary).toContain('"kind":"take"');
    expect(summary).toContain('"kind":"dischargeObligation"');
    expect(summary).toContain('"kind":"closeSessionMember"');
    expect(summary).toContain('"kind":"scopeExit"');
    expect(summary).toMatchSnapshot();
  });

  test("terminal resource exit keeps function-exit closure with required terminal reachability", () => {
    const result = buildProofMir(terminalResourceProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"terminalReturn"');
    expect(summary).toContain('"terminalReachability":"required"');
    expect(summary).toMatchSnapshot();
  });
});
