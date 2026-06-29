import type { OptIrFunctionId } from "../ids";

export type OptIrPolicyUnit =
  | "normalizedOperation"
  | "estimatedByte"
  | "eNode"
  | "eClass"
  | "ruleApplication"
  | "scopeExpansionIteration";

export type OptIrCodeSizeUnit = Extract<OptIrPolicyUnit, "normalizedOperation" | "estimatedByte">;
export type OptIrFuelUnit = Extract<
  OptIrPolicyUnit,
  "scopeExpansionIteration" | "ruleApplication" | "eNode" | "eClass"
>;

export interface OptIrCodeSizeBudget {
  readonly unit: OptIrCodeSizeUnit;
  readonly amount: number;
}

export interface OptIrCodeSizeDelta {
  readonly unit: OptIrPolicyUnit;
  readonly amount: number;
}

export interface OptIrFuel {
  readonly unit: OptIrFuelUnit;
  readonly amount: number;
}

export type OptIrBudgetScope =
  | { readonly kind: "function"; readonly functionId: OptIrFunctionId; readonly sccKey?: string }
  | { readonly kind: "scc"; readonly sccKey: string }
  | { readonly kind: "image" };

export interface OptIrBudgetSccMembership {
  readonly sccKey: string;
  readonly functionIds: readonly OptIrFunctionId[];
  readonly allowExpansion?: boolean;
}

export interface OptIrExpansionBudgetInput {
  readonly perFunctionGrowth: OptIrCodeSizeBudget;
  readonly perSccGrowth: OptIrCodeSizeBudget;
  readonly perImageGrowth: OptIrCodeSizeBudget;
  readonly fixpointFuel: OptIrFuel;
  readonly sccMembership?: readonly OptIrBudgetSccMembership[];
}

export interface OptIrBudgetReservation {
  readonly reservationId: number;
  readonly scope: Extract<OptIrBudgetScope, { readonly kind: "function" }>;
  readonly sccKey: string;
  readonly delta: OptIrCodeSizeDelta & { readonly unit: OptIrCodeSizeUnit };
  readonly fuel: OptIrFuel;
}

export interface OptIrInlineExpansionBudgetCandidate {
  readonly callerFunctionId: OptIrFunctionId;
  readonly estimatedGrowth: OptIrCodeSizeDelta;
  readonly sccKey?: string;
}

export type OptIrExpansionBudgetDecision =
  | { readonly kind: "reserved"; readonly reservation: OptIrBudgetReservation }
  | { readonly kind: "denied"; readonly reason: "budget-exhausted" };

export interface OptIrExpansionBudgetLedger {
  reserve(
    scope: Extract<OptIrBudgetScope, { readonly kind: "function" }>,
    estimatedGrowth: OptIrCodeSizeDelta,
  ): OptIrBudgetReservation | "denied";
  commit(reservation: OptIrBudgetReservation): void;
  release(reservation: OptIrBudgetReservation): void;
  remaining(scope: OptIrBudgetScope): OptIrCodeSizeBudget;
  remainingFuel(): OptIrFuel;
}

interface LedgerState {
  readonly reserved: Map<string, number>;
  readonly committed: Map<string, number>;
  readonly liveReservations: Map<number, OptIrBudgetReservation>;
  fuelReserved: number;
  fuelCommitted: number;
  nextReservationId: number;
}

export function optIrCodeSizeBudget(unit: OptIrCodeSizeUnit, amount: number): OptIrCodeSizeBudget {
  return Object.freeze({ unit, amount: nonNegativeInteger(amount, "budget amount") });
}

export function optIrCodeSizeDelta(unit: OptIrPolicyUnit, amount: number): OptIrCodeSizeDelta {
  return Object.freeze({ unit, amount: nonNegativeInteger(amount, "growth amount") });
}

export function optIrExpansionFuel(unit: OptIrFuelUnit, amount: number): OptIrFuel {
  return Object.freeze({ unit, amount: nonNegativeInteger(amount, "fuel amount") });
}

