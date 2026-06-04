import { test } from "bun:test";
import {
  addFact,
  advancePrivateState,
  callFallibleConsume,
  checkTerminalGraph,
  cloneState,
  consumePlace,
  dischargeObligation,
  emptyState,
  enterLinearObligation,
  exitFunction,
  expectRejected,
  markValidationMatched,
  openLoan,
  readDynamicLayoutField,
  requireFact,
  usePlace,
  withPlace,
} from "../support/proof-core-reference";

test("proof core rejects use after consume", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const consumedState = consumePlace(initialState, "buffer").state;

  expectRejected(usePlace(consumedState, "buffer"), "RESOURCE_ALREADY_CONSUMED");
});

test("proof core rejects function exit with a live linear obligation", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const obligatedState = enterLinearObligation(initialState, "rx-buffer", "buffer").state;

  expectRejected(exitFunction(obligatedState, "return"), "LIVE_OBLIGATION_ON_EXIT");
});

test("proof core rejects touching a place while an active loan covers it", () => {
  const initialState = withPlace(emptyState(), "self.rx", { kind: "affine" });
  const loanedState = openLoan(initialState, "receive-session", "self.rx").state;

  expectRejected(usePlace(loanedState, "self.rx"), "PLACE_LOANED");
});

test("proof core rejects discharge through the wrong stream membership", () => {
  const initialState = withPlace(emptyState(), "buffer", {
    kind: "linear",
    brand: "batch-a",
  });
  const obligatedState = enterLinearObligation(initialState, "rx-buffer", "buffer").state;

  expectRejected(
    dischargeObligation(obligatedState, "rx-buffer", "buffer", "batch-b"),
    "BRAND_MISMATCH",
  );
});

test("proof core rejects matching a validation result twice", () => {
  const initialState = withPlace(emptyState(), "validation", { kind: "singleUse" });
  const matchedState = markValidationMatched(initialState, "validation").state;

  expectRejected(markValidationMatched(matchedState, "validation"), "RESOURCE_ALREADY_CONSUMED");
});

test("proof core rejects platform requires without the exact visible fact", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const capacityState = addFact(initialState, "len <= buffer.capacity");

  expectRejected(requireFact(capacityState, "len <= buffer.initialized_prefix"), "FACT_NOT_PROVEN");
});

test("proof core rejects predicate facts from an old private state generation", () => {
  const initialState = withPlace(emptyState(), "builder", {
    kind: "privateState",
    generation: 0,
  });
  const provenState = addFact(initialState, "builder@0.can_insert(desc)");
  const advancedState = advancePrivateState(provenState, "builder").state;

  expectRejected(requireFact(advancedState, "builder@1.can_insert(desc)"), "FACT_NOT_PROVEN");
});

test("proof core rejects fallible consume without an Attempt contract", () => {
  const initialState = withPlace(emptyState(), "net0", { kind: "affine" });

  expectRejected(callFallibleConsume(initialState, "net0", "plainResult"), "ATTEMPT_REQUIRED");
});

test("proof core rejects terminal discharge cycles", () => {
  expectRejected(
    checkTerminalGraph([
      ["sendA", "sendB"],
      ["sendB", "sendA"],
    ]),
    "TERMINAL_CYCLE",
  );
});

test("proof core rejects reading dynamic layout fields before fixed fit facts", () => {
  const initialState = cloneState(emptyState());

  expectRejected(readDynamicLayoutField(initialState, "Packet.payload"), "LAYOUT_FIT_NOT_PROVEN");
});
