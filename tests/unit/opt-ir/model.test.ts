import { describe, expect, test } from "bun:test";
import {
  optIrAddressType,
  optIrBooleanType,
  optIrNeverType,
  optIrPointerType,
  optIrSignedIntegerType,
  optIrTypesEqual,
  optIrUnitType,
  optIrUnsignedIntegerType,
  optIrZeroSizedType,
} from "../../../src/opt-ir/types";
import {
  optIrIntegerConstant,
  optIrConstantPool,
  optIrConstantStableKey,
} from "../../../src/opt-ir/constants";
import { optIrConstantId, optIrOriginId, optIrValueId } from "../../../src/opt-ir/ids";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { optIrScalarTypeForTest } from "../../support/opt-ir/types-fakes";

describe("OptIR scalar type model", () => {
  test("scalar types cover booleans, integers, abstract addresses, never, unit, and zero-sized values", () => {
    expect(optIrTypesEqual(optIrBooleanType(), optIrScalarTypeForTest("bool"))).toBe(true);
    expect(optIrTypesEqual(optIrSignedIntegerType(32), optIrSignedIntegerType(64))).toBe(false);
    expect(optIrTypesEqual(optIrUnsignedIntegerType(32), optIrUnsignedIntegerType(32))).toBe(true);
    expect(optIrTypesEqual(optIrPointerType({ addressSpace: "linear" }), optIrAddressType())).toBe(
      false,
    );
    expect(optIrTypesEqual(optIrNeverType(), optIrNeverType())).toBe(true);
    expect(optIrTypesEqual(optIrUnitType(), optIrZeroSizedType("empty-struct"))).toBe(false);
  });

  test("integer scalar widths must be positive whole bits", () => {
    expect(() => optIrSignedIntegerType(0)).toThrow("integer width");
    expect(() => optIrUnsignedIntegerType(1.5)).toThrow("integer width");
  });
});

describe("OptIR value model", () => {
  test("block parameters record value ID, type, incoming role, and origin", () => {
    const type = optIrUnsignedIntegerType(16);
    const parameter = optIrBlockParameter({
      valueId: optIrValueId(7),
      type,
      incomingRole: "loopCarried",
      originId: optIrOriginId(3),
    });

    expect(parameter).toEqual({
      kind: "blockParameter",
      valueId: optIrValueId(7),
      type,
      incomingRole: "loopCarried",
      originId: optIrOriginId(3),
    });
  });
});

describe("OptIR constants", () => {
  test("integer constants expose stable keys from type and normalized value", () => {
    const constant = optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: optIrUnsignedIntegerType(16),
      normalizedValue: 65535n,
    });

    expect(optIrConstantStableKey(constant)).toBe("u16:65535");
  });

  test("constant interning includes target data-model interpretation", () => {
    const pool = optIrConstantPool();
    const type = optIrUnsignedIntegerType(16);
    const littleEndian = { pointerWidth: 64, endian: "little" } as const;
    const bigEndian = { pointerWidth: 64, endian: "big" } as const;

    const first = pool.internInteger({
      constantId: optIrConstantId(1),
      type,
      normalizedValue: 1n,
      dataModel: littleEndian,
    });
    const duplicate = pool.internInteger({
      constantId: optIrConstantId(2),
      type,
      normalizedValue: 1n,
      dataModel: littleEndian,
    });
    const differentDataModel = pool.internInteger({
      constantId: optIrConstantId(3),
      type,
      normalizedValue: 1n,
      dataModel: bigEndian,
    });

    expect(duplicate).toBe(first);
    expect(differentDataModel).not.toBe(first);
    expect(pool.constants()).toHaveLength(2);
  });
});
