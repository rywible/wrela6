import { describe, expect, test } from "bun:test";
import { collectMonoInvariantDiagnostics } from "../../../src/layout/mono-invariant-checker";
import { monoProgramWithSourceLayoutResolutions } from "../../support/layout/layout-fixtures";

describe("collectMonoInvariantDiagnostics", () => {
  test("well-formed mono image reports no mono invariant violations", () => {
    const program = monoProgramWithSourceLayoutResolutions();
    const diagnostics = collectMonoInvariantDiagnostics(program);
    expect(diagnostics).toHaveLength(0);
  });
});
