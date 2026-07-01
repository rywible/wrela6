import type { AArch64AbiLocationAssignment } from "./abi-classification";

export interface AArch64PrivateConventionPlan {
  readonly privateConventions: readonly AArch64PrivateConventionRecord[];
}

export interface AArch64PrivateConventionRecord {
  readonly callerKey: string;
  readonly calleeKey: string;
  readonly argumentLocations?: readonly AArch64AbiLocationAssignment[];
  readonly resultLocations?: readonly AArch64AbiLocationAssignment[];
  readonly clobberedGprs?: readonly string[];
  readonly pinnedLiveThroughGprs?: readonly string[];
  readonly calleeSaveObligations?: readonly string[];
  readonly potentialVeneerClobberGprs?: readonly string[];
  readonly tailCallEligible?: boolean;
}
