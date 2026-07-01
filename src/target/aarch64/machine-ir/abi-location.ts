export type AArch64AbiLocation =
  | { readonly kind: "intReg"; readonly index: number }
  | { readonly kind: "vectorReg"; readonly index: number }
  | { readonly kind: "indirectResultPointer"; readonly index: number }
  | {
      readonly kind: "stackArg";
      readonly ordinal: number;
      readonly offsetBytes: number;
      readonly size: number;
      readonly alignment: number;
    };

export function aarch64AbiLocation(location: AArch64AbiLocation): AArch64AbiLocation {
  switch (location.kind) {
    case "intReg":
    case "vectorReg":
    case "indirectResultPointer":
      if (!Number.isInteger(location.index) || location.index < 0) {
        throw new RangeError(`${location.kind} index must be a non-negative integer.`);
      }
      return Object.freeze({ ...location });
    case "stackArg":
      if (!Number.isInteger(location.ordinal) || location.ordinal < 0) {
        throw new RangeError("stack argument ordinal must be a non-negative integer.");
      }
      if (!Number.isInteger(location.offsetBytes) || location.offsetBytes < 0) {
        throw new RangeError("stack argument offsetBytes must be a non-negative integer.");
      }
      if (!Number.isInteger(location.size) || location.size <= 0) {
        throw new RangeError("stack argument size must be positive.");
      }
      if (!Number.isInteger(location.alignment) || location.alignment <= 0) {
        throw new RangeError("stack argument alignment must be positive.");
      }
      return Object.freeze({ ...location });
  }
}

export interface AArch64AbiBinding {
  readonly valueKey: string;
  readonly location: AArch64AbiLocation;
}

export function aarch64AbiBinding(input: AArch64AbiBinding): AArch64AbiBinding {
  if (input.valueKey.length === 0) {
    throw new RangeError("ABI binding valueKey must be non-empty.");
  }
  return Object.freeze({ valueKey: input.valueKey, location: aarch64AbiLocation(input.location) });
}
