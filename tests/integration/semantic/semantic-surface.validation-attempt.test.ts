import { expect, test } from "bun:test";
import {
  checkSemanticSurfaceForTest,
  primitiveSpecFake,
  semanticTargetSurfaceFake,
} from "../../support/semantic/semantic-surface-fakes";
import { coreTypeId, typeId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";

test("real checker emits no validation or attempt contracts from ambiguous source shapes", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      "validated buffer Packet:\n    params:\n        size: u8\nfn validate(consume packet: Packet) -> u32\n",
    ],
  ]);

  expect(result.program.proofSurface.validationContracts.entries()).toEqual([]);
  expect(result.program.proofSurface.attemptContracts.entries()).toEqual([]);
});

test("real checker emits validation contracts from explicit source validation signatures", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "wrela_std/core.wr",
      [
        "class Validation[Ok, Err, Source]:",
        "class RawBuffer:",
        "validated buffer Packet:",
        "    params:",
        "        size: u8",
        "fn validate(source: RawBuffer) -> Validation[Packet, u32, RawBuffer]",
      ].join("\n"),
    ],
    ["main.wr", ["uefi image Boot:", "    fn main() -> Never"].join("\n")],
  ]);

  const contracts = result.program.proofSurface.validationContracts.entries();

  expect(result.diagnostics).toEqual([]);
  expect(contracts).toHaveLength(1);
  expect(contracts[0]!.sourceParameterId).toBeDefined();
  expect(contracts[0]!.okPayloadType.kind).toBe("source");
  if (contracts[0]!.okPayloadType.kind !== "source") {
    throw new Error("expected source ok payload");
  }
  expect(contracts[0]!.validatedBufferTypeId).toBe(contracts[0]!.okPayloadType.typeId);
});

test("real checker emits attempt contracts from explicit source attempt input metadata", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "wrela_std/core.wr",
      [
        "class Attempt[Ok, Err, Input]:",
        "class Buffer:",
        "fn fallible(input: Buffer) -> Attempt[bool, u32, Buffer]",
      ].join("\n"),
    ],
    ["main.wr", ["uefi image Boot:", "    fn main() -> Never"].join("\n")],
  ]);

  const fallible = result.program.functions.entries()[0]!;
  const contracts = result.program.proofSurface.attemptContracts.get(fallible.functionId);

  expect(result.diagnostics).toEqual([]);
  expect(contracts).toHaveLength(1);
  expect(contracts[0]!.inputs).toEqual([
    { kind: "parameter", parameterId: fallible.parameters[0]!.parameterId },
  ]);
});

test("real checker emits attempt contracts from source Result methods with proof-relevant receivers", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "wrela_std/core.wr",
      [
        "class Result[Ok, Err]:",
        "private class Firmware:",
        "    fn discover(self) -> Result[bool, u32]",
      ].join("\n"),
    ],
    ["main.wr", ["uefi image Boot:", "    fn main() -> Never"].join("\n")],
  ]);

  const discover = result.program.functions.entries().find((func) => func.receiver !== undefined);
  expect(discover).toBeDefined();
  if (discover === undefined) return;
  const contracts = result.program.proofSurface.attemptContracts.get(discover.functionId);

  expect(result.diagnostics).toEqual([]);
  expect(contracts).toHaveLength(1);
  expect(contracts[0]!.inputs).toEqual([{ kind: "receiver" }]);
});

test("real checker leaves copy-only Result functions out of capability attempt contracts", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      [
        "class Result[Ok, Err]:",
        "fn parse_copy(value: u32) -> Result[bool, u32]",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  const parseCopy = result.program.functions
    .entries()
    .find((func) => func.returnType.kind === "applied");
  expect(parseCopy).toBeDefined();
  if (parseCopy === undefined) return;

  expect(result.diagnostics).toEqual([]);
  expect(result.program.proofSurface.attemptContracts.get(parseCopy.functionId)).toEqual([]);
});

test("real checker emits validation and attempt contracts from exact target platform contracts", () => {
  const u32Type = coreCheckedType(coreTypeId("u32"));
  const boolType = coreCheckedType(coreTypeId("bool"));
  const targetSurface = semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "validate",
        signature: {
          genericArity: 0,
          receiver: undefined,
          parameters: [{ type: u32Type, mode: "observe", resourceKind: concreteKind("Copy") }],
          returnType: u32Type,
          returnKind: concreteKind("Copy"),
          requiredModifiers: ["platform"],
          forbiddenModifiers: [],
        },
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [],
          validationContracts: [
            {
              validatedBufferTypeId: typeId(77),
              resultType: u32Type,
              sourceType: u32Type,
              okPayloadType: u32Type,
              errPayloadType: boolType,
              sourceParameterIndex: 0,
            },
          ],
          attemptContracts: [
            {
              resultType: u32Type,
              okType: u32Type,
              errType: boolType,
              inputs: [{ kind: "parameter", parameterIndex: 0 }],
            },
          ],
        },
      }),
    ],
  });
  const result = checkSemanticSurfaceForTest(
    [
      [
        "main.wr",
        "platform fn validate(raw: u32) -> u32\nuefi image Boot:\n    fn main() -> Never\n",
      ],
    ],
    {
      platformNames: ["validate"],
      targetSurface,
    },
  );

  const contracts = result.program.proofSurface.validationContracts.entries();
  expect(result.diagnostics).toEqual([]);
  expect(contracts).toHaveLength(1);
  expect(contracts[0]!.sourceParameterId).toBeDefined();
  expect(contracts[0]!.sourceType).toEqual(coreCheckedType(coreTypeId("u32")));
  const functionIdValue = result.program.functions.entries()[0]!.functionId;
  const attemptContracts = result.program.proofSurface.attemptContracts.get(functionIdValue);
  expect(attemptContracts).toHaveLength(1);
  expect(attemptContracts[0]!.inputs).toEqual([
    {
      kind: "parameter",
      parameterId: result.program.functions.entries()[0]!.parameters[0]!.parameterId,
    },
  ]);
});
