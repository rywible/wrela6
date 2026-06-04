import { test } from "bun:test";
import {
  addFact,
  advancePrivateState,
  bindPlace,
  callFallibleConsume,
  callOrdinaryFunctionDischarge,
  checkLoopBackedge,
  checkTerminalGraph,
  cloneState,
  consumePlace,
  dischargeObligation,
  dropPlace,
  emptyState,
  enterLinearObligation,
  exitFunction,
  expectRejected,
  joinStates,
  markValidationMatched,
  matchValidationOk,
  openLoan,
  readDynamicLayoutField,
  requireFact,
  transferToCore,
  usePlace,
  withPlace,
  wrapPlace,
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

test("proof core rejects use after branch join with maybe-consumed resource", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const consumedBranch = consumePlace(initialState, "buffer").state;
  const liveBranch = cloneState(initialState);
  const joinedState = joinStates(consumedBranch, liveBranch).state;

  expectRejected(usePlace(joinedState, "buffer"), "RESOURCE_MAYBE_CONSUMED");
});

test("proof core rejects loop backedge with live obligation", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const obligatedState = enterLinearObligation(initialState, "loop-buffer", "buffer").state;

  expectRejected(checkLoopBackedge(obligatedState), "LIVE_OBLIGATION_ON_LOOP_BACKEDGE");
});

test("proof core rejects dropping wrapper that may contain a linear resource", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const wrappedState = wrapPlace(initialState, "maybeBuffer", "buffer").state;

  expectRejected(dropPlace(wrappedState, "maybeBuffer"), "RESOURCE_MUST_BE_HANDLED");
});

test("proof core rejects ordinary function hiding terminal discharge", () => {
  const initialState = withPlace(emptyState(), "packet", {
    kind: "linear",
    brand: "batch-a",
  });

  expectRejected(callOrdinaryFunctionDischarge(initialState, "packet"), "ORDINARY_DISCHARGE");
});

test("proof core rejects using aggregate after field move", () => {
  const initialState = withPlace(withPlace(emptyState(), "self", { kind: "affine" }), "self.tx", {
    kind: "affine",
  });
  const fieldMovedState = consumePlace(initialState, "self.tx").state;

  expectRejected(usePlace(fieldMovedState, "self"), "RESOURCE_PARTIALLY_MOVED");
});

test("proof core transfers validation Ok obligation from source to packet", () => {
  const initialState = withPlace(
    withPlace(emptyState(), "buffer", { kind: "linear", brand: "batch-a" }),
    "validation",
    { kind: "singleUse", brand: "batch-a" },
  );
  const obligatedState = enterLinearObligation(initialState, "rx-buffer", "buffer").state;
  const okState = matchValidationOk(obligatedState, "validation", "buffer", "packet").state;

  expectRejected(usePlace(okState, "buffer"), "RESOURCE_ALREADY_CONSUMED");
  expectRejected(dischargeObligation(okState, "rx-buffer", "packet", "batch-b"), "BRAND_MISMATCH");
});

test("proof core rejects cross-core transfer of session-bound token", () => {
  const initialState = withPlace(emptyState(), "packet", {
    kind: "linear",
    brand: "batch-a",
  });

  expectRejected(transferToCore(initialState, "packet", "core1"), "RESOURCE_NOT_CORE_MOVABLE");
});

test("proof core rejects shadowing a live affine resource", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });

  expectRejected(
    bindPlace(initialState, "buffer", { kind: "copy" }),
    "PLACE_SHADOWS_LIVE_RESOURCE",
  );
});
