import { expect, test } from "bun:test";
import { hirDiagnosticCode } from "../../../src/hir/diagnostics";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";

test("validated buffer lowering preserves field roles", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      "validated buffer Packet:\n    params:\n        bytes: Bytes\n    layout:\n        kind: U8 @ 0\n",
    ],
  ]);

  const buffer = result.program.validatedBuffers.entries()[0]!;
  expect(buffer.parameterFields).toHaveLength(1);
  expect(buffer.layoutFields).toHaveLength(1);
});

test("validated buffer lowering preserves declaration requirements", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      "validated buffer Packet:\n    params:\n        bytes: u32\n    require:\n        bytes > 0\n",
    ],
  ]);

  const buffer = result.program.validatedBuffers.entries()[0]!;
  expect(buffer.requirements).toHaveLength(1);
  expect(buffer.requirements[0]!.expression).toEqual({ kind: "opaque", text: "bytes > 0" });
});

test("HIR preserves validated-buffer layout offset length and wire encoding", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    params:",
        "        expected_len: u16",
        "    layout:",
        "        payload: u8 @ 3 len expected_len",
      ].join("\n"),
    ],
  ]);
  const buffer = result.program.validatedBuffers.entries()[0]!;
  const payload = buffer.layoutFields[0]!;

  expect(payload.field.name).toBe("payload");
  expect(payload.offset.kind).toBe("integerLiteral");
  expect(payload.offset.kind === "integerLiteral" ? payload.offset.value : undefined).toBe(3n);
  expect(payload.length?.kind).toBe("fieldValue");
  expect(payload.length?.kind === "fieldValue" ? payload.length.fieldKind : undefined).toBe(
    "parameter",
  );
  expect(payload.layoutWireEndian).toBeUndefined();
});

test("HIR preserves source.len layout expression", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    params:",
        "        expected_len: u16",
        "    layout:",
        "        payload: u8 @ 0 len source.len",
      ].join("\n"),
    ],
  ]);
  const buffer = result.program.validatedBuffers.entries()[0]!;
  const payload = buffer.layoutFields[0]!;

  expect(payload.length?.kind).toBe("sourceLength");
});

test("HIR preserves layout arithmetic expression", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      ["validated buffer Packet:", "    layout:", "        payload: u8 @ 1 + 2"].join("\n"),
    ],
  ]);
  const buffer = result.program.validatedBuffers.entries()[0]!;
  const payload = buffer.layoutFields[0]!;

  expect(payload.offset.kind).toBe("add");
  if (payload.offset.kind === "add") {
    expect(payload.offset.left.kind).toBe("integerLiteral");
    expect(payload.offset.right.kind).toBe("integerLiteral");
  }
});

test("unsupported layout expression emits HIR_UNSUPPORTED_LAYOUT_EXPRESSION", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      ["validated buffer Packet:", "    layout:", "        payload: u8 @ ready()"].join("\n"),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    hirDiagnosticCode("HIR_UNSUPPORTED_LAYOUT_EXPRESSION"),
  );
});

test("HIR preserves derived field cases in source order", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    params:",
        "        kind: u8",
        "    layout:",
        "        kind: u8 @ 0",
        "    derive:",
        "        version: u8 from kind:",
        "            0 => 1",
        "            otherwise => 2",
      ].join("\n"),
    ],
  ]);
  const buffer = result.program.validatedBuffers.entries()[0]!;
  const version = buffer.derivedFields[0]!;

  expect(version.field.name).toBe("version");
  expect(version.source.kind).toBe("fieldValue");
  expect(version.cases).toHaveLength(2);
  expect(version.cases[0]?.condition.kind).toBe("integerLiteral");
  expect(version.cases[1]?.condition).toEqual({ kind: "otherwise" });
  expect(version.cases[0]?.result.kind).toBe("integerLiteral");
  expect(version.cases[1]?.result.kind).toBe("integerLiteral");
});

test("HIR lowers enum case derived-field results to discriminant literals", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "enum PacketKind:",
        "    count",
        "    ignored",
        "validated buffer Packet:",
        "    layout:",
        "        kind_byte: u8 @ 0",
        "    derive:",
        "        kind: PacketKind from kind_byte:",
        "            1 => PacketKind.count",
        "            otherwise => PacketKind.ignored",
      ].join("\n"),
    ],
  ]);
  const buffer = result.program.validatedBuffers.entries()[0]!;
  const kind = buffer.derivedFields[0]!;

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    hirDiagnosticCode("HIR_UNSUPPORTED_LAYOUT_EXPRESSION"),
  );
  expect(kind.cases[0]?.result).toMatchObject({ kind: "integerLiteral", value: 0n });
  expect(kind.cases[1]?.result).toMatchObject({ kind: "integerLiteral", value: 1n });
});

test("layout field can reference an earlier derived field", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    derive:",
        "        count: u32 from 0:",
        "            otherwise => 4",
        "    layout:",
        "        payload: u8 @ 0 len count",
      ].join("\n"),
    ],
  ]);
  const buffer = result.program.validatedBuffers.entries()[0]!;
  const payload = buffer.layoutFields[0]!;

  expect(payload.field.name).toBe("payload");
  expect(payload.length?.kind).toBe("fieldValue");
  expect(payload.length?.kind === "fieldValue" ? payload.length.fieldKind : undefined).toBe(
    "derived",
  );
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    hirDiagnosticCode("HIR_UNSUPPORTED_LAYOUT_EXPRESSION"),
  );
});
