export const optIrWrelaRuntimeKeys = Object.freeze({
  boundsCheck: "runtime.bounds_check",
  copy: "runtime.copy",
  proofWrapper: "runtime.proof_wrapper",
  resourceWrapper: "runtime.resource_wrapper",
  safeFieldApi: "runtime.safe_field_api",
  packetParserState: "runtime.packet_parser_state",
  packetParserStateAdvance: "runtime.packet_parser_state.advance",
  packetParserRejectDiagnostic: "runtime.packet_parser_reject_diagnostic",
  platformWrapper: "runtime.platform_wrapper",
  terminalCleanup: "runtime.terminal_cleanup",
  externalRoot: "runtime.external_root",
});

export type OptIrWrelaRuntimeKey =
  (typeof optIrWrelaRuntimeKeys)[keyof typeof optIrWrelaRuntimeKeys];

const WRELA_RUNTIME_KEY_SET: ReadonlySet<string> = new Set(Object.values(optIrWrelaRuntimeKeys));

export function isOptIrWrelaRuntimeKey(value: string): value is OptIrWrelaRuntimeKey {
  return WRELA_RUNTIME_KEY_SET.has(value);
}

export type OptIrWrelaRuntimeKeyFamily =
  | "moveCopyWrapper"
  | "platformWrapper"
  | "packetParserState"
  | "packetParserRelated"
  | "boundsCheck"
  | "terminalCleanup"
  | "rejectDiagnostic";

const RUNTIME_KEY_FAMILIES: Readonly<
  Record<OptIrWrelaRuntimeKeyFamily, readonly OptIrWrelaRuntimeKey[]>
> = Object.freeze({
  moveCopyWrapper: Object.freeze([
    optIrWrelaRuntimeKeys.proofWrapper,
    optIrWrelaRuntimeKeys.resourceWrapper,
    optIrWrelaRuntimeKeys.safeFieldApi,
    optIrWrelaRuntimeKeys.copy,
  ]),
  platformWrapper: Object.freeze([
    optIrWrelaRuntimeKeys.platformWrapper,
    optIrWrelaRuntimeKeys.resourceWrapper,
  ]),
  packetParserState: Object.freeze([
    optIrWrelaRuntimeKeys.packetParserState,
    optIrWrelaRuntimeKeys.packetParserStateAdvance,
  ]),
  packetParserRelated: Object.freeze([
    optIrWrelaRuntimeKeys.packetParserState,
    optIrWrelaRuntimeKeys.packetParserStateAdvance,
    optIrWrelaRuntimeKeys.packetParserRejectDiagnostic,
  ]),
  boundsCheck: Object.freeze([optIrWrelaRuntimeKeys.boundsCheck]),
  terminalCleanup: Object.freeze([optIrWrelaRuntimeKeys.terminalCleanup]),
  rejectDiagnostic: Object.freeze([optIrWrelaRuntimeKeys.packetParserRejectDiagnostic]),
});

export function optIrWrelaRuntimeKeysForFamily(
  family: OptIrWrelaRuntimeKeyFamily,
): readonly OptIrWrelaRuntimeKey[] {
  return RUNTIME_KEY_FAMILIES[family];
}

export function optIrWrelaRuntimeKeyMatchesFamily(
  runtimeKey: string,
  family: OptIrWrelaRuntimeKeyFamily,
): boolean {
  return RUNTIME_KEY_FAMILIES[family].includes(runtimeKey as OptIrWrelaRuntimeKey);
}
