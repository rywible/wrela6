import type { MonoInstanceId } from "../mono/ids";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { enumLayoutOwnerKey } from "./layout-owners";

export const FIXTURE_ENUM_SOURCE_ORIGIN = "layout-fixture:0:0";

export function enumLayoutDiagnostic(
  instanceId: string,
  input: {
    readonly code: string;
    readonly message: string;
    readonly stableDetail: string;
    readonly sourceOrigin?: string;
  },
): LayoutDiagnostic {
  const ownerKey = String(enumLayoutOwnerKey(instanceId as MonoInstanceId));
  return layoutDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    sourceOrigin: input.sourceOrigin,
    ownerKey,
    rootCauseKey: ownerKey,
    stableDetail: input.stableDetail,
  });
}