export function createOptIrExpansionBudgetLedger(
  input: OptIrExpansionBudgetInput,
): OptIrExpansionBudgetLedger {
  ensureCompatibleBudgets(input);
  const functionToScc = new Map<OptIrFunctionId, string>();
  const sccExpansion = new Map<string, boolean>();
  for (const membership of input.sccMembership ?? []) {
    sccExpansion.set(membership.sccKey, membership.allowExpansion !== false);
    for (const functionId of [...membership.functionIds].sort(compareFunctionIds)) {
      functionToScc.set(functionId, membership.sccKey);
    }
  }

  const state: LedgerState = {
    reserved: new Map(),
    committed: new Map(),
    liveReservations: new Map(),
    fuelReserved: 0,
    fuelCommitted: 0,
    nextReservationId: 1,
  };

  return Object.freeze({
    reserve(
      scope: Extract<OptIrBudgetScope, { readonly kind: "function" }>,
      estimatedGrowth: OptIrCodeSizeDelta,
    ) {
      if (!isCodeSizeDeltaForLedger(estimatedGrowth, input.perImageGrowth.unit)) {
        return "denied";
      }
      const sccKey =
        scope.sccKey ?? functionToScc.get(scope.functionId) ?? sccKeyForFunction(scope.functionId);
      if (sccExpansion.get(sccKey) === false || remainingFuelAmount(input, state) < 1) {
        return "denied";
      }
      const delta = Object.freeze({ unit: estimatedGrowth.unit, amount: estimatedGrowth.amount });
      const touchedKeys = budgetKeys(scope.functionId, sccKey);
      if (
        !canReserve(touchedKeys.functionKey, delta.amount, input.perFunctionGrowth, state) ||
        !canReserve(touchedKeys.sccKey, delta.amount, input.perSccGrowth, state) ||
        !canReserve(touchedKeys.imageKey, delta.amount, input.perImageGrowth, state)
      ) {
        return "denied";
      }

      const reservation = Object.freeze({
        reservationId: state.nextReservationId,
        scope: Object.freeze({ ...scope, sccKey }),
        sccKey,
        delta,
        fuel: Object.freeze({ unit: input.fixpointFuel.unit, amount: 1 }),
      });
      state.nextReservationId += 1;
      state.liveReservations.set(reservation.reservationId, reservation);
      for (const key of Object.values(touchedKeys)) {
        addAmount(state.reserved, key, delta.amount);
      }
      state.fuelReserved += 1;
      return reservation;
    },
    commit(reservation: OptIrBudgetReservation) {
      if (!state.liveReservations.delete(reservation.reservationId)) {
        return;
      }
      const keys = budgetKeys(reservation.scope.functionId, reservation.sccKey);
      for (const key of Object.values(keys)) {
        addAmount(state.reserved, key, -reservation.delta.amount);
        addAmount(state.committed, key, reservation.delta.amount);
      }
      state.fuelReserved -= reservation.fuel.amount;
      state.fuelCommitted += reservation.fuel.amount;
    },
    release(reservation: OptIrBudgetReservation) {
      if (!state.liveReservations.delete(reservation.reservationId)) {
        return;
      }
      const keys = budgetKeys(reservation.scope.functionId, reservation.sccKey);
      for (const key of Object.values(keys)) {
        addAmount(state.reserved, key, -reservation.delta.amount);
      }
      state.fuelReserved -= reservation.fuel.amount;
    },
    remaining(scope: OptIrBudgetScope) {
      const key = keyForScope(scope);
      const cap = capForScope(scope, input);
      return optIrCodeSizeBudget(cap.unit, cap.amount - usedAmount(state, key));
    },
    remainingFuel() {
      return optIrExpansionFuel(input.fixpointFuel.unit, remainingFuelAmount(input, state));
    },
  });
}

export function reserveInlineExpansionBudget(
  ledger: OptIrExpansionBudgetLedger,
  candidate: OptIrInlineExpansionBudgetCandidate,
): OptIrExpansionBudgetDecision {
  const reservation = ledger.reserve(
    {
      kind: "function",
      functionId: candidate.callerFunctionId,
      sccKey: candidate.sccKey,
    },
    candidate.estimatedGrowth,
  );
  return reservationDecision(reservation);
}

export function reservationDecision(
  reservation: OptIrBudgetReservation | "denied",
): OptIrExpansionBudgetDecision {
  if (reservation === "denied") {
    return Object.freeze({ kind: "denied", reason: "budget-exhausted" });
  }
  return Object.freeze({ kind: "reserved", reservation });
}

function ensureCompatibleBudgets(input: OptIrExpansionBudgetInput): void {
  const unit = input.perImageGrowth.unit;
  if (input.perFunctionGrowth.unit !== unit || input.perSccGrowth.unit !== unit) {
    throw new Error("scope-expansion budget caps must use one named code-size unit");
  }
}

function isCodeSizeDeltaForLedger(
  delta: OptIrCodeSizeDelta,
  unit: OptIrCodeSizeUnit,
): delta is OptIrCodeSizeDelta & { readonly unit: OptIrCodeSizeUnit } {
  return (
    delta.unit === unit && (delta.unit === "normalizedOperation" || delta.unit === "estimatedByte")
  );
}

function budgetKeys(functionId: OptIrFunctionId, sccKey: string) {
  return {
    functionKey: `function:${Number(functionId)}`,
    sccKey: `scc:${sccKey}`,
    imageKey: "image",
  };
}

function keyForScope(scope: OptIrBudgetScope): string {
  switch (scope.kind) {
    case "function":
      return `function:${Number(scope.functionId)}`;
    case "scc":
      return `scc:${scope.sccKey}`;
    case "image":
      return "image";
  }
}

function capForScope(
  scope: OptIrBudgetScope,
  input: OptIrExpansionBudgetInput,
): OptIrCodeSizeBudget {
  switch (scope.kind) {
    case "function":
      return input.perFunctionGrowth;
    case "scc":
      return input.perSccGrowth;
    case "image":
      return input.perImageGrowth;
  }
}

function canReserve(
  key: string,
  amount: number,
  cap: OptIrCodeSizeBudget,
  state: LedgerState,
): boolean {
  return usedAmount(state, key) + amount <= cap.amount;
}

function usedAmount(state: LedgerState, key: string): number {
  return (state.reserved.get(key) ?? 0) + (state.committed.get(key) ?? 0);
}

function addAmount(table: Map<string, number>, key: string, amount: number): void {
  const nextAmount = (table.get(key) ?? 0) + amount;
  if (nextAmount === 0) {
    table.delete(key);
    return;
  }
  table.set(key, nextAmount);
}

function remainingFuelAmount(input: OptIrExpansionBudgetInput, state: LedgerState): number {
  return input.fixpointFuel.amount - state.fuelReserved - state.fuelCommitted;
}

function sccKeyForFunction(functionId: OptIrFunctionId): string {
  return `function:${Number(functionId)}`;
}

function compareFunctionIds(left: OptIrFunctionId, right: OptIrFunctionId): number {
  return Number(left) - Number(right);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}
