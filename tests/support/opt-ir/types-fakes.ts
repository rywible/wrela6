import {
  optIrAddressType,
  optIrBooleanType,
  optIrNeverType,
  optIrSignedIntegerType,
  optIrUnitType,
  optIrUnsignedIntegerType,
  optIrZeroSizedType,
  type OptIrScalarType,
} from "../../../src/opt-ir/types";

export function optIrScalarTypeForTest(
  kind: "bool" | "i32" | "u32" | "address" | "never" | "unit" | "zst" = "i32",
): OptIrScalarType {
  switch (kind) {
    case "bool":
      return optIrBooleanType();
    case "i32":
      return optIrSignedIntegerType(32);
    case "u32":
      return optIrUnsignedIntegerType(32);
    case "address":
      return optIrAddressType();
    case "never":
      return optIrNeverType();
    case "unit":
      return optIrUnitType();
    case "zst":
      return optIrZeroSizedType("test-zero-sized");
  }
}
