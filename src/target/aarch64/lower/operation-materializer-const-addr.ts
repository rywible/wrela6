import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import type { OperationOf } from "./operation-materialization-helpers";

type ConstAddrMaterializationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly stableDetail: string };

export interface AArch64StaticReadonlyPointer {
  readonly symbolName: string;
  readonly stableKey: string;
  readonly fingerprint: string;
  readonly label: string;
}

export interface AArch64ConstAddrMaterializationInput {
  readonly operation: OperationOf<"constAddr">;
  readonly staticReadonlyPointers?: ReadonlyMap<
    OperationOf<"constAddr">["constantId"],
    AArch64StaticReadonlyPointer
  >;
  readonly resultRegister: (
    operation: OperationOf<"constAddr">,
    index: number,
  ) => AArch64VirtualRegister;
  readonly materializeStaticReadonlyPointer: (
    input: AArch64StaticReadonlyPointer,
  ) => AArch64VirtualRegister;
  readonly emitCopy: (
    output: AArch64VirtualRegister,
    input: AArch64VirtualRegister,
    label: string,
  ) => { readonly kind: "ok" } | { readonly kind: "error" };
  readonly recordExplanation: (message: string) => void;
}

export function materializeAArch64ConstAddrOperation(
  input: AArch64ConstAddrMaterializationInput,
): ConstAddrMaterializationResult {
  const { operation } = input;
  const resultId = operation.resultIds[0];
  if (resultId === undefined) {
    return {
      kind: "error",
      stableDetail: `const-addr:missing-result:${String(operation.operationId)}`,
    };
  }
  const pointer = input.staticReadonlyPointers?.get(operation.constantId);
  if (pointer === undefined) {
    return {
      kind: "error",
      stableDetail: `const-addr:missing-static-readonly-pointer:${String(operation.operationId)}:${String(operation.constantId)}`,
    };
  }

  const output = input.resultRegister(operation, 0);
  const pointerRegister = input.materializeStaticReadonlyPointer({
    symbolName: pointer.symbolName,
    stableKey: pointer.stableKey,
    fingerprint: pointer.fingerprint,
    label: pointer.label,
  });
  const copied = input.emitCopy(output, pointerRegister, `const-addr:${pointer.stableKey}`);
  if (copied.kind === "error") {
    return {
      kind: "error",
      stableDetail: `const-addr:invalid-result-register:${String(operation.operationId)}:optir.value:${String(resultId)}`,
    };
  }
  input.recordExplanation(
    `const-addr:static-readonly-pointer:${String(operation.constantId)}:${pointer.stableKey}`,
  );
  return { kind: "ok" };
}
