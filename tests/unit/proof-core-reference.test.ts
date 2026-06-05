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
  type ProofState,
  type ResourceStatus,
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

test("proof core rejects using an aggregate while one of its fields is loaned", () => {
  const initialState = withPlace(withPlace(emptyState(), "self", { kind: "affine" }), "self.rx", {
    kind: "affine",
  });
  const loanedState = openLoan(initialState, "receive-session", "self.rx").state;

  expectRejected(usePlace(loanedState, "self"), "RESOURCE_PARTIALLY_LOANED");
});

test("proof core rejects joining branches with different live obligations", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const obligatedBranch = enterLinearObligation(initialState, "rx-buffer", "buffer").state;
  const cleanBranch = cloneState(initialState);

  expectRejected(joinStates(obligatedBranch, cleanBranch), "BRANCH_OBLIGATION_MISMATCH");
});

test("proof core rejects joining branches with different active loans", () => {
  const initialState = withPlace(emptyState(), "self.rx", { kind: "affine" });
  const loanedBranch = openLoan(initialState, "receive-session", "self.rx").state;
  const cleanBranch = cloneState(initialState);

  expectRejected(joinStates(loanedBranch, cleanBranch), "BRANCH_LOAN_MISMATCH");
});

test("proof core rejects old private-state facts after generation advance", () => {
  const initialState = withPlace(emptyState(), "builder", {
    kind: "privateState",
    generation: 0,
  });
  const provenState = addFact(initialState, "builder@0.can_insert(desc)");
  const advancedState = advancePrivateState(provenState, "builder").state;

  expectRejected(requireFact(advancedState, "builder@0.can_insert(desc)"), "FACT_NOT_PROVEN");
});

test("proof core rejects facts about consumed resources", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const initializedState = addFact(initialState, "len <= buffer.initialized_prefix");
  const consumedState = consumePlace(initializedState, "buffer").state;

  expectRejected(requireFact(consumedState, "len <= buffer.initialized_prefix"), "FACT_NOT_PROVEN");
});

test("proof core rejects dynamic layout reads without the dynamic range fact", () => {
  const initialState = addFact(emptyState(), "layout.fixedFits(Packet)");

  expectRejected(
    readDynamicLayoutField(initialState, "Packet.payload"),
    "LAYOUT_DYNAMIC_RANGE_NOT_PROVEN",
  );
});

test("proof core rejects using a field after its aggregate is consumed", () => {
  const initialState = withPlace(withPlace(emptyState(), "self", { kind: "affine" }), "self.tx", {
    kind: "affine",
  });
  const consumedState = consumePlace(initialState, "self").state;

  expectRejected(usePlace(consumedState, "self.tx"), "RESOURCE_ALREADY_CONSUMED");
});

test("proof core rejects opening a linear obligation on a copy value", () => {
  const initialState = withPlace(emptyState(), "count", { kind: "copy" });

  expectRejected(
    enterLinearObligation(initialState, "count-close", "count"),
    "OBLIGATION_REQUIRES_NON_COPY",
  );
});

test("proof core rejects duplicate obligation identifiers", () => {
  const initialState = withPlace(withPlace(emptyState(), "left", { kind: "linear" }), "right", {
    kind: "linear",
  });
  const obligatedState = enterLinearObligation(initialState, "rx-buffer", "left").state;

  expectRejected(
    enterLinearObligation(obligatedState, "rx-buffer", "right"),
    "OBLIGATION_ALREADY_OPEN",
  );
});

test("proof core rejects duplicate loan identifiers", () => {
  const initialState = withPlace(
    withPlace(emptyState(), "self.rx", { kind: "affine" }),
    "self.tx",
    { kind: "affine" },
  );
  const loanedState = openLoan(initialState, "edge-session", "self.rx").state;

  expectRejected(openLoan(loanedState, "edge-session", "self.tx"), "LOAN_ALREADY_OPEN");
});

test("proof core rejects terminal graphs that never reach platform discharge", () => {
  expectRejected(
    checkTerminalGraph([["closePacket", "sanitizeOnly"]], new Set(["platformDischarge"])),
    "TERMINAL_NO_PLATFORM_DISCHARGE",
  );
});

