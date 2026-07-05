export interface OptIrDataflowLattice<State> {
  readonly bottom: () => State;
  readonly equals: (left: State, right: State) => boolean;
  readonly meet: (left: State, right: State) => State;
  readonly format: (state: State) => string;
}

export function setLattice<Value>(): OptIrDataflowLattice<ReadonlySet<Value>> {
  return {
    bottom() {
      return new Set<Value>();
    },
    equals(left, right) {
      return left.size === right.size && [...left].every((value) => right.has(value));
    },
    meet(left, right) {
      return new Set([...left, ...right]);
    },
    format(state) {
      return [...state].map(String).sort().join(",");
    },
  };
}
