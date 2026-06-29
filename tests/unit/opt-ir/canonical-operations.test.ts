import { describe, expect, test } from "bun:test";
import {
  lowerCanonicalOperationsForTest,
  type CanonicalOperationInputForTest,
} from "../../../src/opt-ir/lower/canonical-operations";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import { optIrEdgeId, optIrOriginId, optIrValueId } from "../../../src/opt-ir/ids";
import {
  optIrBooleanType,
  optIrSignedIntegerType,
  optIrUnsignedIntegerType,
} from "../../../src/opt-ir/types";
import { layoutFactKey } from "../../../src/proof-check/model/fact-packet";

const integer32 = optIrSignedIntegerType(32);
const byte = optIrUnsignedIntegerType(8);

function lower(operations: CanonicalOperationInputForTest[]) {
  return lowerCanonicalOperationsForTest({
    dataModel: { pointerWidth: 64, endian: "little" },
    operations,
  });
}

describe("OptIR canonical operation lowering", () => {
  test("interns constants by type, normalized value, and data model", () => {
    const result = lower([
      {
        kind: "constant",
        output: optIrValueId(10),
        type: integer32,
        value: "007",
        originId: optIrOriginId(1),
      },
      {
        kind: "constant",
        output: optIrValueId(11),
        type: integer32,
        value: 7n,
        originId: optIrOriginId(2),
      },
      {
        kind: "constant",
        output: optIrValueId(12),
        type: byte,
        value: 7,
        originId: optIrOriginId(3),
      },
    ]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.constants).toHaveLength(2);
    expect(result.operations.map((operation) => operation.kind)).toEqual([
      "constant",
      "constant",
      "constant",
    ]);
    expect(result.operations[0]?.kind).toBe("constant");
    expect(result.operations[1]?.kind).toBe("constant");
    if (result.operations[0]?.kind === "constant" && result.operations[1]?.kind === "constant") {
      expect(result.operations[0].constant.constantId).toBe(
        result.operations[1].constant.constantId,
      );
      expect(result.operations[0].constant.normalizedValue).toBe(7n);
    }
  });

  test("lowers field projections to layout paths, offsets, extracts, and inserts", () => {
    const result = lower([
      {
        kind: "fieldProjection",
        aggregate: optIrValueId(1),
        output: optIrValueId(2),
        resultType: integer32,
        fieldPath: ["header", "length"],
        layoutPath: layoutFactKey("packet.header.length"),
        byteOffset: 12n,
        originId: optIrOriginId(4),
      },
      {
        kind: "fieldInsert",
        aggregate: optIrValueId(3),
        field: optIrValueId(4),
        output: optIrValueId(5),
        resultType: integer32,
        fieldPath: ["header", "checksum"],
        originId: optIrOriginId(5),
      },
    ]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.operations.map((operation) => operation.kind)).toEqual([
      "layoutOffset",
      "aggregateExtract",
      "aggregateInsert",
    ]);
    expect(result.layoutPaths).toEqual([
      {
        fieldPath: ["header", "length"],
        layoutPath: layoutFactKey("packet.header.length"),
        byteOffset: 12n,
      },
    ]);
    expect(Object.isFrozen(result.layoutPaths[0])).toBe(true);
    expect(Object.isFrozen(result.layoutPaths[0]?.fieldPath)).toBe(true);
  });

  test("lowers enum construction and matching to tag constants, extracts, and switches", () => {
    const result = lower([
      {
        kind: "enumConstruct",
        output: optIrValueId(20),
        enumType: integer32,
        tagType: byte,
        tagValue: 2,
        payloads: [optIrValueId(21)],
        originId: optIrOriginId(6),
      },
      {
        kind: "enumMatch",
        enumValue: optIrValueId(20),
        tagOutput: optIrValueId(22),
        tagType: byte,
        cases: [
          { label: "0", edge: optIrEdgeId(1) },
          { label: "2", edge: optIrEdgeId(2) },
        ],
        defaultEdge: optIrEdgeId(3),
        originId: optIrOriginId(7),
      },
    ]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.operations.map((operation) => operation.kind)).toEqual([
      "constant",
      "aggregateConstruct",
      "aggregateExtract",
    ]);
    expect(result.terminators).toEqual([
      {
        kind: "switch",
        operationId: expect.any(Number),
        scrutinee: optIrValueId(22),
        cases: [
          { label: "0", edge: optIrEdgeId(1) },
          { label: "2", edge: optIrEdgeId(2) },
        ],
        defaultEdge: optIrEdgeId(3),
        originId: optIrOriginId(7),
      },
    ]);
  });

  test("lowers branches with canonical boolean conditions and edge ids", () => {
    const result = lower([
      {
        kind: "branch",
        condition: optIrValueId(30),
        conditionType: optIrBooleanType(),
        trueEdge: optIrEdgeId(10),
        falseEdge: optIrEdgeId(11),
        originId: optIrOriginId(8),
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        kind: "ok",
        terminators: [
          expect.objectContaining({
            kind: "branch",
            condition: optIrValueId(30),
            trueEdge: optIrEdgeId(10),
            falseEdge: optIrEdgeId(11),
          }),
        ],
      }),
    );
  });

  test("lowers terminal exits distinctly from traps, panics, and unreachable", () => {
    const result = lower([
      {
        kind: "terminalExit",
        terminalKind: "terminalCall",
        target: "runtime.exit",
        arguments: [optIrValueId(40)],
        originId: optIrOriginId(9),
      },
      {
        kind: "terminalExit",
        terminalKind: "trap",
        reason: "bad-tag",
        originId: optIrOriginId(10),
      },
      {
        kind: "terminalExit",
        terminalKind: "panic",
        reason: "overflow",
        originId: optIrOriginId(11),
      },
      { kind: "terminalExit", terminalKind: "unreachable", originId: optIrOriginId(12) },
    ]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.terminators.map((terminator) => terminator.kind)).toEqual([
      "terminalCall",
      "trap",
      "panic",
      "unreachable",
    ]);
    for (const terminator of result.terminators) {
      expect(Object.isFrozen(terminator)).toBe(true);
    }
    const terminalCall = result.terminators[0];
    expect(terminalCall?.kind).toBe("terminalCall");
    if (terminalCall?.kind === "terminalCall") {
      expect(Object.isFrozen(terminalCall.arguments)).toBe(true);
    }
  });

  test("returns construction diagnostics for unsupported reachable checked MIR operations", () => {
    const result = lower([
      {
        kind: "unsupported",
        operationName: "borrowed-generator-yield",
        reachable: true,
        originId: optIrOriginId(13),
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        kind: "error",
        diagnostics: [
          expect.objectContaining({
            code: optIrDiagnosticCode("OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION"),
            originId: optIrOriginId(13),
            arguments: expect.objectContaining({ operationName: "borrowed-generator-yield" }),
          }),
        ],
      }),
    );
  });
});