test("proof core rejects validation Ok when validation and source brands differ", () => {
  const initialState = withPlace(
    withPlace(emptyState(), "buffer", { kind: "linear", brand: "batch-a" }),
    "validation",
    { kind: "singleUse", brand: "batch-b" },
  );

  expectRejected(
    matchValidationOk(initialState, "validation", "buffer", "packet"),
    "BRAND_MISMATCH",
  );
});

test("proof core rejects matching a non-validation resource as validation", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });

  expectRejected(markValidationMatched(initialState, "buffer"), "RESOURCE_KIND_MISMATCH");
});

test("proof core rejects dropping a droppable resource with a live obligation", () => {
  const initialState = withPlace(emptyState(), "slot", {
    kind: "affine",
    droppable: true,
  });
  const obligatedState = enterLinearObligation(initialState, "slot-close", "slot").state;

  expectRejected(dropPlace(obligatedState, "slot"), "RESOURCE_HAS_LIVE_OBLIGATION");
});

test("proof core rejects core transfer with a live obligation", () => {
  const initialState = withPlace(emptyState(), "packet", {
    kind: "linear",
    coreMovable: true,
  });
  const obligatedState = enterLinearObligation(initialState, "packet-close", "packet").state;

  expectRejected(transferToCore(obligatedState, "packet", "core1"), "RESOURCE_HAS_LIVE_OBLIGATION");
});

test("proof core rejects joining branches with different resource metadata", () => {
  const leftBranch = withPlace(emptyState(), "packet", {
    kind: "linear",
    brand: "batch-a",
  });
  const rightBranch = withPlace(emptyState(), "packet", {
    kind: "linear",
    brand: "batch-b",
  });

  expectRejected(joinStates(leftBranch, rightBranch), "BRANCH_RESOURCE_MISMATCH");
});

test("proof core rejects joining an obligation over a maybe-consumed place", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const obligatedState = enterLinearObligation(initialState, "rx-buffer", "buffer").state;
  const consumedBranch = forcePlaceStatus(obligatedState, "buffer", "consumed");
  const liveBranch = cloneState(obligatedState);

  expectRejected(joinStates(consumedBranch, liveBranch), "BRANCH_OBLIGATION_RESOURCE_MISMATCH");
});

test("proof core rejects opening two obligations on the same place", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const obligatedState = enterLinearObligation(initialState, "rx-buffer", "buffer").state;

  expectRejected(
    enterLinearObligation(obligatedState, "tx-buffer", "buffer"),
    "PLACE_ALREADY_OBLIGATED",
  );
});

test("proof core rejects nested obligations on overlapping places", () => {
  const initialState = withPlace(withPlace(emptyState(), "self", { kind: "affine" }), "self.tx", {
    kind: "linear",
  });
  const obligatedState = enterLinearObligation(initialState, "self-close", "self").state;

  expectRejected(
    enterLinearObligation(obligatedState, "tx-close", "self.tx"),
    "PLACE_ALREADY_OBLIGATED",
  );
});

test("proof core rejects dropping a copy aggregate with a live linear child", () => {
  const initialState = withPlace(withPlace(emptyState(), "box", { kind: "copy" }), "box.item", {
    kind: "linear",
  });

  expectRejected(dropPlace(initialState, "box"), "RESOURCE_CHILD_MUST_BE_HANDLED");
});

test("proof core rejects Attempt consume of a resource with a live obligation", () => {
  const initialState = withPlace(emptyState(), "buffer", { kind: "linear" });
  const obligatedState = enterLinearObligation(initialState, "rx-buffer", "buffer").state;

  expectRejected(
    callFallibleConsume(obligatedState, "buffer", "attempt"),
    "RESOURCE_HAS_LIVE_OBLIGATION",
  );
});

function forcePlaceStatus(state: ProofState, place: string, status: ResourceStatus): ProofState {
  const record = state.places.get(place);
  if (record === undefined) {
    throw new Error(`Cannot force status for unknown place ${place}.`);
  }

  const places = new Map(state.places);
  places.set(place, { ...record, status });
  return { ...cloneState(state), places };
}
