import type { OptIrCallId, OptIrFactId } from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";

const CALL_CLOBBER_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "call-clobber",
  packetKinds: ["call-clobber"],
  preservationRules: ["preserve-through-call-stable-clone"],
  invalidationRules: ["invalidate-on-call-rewrite"],
  upstreamVerifierKey: "call-clobber-facts",
  negativeFixtures: ["missing-convention"],
});

export interface OptIrCallClobberFactInput {
  readonly factId: OptIrFactId;
  readonly callId: OptIrCallId;
  readonly clobberedRegisters?: readonly string[];
  readonly preservesNZCV: boolean;
  readonly clobbersMemory: boolean;
  readonly convention?: "aapcs64" | "compilerCustom";
  readonly customConventionKey?: string;
  readonly claimedCustomConvention?: boolean;
  readonly authority?: string;
}

export function callClobberFactRecord(input: OptIrCallClobberFactInput): OptIrFactRecord {
  const convention = input.convention ?? "aapcs64";
  if (convention === "compilerCustom" && (input.customConventionKey ?? "").length === 0) {
    throw new RangeError("custom call clobber conventions require an agreement key.");
  }
  const rawRegisters = input.clobberedRegisters ?? defaultClobbersFor(convention);
  if (rawRegisters.some((register) => register.length === 0)) {
    throw new RangeError("call clobber register names must be non-empty.");
  }
  const clobberedRegisters = [...new Set(rawRegisters)].sort();
  return optIrExtensionFactRecord({
    registry: CALL_CLOBBER_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "call-clobber",
    packetKind: "call-clobber",
    subject: { kind: "optIrCall", callId: input.callId },
    payload: {
      clobberedRegisters,
      clobbersMemory: input.clobbersMemory,
      convention,
      ...(input.customConventionKey === undefined
        ? {}
        : { customConventionKey: input.customConventionKey }),
      mayNarrowRegisterClobbers: convention === "compilerCustom",
      preservesNZCV: input.preservesNZCV,
      claimedCustomConvention: input.claimedCustomConvention ?? convention === "compilerCustom",
    },
    authority: requireAuthority(input.authority ?? "proof:call-clobber", "call-clobber"),
  });
}

function defaultClobbersFor(convention: "aapcs64" | "compilerCustom"): readonly string[] {
  if (convention === "compilerCustom") {
    return [];
  }
  return Object.freeze([
    "v0",
    "v1",
    "v2",
    "v3",
    "v4",
    "v5",
    "v6",
    "v7",
    "x0",
    "x1",
    "x2",
    "x3",
    "x4",
    "x5",
    "x6",
    "x7",
    "x8",
    "x9",
    "x10",
    "x11",
    "x12",
    "x13",
    "x14",
    "x15",
    "x16",
    "x17",
  ]);
}

function requireAuthority(authority: string, family: string): string {
  if (authority.length === 0) {
    throw new RangeError(`${family} facts require non-empty authority.`);
  }
  return authority;
}
