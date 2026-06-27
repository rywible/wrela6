import type { ParameterId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirDraftOperand } from "../lower/lowering-operands";

export type DraftProofMirCallReceiver =
  | {
      readonly mode: "observe";
      readonly operand: ProofMirDraftOperand;
      readonly originKey: ProofMirCanonicalKey;
    }
  | {
      readonly mode: "consume";
      readonly operand: ProofMirDraftOperand;
      readonly originKey: ProofMirCanonicalKey;
    };

export type DraftProofMirCallArgument =
  | {
      readonly parameterId?: ParameterId;
      readonly mode: "observe";
      readonly operand: ProofMirDraftOperand;
      readonly originKey: ProofMirCanonicalKey;
    }
  | {
      readonly parameterId?: ParameterId;
      readonly mode: "consume";
      readonly operand: ProofMirDraftOperand;
      readonly originKey: ProofMirCanonicalKey;
    };
