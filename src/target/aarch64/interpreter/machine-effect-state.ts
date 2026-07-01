export interface AArch64MachineEffectState {
  readonly nextToken: number;
}

export function initialAArch64MachineEffectState(): AArch64MachineEffectState {
  return Object.freeze({ nextToken: 0 });
}

export function advanceAArch64MachineEffectToken(
  state: AArch64MachineEffectState,
): AArch64MachineEffectState {
  return Object.freeze({ nextToken: state.nextToken + 1 });
}
