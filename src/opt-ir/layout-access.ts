import type { LayoutFactKey } from "../proof-check/model/fact-packet";
import type { OptIrOrigin } from "./provenance";

export type OptIrLayoutAccessKind =
  | "typeSize"
  | "typeAlignment"
  | "fieldOffset"
  | "abiSlot"
  | "validatedBufferBounds";

export interface OptIrLayoutAccess {
  readonly kind: OptIrLayoutAccessKind;
  readonly layoutKey: LayoutFactKey;
  readonly origin: OptIrOrigin;
}
