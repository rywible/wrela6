import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import {
  proofMirSummary,
  readTagWorkedExampleFixture,
  validatedBufferReadProofMirFixture,
} from "../../support/proof-mir/proof-mir-fixtures";

describe("layout fact references integration", () => {
  test("worked read-tag input keeps validated-buffer layout read requirements", () => {
    const input = readTagWorkedExampleFixture();
    const summary = JSON.parse(proofMirSummary(input));

    expect(summary.layout.validatedBuffers).toHaveLength(1);
    const layoutFields = summary.layout.validatedBuffers[0]?.layoutFields ?? [];
    expect(layoutFields.some((field: { name: string }) => field.name === "tag")).toBe(true);
    expect(
      layoutFields.some(
        (field: { name: string; readRequires: readonly unknown[] }) =>
          field.name === "tag" && field.readRequires.length > 0,
      ),
    ).toBe(true);
    expect(
      layoutFields.some(
        (field: { name: string; readRequires: readonly unknown[] }) =>
          field.name === "payload" && field.readRequires.length > 0,
      ),
    ).toBe(true);
  });

  test("read-tag worked example builds frozen Proof MIR", () => {
    const result = buildProofMir(readTagWorkedExampleFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const summary = JSON.parse(proofMirSummary(result.mir));
    const readTagFunction = summary.functions.find(
      (entry: { signature: { parameters: readonly unknown[] } }) =>
        entry.signature.parameters.length === 1,
    );
    const statements =
      readTagFunction?.blocks?.flatMap(
        (block: { statements: readonly { kind: { kind: string } }[] }) =>
          block.statements.map((statement) => statement.kind.kind),
      ) ?? [];
    expect(
      statements.includes("readValidatedBufferField") ||
        summary.layoutTerms.length > 0 ||
        summary.facts.some(
          (fact: { kind: { kind: string } }) =>
            fact.kind.kind === "layoutFits" || fact.kind.kind === "payloadEnd",
        ),
    ).toBe(true);

    expect(proofMirSummary(result.mir)).toMatchSnapshot();
  });

  test("validated-buffer image keeps layout field paths and read requirement facts", () => {
    const result = buildProofMir(validatedBufferReadProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const summary = JSON.parse(proofMirSummary(result.mir));
    const buffer = summary.layout.validatedBuffers[0];
    expect(buffer).toBeDefined();
    if (buffer === undefined) {
      return;
    }

    expect(buffer.layoutFields.map((field: { name: string }) => field.name)).toEqual([
      "tag",
      "payload",
    ]);
    expect(
      buffer.layoutFields.every(
        (field: { readRequires: readonly unknown[] }) => field.readRequires.length > 0,
      ),
    ).toBe(true);
    expect(summary.layout.fields.length + buffer.layoutFields.length).toBeGreaterThan(0);

    expect(proofMirSummary(result.mir)).toMatchSnapshot();
  });
});
