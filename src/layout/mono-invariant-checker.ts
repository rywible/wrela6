import { canonicalTypeInstanceId } from "../mono/instantiation-key";
import type { MonoInstanceId } from "../mono/ids";
import type { MonomorphizedHirProgram } from "../mono/mono-hir";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { typeLayoutOwnerKey } from "./layout-owners";

export function collectMonoInvariantDiagnostics(
  program: MonomorphizedHirProgram,
): readonly LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const canonicalKeyToInstanceId = new Map<string, string>();

  for (const instance of program.types.entries()) {
    const canonicalKey = String(
      canonicalTypeInstanceId({
        typeId: instance.sourceTypeId,
        typeArguments: instance.typeArguments,
      }),
    );
    const instanceId = String(instance.instanceId);
    if (instanceId !== canonicalKey) {
      diagnostics.push(
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_MONO_INVARIANT_VIOLATION",
          message: "Mono type instance id does not match its canonical instantiation key.",
          ownerKey: String(typeLayoutOwnerKey(instance.instanceId)),
          rootCauseKey: "mono-invariant",
          stableDetail: `instance-id:${instanceId}:canonical:${canonicalKey}`,
          sourceOrigin: instance.sourceOrigin,
        }),
      );
    }
    const existingInstanceId = canonicalKeyToInstanceId.get(canonicalKey);
    if (existingInstanceId !== undefined && existingInstanceId !== instanceId) {
      diagnostics.push(
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_MONO_INVARIANT_VIOLATION",
          message: "Duplicate canonical type instance keys map to conflicting mono instances.",
          ownerKey: String(typeLayoutOwnerKey(canonicalKey as MonoInstanceId)),
          rootCauseKey: "mono-invariant",
          stableDetail: `canonical:${canonicalKey}:${existingInstanceId}:${instanceId}`,
          sourceOrigin: instance.sourceOrigin,
        }),
      );
    } else {
      canonicalKeyToInstanceId.set(canonicalKey, instanceId);
    }
  }

  return diagnostics;
}
