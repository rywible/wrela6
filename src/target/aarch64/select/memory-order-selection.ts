import type { AArch64MemoryOrder } from "../machine-ir/memory-order";

export function selectAArch64LseSuffix(input: {
  readonly operation: "ldadd" | "swp" | "cas";
  readonly order: AArch64MemoryOrder;
}): "" | "a" | "l" | "al" {
  switch (input.order) {
    case "acquire":
      return "a";
    case "release":
      return "l";
    case "acquireRelease":
    case "sequentiallyConsistent":
      return "al";
    case "relaxed":
    case "deviceOrdered":
    case "compilerOnlyOrdered":
      return "";
  }
}
