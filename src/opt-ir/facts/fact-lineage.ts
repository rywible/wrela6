import type { ProofMirValueId } from "../../proof-mir/ids";
import type {
  CheckedFactKindId,
  CheckedPacketFactId,
  CheckedPacketFactKind,
} from "../../proof-check/model/fact-packet";
import type { OptIrFactId, OptimizationPassId } from "../ids";

export type OptIrFactLineage =
  | OptIrCheckedPacketFactLineage
  | OptIrPassDerivedFactLineage
  | OptIrProofErasurePreservedFactLineage;

export interface OptIrProofErasurePreservedFactLineage {
  readonly kind: "proofErasurePreserved";
  readonly sourceFactId: OptIrFactId;
  readonly erasedProofMirValueIds: readonly ProofMirValueId[];
}

export interface OptIrCheckedPacketFactLineage {
  readonly kind: "checkedPacket";
  readonly packetKind: CheckedPacketFactKind;
  readonly packetKindId: CheckedFactKindId;
  readonly packetFactId: CheckedPacketFactId;
}

export interface OptIrPassDerivedFactLineage {
  readonly kind: "passDerived";
  readonly passId: OptimizationPassId;
  readonly inputFactIds: readonly OptIrFactId[];
  readonly derivationKey: string;
  readonly preservation: "derived" | "preserved" | "weakened";
}
