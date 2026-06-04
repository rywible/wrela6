```wr
use UefiFirmware from core.uefi
use BootError, Machine from core.boot

// ReadableBuffer and WritableBuffer are intrinsic opaque memory tokens.
// - source.len is trusted edge metadata, not a byte read from offset 0.
// - buffer.capacity is trusted allocation metadata for the backing region.
// - validators declare what readable bytes mean; buffers have no byte schema.
// - device edges may attach descriptor/queue metadata that core code cannot see.
// - unique edge class declares a root driver/device authority. Values of that
//   class can only be minted by image binding or bringup, and each bound device
//   appears at most once in the image graph.
// - edge class declares an edge/path capability. Edge path values are affine and
//   branded, but the class itself is not globally singleton; a unique root may
//   mint multiple independent paths or lanes when its API says so.
// - edge class bodies are written and typechecked in the language; only the
//   final hardware primitives for MMIO, fences, and descriptor publication are
//   trusted platform operations.
// - Each affine value has one current core owner. Moving a value into a pinned
//   worker or through a cross-core transfer capability changes that owner.
//   Values cannot be read or mutated from another core unless ownership has
//   moved there through a checked stdlib capability.
// - terminal fn bodies must discharge obligations into another terminal fn or
//   a private platform fn. A platform fn is the tiny trusted hardware boundary.
// - ordinary `self` is exclusive activated mutable access and is reusable after
//   the call. Moving an object or edge capability requires explicit consume self.
// - self access is field-sensitive under closed-world analysis. While self.rx
//   has an active stream loan, methods may still use disjoint fields such as
//   self.tx and counters, but may not touch self.rx.
// - requires clauses are call-site proof obligations on ordinary, terminal, and
//   platform functions. If the compiler cannot prove one from local facts and
//   prior checks, the call does not typecheck. Function bodies may assume their
//   own requires clauses.
// - requires clauses may mention only stable proof facts: constants, local
//   values, sealed token fields, arithmetic, comparisons, prior ensure facts,
//   and predicate fn results. They may not call ordinary, terminal, or platform
//   functions.
// - predicate fn is pure proof code. It cannot mutate state, perform platform
//   operations, consume affine tokens, or depend on unstable device state.
//   Predicate facts apply only to the exact state token they were proven on.
//   If a private state token advances, old predicate facts do not carry over.
// - ensure statements are runtime validation in checked code. They create facts
//   the compiler can use afterward. Branches that leave the current path with
//   continue, return, or terminal discharge also refine facts on the remaining
//   path.
// - Platform fns do not use ensures. Their value preconditions are requires
//   clauses; trusted return facts are encoded in sealed return token types. The
//   compiler attaches implicit receiver/session brands to those tokens.
// - Platform fn arguments follow the same default as ordinary functions, but
//   sealed affine token parameters must be written consume when the platform
//   operation changes ownership or typestate.
// - terminal fn control flow must be acyclic and every path must reach a
//   platform fn or another terminal fn that reaches a platform fn.
// - private classes are affine state tokens, not ordinary mutable objects.
//   Non-predicate calls on a private class consume the previous private state
//   and activate the next private state. Source may reuse the same name, but the
//   compiler checks this as state threading. predicate fn observes the current
//   state for proof only and does not advance it. Private state cannot be copied,
//   stored in ordinary objects, returned from public APIs, or dropped without a
//   closing operation.
//   A private method written `fn step(self, args) -> R` is checked as if it
//   returned `(NextSelf, R)`. A private method with no explicit return is checked
//   as if it returned `NextSelf`. A closing method written `consume self` does
//   not return a next private state.
//   When a private state token is minted from an edge/path receiver, the
//   compiler brands it to that receiver and records any private loan it opens.
//   The source does not need to write a loan type parameter.
//
// Compiler rules used by this example:
// - Interfaces are static constraints only. Interface names appear in type
//   parameter bounds such as `T: Runnable`, and every constrained use is
//   monomorphized at compile time. Interface names do not appear as ordinary
//   value, field, or parameter types.
// - Validation[Ok, Err, Source] is a single-use result produced by a
//   validated buffer. It cannot be stored, copied, or returned. It must be
//   matched while Source is still inside its `take` scope. A named local binding
//   is legal when it is consumed by exactly one exhaustive match in that scope.
// - Validation Ok consumes Source into the validated buffer. Validation Err
//   leaves Source live in the surrounding `take` scope and returns ordinary
//   rejection data.
// - Function arguments have modes by function kind. Ordinary fn parameters
//   observe session-bound values unless explicitly consumed; they cannot store,
//   return, or terminally discharge them. terminal fn consumes the non-self
//   linear argument it closes; the receiver is reused unless written consume self.
//   constructor fn consumes affine arguments that are stored into the constructed
//   object.
// - ReadableBuffer, WritableBuffer, and validated buffers are sealed affine
//   tokens. They cannot be constructed by literals, dataclass constructors, or
//   ordinary functions. Only private edge-internal minting helpers can create
//   them from sealed platform descriptor/slot tokens.
// - Edge-internal proof tokens are sealed too. RX moves from RxCompletion to
//   SyncedRxBuffer to ReadableBuffer; TX moves from TxSlot to WritableBuffer.
//   Typestate transitions carry token facts unless they explicitly mint a
//   different shape. For RX, SyncedRxBuffer carries descriptor, written_len,
//   capacity, and receiver/session provenance from RxCompletion.
// - Origin and membership brands are implicit. They are not written in source.
//   A Packet minted from a buffer yielded by RxBatch A can only be returned
//   through RxBatch A because the compiler tracks the take-session that produced
//   it.
// - A stream terminal method accepts only tokens yielded by its current take
//   session. An edge terminal method accepts only tokens minted by that edge
//   path.
// - take stream opens an affine one-shot stream. Each yielded item must be
//   closed exactly once by a terminal fn on that stream. Uniterated items remain
//   owned by the edge. take buffer opens a linear obligation that must be
//   discharged. take on a validated buffer means taking an already-validated
//   buffer session.
// - ?, return, break, and yield cannot cross a live linear obligation unless
//   the obligation is carried out by the result type or discharged first.
// - yield wake is a scheduler borrow. It does not move or consume wake, and it
//   is only legal when no linear obligations are live.
// - Fallible calls that consume affine or edge capabilities must prove that
//   every Err path returns, retains, or discharges those capabilities. `?` is
//   only legal when that proof is visible in the result type or function rule.
// - Attempt[Ok, Err, Inputs] is the fallible sibling of Validation. Success may
//   consume listed Inputs; Err must return, retain, or discharge them.
// - Type constructors lift resource kind. If T is affine or linear, then
//   Option[T], Result[T, E], tuples, List[T], Map[K, T], and other wrappers
//   containing T are affine or linear too unless the wrapper is a checked owner
//   with explicit terminal discharge rules. A wrapper containing a live
//   obligation cannot be copied, silently dropped, stored, or returned in a type
//   that does not carry that obligation. Ordinary dataclasses are copy-safe
//   value aggregates, so they reject affine fields instead of lifting.
//   Result carries affine outputs. Attempt is separate: it models ownership of
//   affine inputs across a fallible call, where success may consume the inputs
//   and error must return, retain, or discharge them.
// - List and Map are bounded static-memory collections. They must declare a
//   capacity at construction, cannot be declared inside loops, and do not grow
//   from an ambient heap. clear resets logical contents for reuse but does not
//   free memory. Inserting past capacity is illegal unless the concrete type
//   defines an explicit overwrite, drop, or eviction policy.
// - MoveRing is a bounded cross-core ownership transfer structure. Its endpoints
//   are affine edge paths. push consumes an item on Ok and returns it on Err.
//   pop mints ownership on the consumer's current core. The ring stores values;
//   it does not expose shared references to either core. The T: CoreMovableOwned
//   bound rejects live stream items, validated buffers, edge-internal proof
//   tokens, platform tokens, and other session-bound values.
// - WritableBuffer initialized_prefix is the contiguous initialized range
//   [0, initialized_prefix). Writes only advance it when they fill the next
//   contiguous byte range from the current prefix.
// - layout.fits is normative: prove fixed fields fit, read fixed fields,
//   compute dynamic byte ranges with checked arithmetic, prove dynamic ranges
//   fit, then expose derived fields. It is a containment proof, not an exact
//   length proof: trailing bytes are allowed but remain opaque unless the schema
//   declares fields for them.
// - Stream-producing calls are take-only expressions. A function may name a
//   stream return shape, such as `fn receive(self) -> RxBatch`, but callers may
//   use that call only as the operand of `take`. The call and stream loan open
//   atomically: `take self.rx.receive() as batch:`. A stream result cannot be
//   bound to a variable, stored, returned, passed as an argument, or used after a
//   second call to the same path.
// - Private stream constructors are the narrow exception to take-only calls.
//   A private edge-internal constructor such as `builder.seal()` may return a
//   stream only in tail position of a public stream-producing function. The
//   stream still cannot be bound, stored, or inspected inside the edge body.

enum PacketError:
    too_short
    too_large
    malformed

enum PacketKind:
    ping
    data
    ignored

enum TransferOk:
    sent

dataclass PacketLimits:
    max_frame_bytes: usize

dataclass PacketReject:
    // Ordinary visible rejection payload. This value is forgeable and carries
    // no buffer ownership by itself.
    error: PacketError

// A stream is a bounded one-shot sequence over previously allocated memory.
// RxBatch is a stable snapshot of completed RX descriptors and the active loan
// of the RX path that produced it. Iteration move-yields unique ReadableBuffer
// obligations. It cannot be indexed, copied, rewound, or iterated twice.
// Uniterated buffers remain driver-owned. RxBatch cannot be constructed by
// core code; NetworkRx.receive produces it only as a take-only stream expression.
stream RxBatch contains ReadableBuffer bound 64:
    // These terminal functions are the only RX operations available while the
    // NetworkRx path is loaned to this stream. They can only close buffers or
    // packets whose hidden membership brand matches this batch. Closing consumes
    // the yielded item, invalidates it for later reads, and removes it from the
    // batch's outstanding obligation set.
    terminal fn return_rx(self, packet: Packet):
        // Returning a validated Packet gives the original RX descriptor back to
        // the device path after packet handling has finished.
        self.publish_packet_rx(packet=packet)

    terminal fn drop_rx(self, buffer: ReadableBuffer, rejected: PacketReject):
        // Dropping a live RX buffer gives the original descriptor back to the
        // device path with an ordinary reason. `rejected` is data for logging
        // or counters, not an ownership proof.
        self.publish_buffer_rx(buffer=buffer)

    private platform fn publish_packet_rx(self, consume packet: Packet)

    private platform fn publish_buffer_rx(self, consume buffer: ReadableBuffer)

validated buffer Packet:
    // Declarative zero-copy interpretation of an opaque ReadableBuffer.
    // The compiler generates Packet.validate(source=buffer, limits=...).
    // All require branches return PacketReject, so the inferred validator type is:
    // Validation[Packet, PacketReject, ReadableBuffer].
    // On Ok, validation consumes the source ReadableBuffer obligation into Packet.
    // On Err, the ReadableBuffer obligation stays with the active `take buffer` scope
    // and PacketReject remains ordinary data.

    params:
        limits: PacketLimits

    layout:
        kind_byte: u8 at 0
        payload_len: u8 at 1
        payload: bytes at 2 len usize(payload_len)

    derive:
        kind: PacketKind from kind_byte:
            0 => PacketKind.ping
            1 => PacketKind.data
            otherwise => PacketKind.ignored

    require:
        source.len >= 2 else PacketReject(error=PacketError.too_short)
        source.len <= limits.max_frame_bytes else PacketReject(error=PacketError.too_large)
        layout.fits else PacketReject(error=PacketError.malformed)

class NetworkPaths:
    rx: NetworkRx
    tx: NetworkTx
    wake: NetworkWake

unique edge class NetworkDevice:
    // A bound device is unique in the image graph. split consumes the whole
    // device capability once and mints independent edge paths. NetworkRx,
    // NetworkTx, and NetworkWake are affine path values, not unique classes.
    fn split(consume self) -> NetworkPaths

edge class NetworkRx:
    // The RX path owns receive descriptor management.
    // receive returns a bounded stream over completed RX buffers already owned
    // by the driver queue. No list is allocated or filled by the caller.
    //
    // For each completed RX descriptor, the edge driver:
    // - polls sealed RxCompletion tokens containing device-written length and
    //   trusted allocation capacity
    // - proves written_len <= capacity
    // - consumes RxCompletion into SyncedRxBuffer with DMA/cache synchronization
    // - mints core-owned ReadableBuffer tokens from SyncedRxBuffer
    //
    // Those len/capacity values are token metadata. They are not read from the
    // packet bytes, and byte offset 0 remains packet data.
    // receive uses a private builder phase before returning the public stream.
    // RxBatchBuilder is a private affine state token branded to this RX path:
    // while it is live, this RX path cannot open another builder. At the call
    // site, receive is only legal as the operand of take, so returning the public
    // stream and opening its RX loan are one atomic operation. While the stream
    // is open, the caller cannot touch NetworkRx directly; it must return or
    // drop yielded buffers through the RxBatch terminal functions.
    // The compiler internally brands the result to this receive session.
    // receive is checked edge code. It validates raw descriptor metadata before
    // minting any ReadableBuffer tokens or returning the active stream loan.
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            if completion.written_len > completion.capacity:
                builder.quarantine(completion=completion)
                continue

            let ready = builder.sync_for_cpu(completion=completion)

            if not builder.can_insert(descriptor=ready.descriptor):
                builder.return_synced(ready=ready)
                continue

            builder.attach_readable(ready=ready)

        return builder.seal()

    private platform fn open_rx_builder(self, max: usize) -> RxBatchBuilder
        requires:
            max == 64

private class RxBatchBuilder:
    // Trusted helper surface. This is not an ordinary user class, and core code
    // cannot name or construct it. It is not a stream and does not loan the RX
    // path to the caller. The public RX stream starts only after seal returns
    // RxBatch and caller opens it with take.
    // Each non-predicate method advances the private builder state. Reusing the
    // source name is syntax for threading the returned state token through the
    // next call. predicate fn observes the current state and creates facts for
    // that exact state token, but does not advance it.
    // next_completion is finite: the builder has hidden remaining <= max, and
    // can produce Some(RxCompletion) at most max times before it must produce
    // None. Once None is observed, the builder is exhausted and may only be
    // sealed or closed; polling it again does not typecheck. Because Option
    // lifts affine kind, Option[RxCompletion] is itself a single-use affine
    // value.
    predicate fn can_insert(self, descriptor: RxDescriptor) -> bool

    private platform fn next_completion(self) -> Option[RxCompletion]

    private platform fn sync_for_cpu(
        self,
        consume completion: RxCompletion,
    ) -> SyncedRxBuffer

    private platform fn quarantine(self, consume completion: RxCompletion)

    private platform fn return_synced(self, consume ready: SyncedRxBuffer)

    // attach_readable consumes a synced descriptor and appends one core-facing
    // ReadableBuffer to the builder. The minted buffer has len=ready.written_len
    // and capacity=ready.capacity; descriptor identity stays hidden as edge
    // provenance for later RX return/drop.
    private platform fn attach_readable(
        self,
        consume ready: SyncedRxBuffer,
    )
        requires:
            self.can_insert(descriptor=ready.descriptor)
            ready.written_len <= ready.capacity

    // Private stream constructor. Legal only as the tail return expression of
    // NetworkRx.receive or another stream-producing edge function.
    private platform fn seal(consume self) -> RxBatch

edge class NetworkTx:
    // The TX path owns transmit descriptor management.

    // acquire_tx returns a CPU-owned TX buffer if the driver has one available.
    // Multiple TX buffers may be outstanding at once. Each claimed TxSlot is a
    // sealed unique token with trusted capacity metadata; mint_writable consumes
    // that slot into one WritableBuffer. Its send length is provided later by
    // terminal fn send.
    // WritableBuffer tracks initialized_prefix: the contiguous initialized byte
    // range [0, initialized_prefix). Sparse writes do not advance this prefix.
    fn acquire_tx(self) -> Option[WritableBuffer]:
        if let slot = self.claim_tx_slot():
            return Some(self.mint_writable(slot=slot))

        return None

    private platform fn claim_tx_slot(self) -> Option[TxSlot]

    // Private edge-internal minting. WritableBuffer carries hidden slot identity
    // so publish_tx can publish the exact descriptor that was claimed. New TX
    // buffers preserve slot.capacity and always start with initialized_prefix == 0.
    private platform fn mint_writable(
        self,
        consume slot: TxSlot,
    ) -> WritableBuffer

    // send moves a finished TX buffer back to the driver/device path.
    // The terminal body must prove len <= buffer.initialized_prefix before
    // publishing the descriptor to the device. Writing contiguous bytes from
    // offset 0 grows the initialized prefix; sparse writes do not.
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        requires:
            len <= buffer.initialized_prefix

        self.publish_tx(buffer=buffer, len=len)

    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
        requires:
            len <= buffer.initialized_prefix

    // flush publishes any queued descriptor changes to the device.
    fn flush(self)

edge class NetworkWake:
    // Wake is the only capability the terminal image loop may yield on.
    // yield borrows wake from the scheduler and resumes with the same capability.

interface CoreMovableOwned:
    // Static marker interface. The compiler derives this for ordinary owned
    // classes and dataclasses whose fields are also core-movable owned values.
    // It is not implemented by stream/session tokens, validated buffers, edge
    // paths, private state tokens, or sealed platform tokens.

interface Runnable:
    // Static interface. A worker moved into Core.pin must own all state needed
    // by its run loop. After pinning, the caller cannot access the worker or any
    // affine fields stored inside it.
    fn run(self) -> Never

class CoreSet:
    core0: Core
    core1: Core

unique edge class CpuTopology:
    // A CPU topology root is unique machine authority for core paths.
    // Splitting consumes it and mints affine Core path capabilities.
    fn split(consume self) -> CoreSet

edge class Core:
    // pin moves a whole Runnable worker onto this core. This is an ordinary edge
    // method with explicit consume arguments; no extra function kind is needed.
    // The Core path is consumed so the same core cannot be pinned twice.
    fn pin[T: Runnable](consume self, consume worker: T)

class MoveRingPaths[T: CoreMovableOwned]:
    producer: MoveRingProducer[T]
    consumer: MoveRingConsumer[T]

class MoveRing[T: CoreMovableOwned]:
    // Bounded static-memory channel for cross-core moves. No ambient heap grows
    // behind the ring; capacity is part of the constructed object. T must be a
    // core-movable owned type, not a live session token.
    constructor fn new(max: usize) -> MoveRing[T]

    fn split(consume self) -> MoveRingPaths[T]

edge class MoveRingProducer[T: CoreMovableOwned]:
    // Ok consumes item into the ring. Err returns item to the producer so no
    // affine value is dropped on a full ring.
    fn push(self, consume item: T) -> Result[TransferOk, T]

edge class MoveRingConsumer[T: CoreMovableOwned]:
    // pop moves ownership of an item onto the consumer's current core.
    fn pop(self) -> Option[T]

class PacketCounter:
    rx: NetworkRx
    tx: NetworkTx
    wake: NetworkWake
    limits: PacketLimits
    ping_count: u64
    data_count: u64
    ignored_count: u64
    rejected_count: u64

    constructor fn new(paths: NetworkPaths) -> PacketCounter:
        return PacketCounter(
            rx=paths.rx,
            tx=paths.tx,
            wake=paths.wake,
            limits=PacketLimits(max_frame_bytes=1500),
            ping_count=0,
            data_count=0,
            ignored_count=0,
            rejected_count=0,
        )

    fn tick(self):
        // receive exposes at most 64 completed buffers through RxBatch.
        // The stream is a bounded one-shot view over existing driver queue memory.
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    let validation = Packet.validate(
                        source=buffer,
                        limits=self.limits,
                    )

                    match validation:
                        case Ok(packet):
                            // Packet is session-bound. handle_packet may read
                            // derived fields, but cannot store or return packet.
                            self.handle_packet(packet=packet)
                            batch.return_rx(packet=packet)

                        case Err(rejected):
                            self.rejected_count = u64.saturating_add(
                                lhs=self.rejected_count,
                                rhs=1,
                            )
                            batch.drop_rx(buffer=buffer, rejected=rejected)

        self.tx.flush()

    fn handle_packet(self, packet: Packet):
        match packet.kind:
            case PacketKind.ping:
                self.ping_count = u64.saturating_add(
                    lhs=self.ping_count,
                    rhs=1,
                )
                self.send_status(value=1)

            case PacketKind.data:
                self.data_count = u64.saturating_add(
                    lhs=self.data_count,
                    rhs=1,
                )
                self.send_status(value=2)

            case PacketKind.ignored:
                self.ignored_count = u64.saturating_add(
                    lhs=self.ignored_count,
                    rhs=1,
                )

    fn send_status(self, value: u8):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                if buffer.capacity < 1:
                    // The edge path still gets the buffer back even when it
                    // cannot hold the response shape we want.
                    self.tx.send(buffer=buffer, len=0)
                    return

                buffer.write_u8(offset=0, value=value)
                self.tx.send(buffer=buffer, len=1)

    fn wait(self):
        yield self.wake

uefi image PacketCounterImage:
    devices:
        net0: NetworkDevice

    private fn bringup(firmware: UefiFirmware) -> Result[Machine, BootError]:
        firmware.reserve_restricted_memory()? BootError.Memory

        let devices = firmware.discover_virtio()? BootError.DeviceDiscovery

        let net0 = firmware.bind_virtio_net(
            device=devices.net0,
            name="net0",
        )? BootError.DeviceUnavailable

        // plan_machine is an Attempt. Success consumes net0 into machine_plan.
        // Err returns, retains, or reclaims supplied capabilities through
        // firmware, so this `?` does not drop net0.
        let machine_plan = firmware.plan_machine(
            devices={
                net0: net0,
            },
        )? BootError.MachinePlanFailed

        // exit is also an Attempt. Success consumes machine_plan into Machine.
        // Err retains or discharges machine_plan through firmware.
        return firmware.exit(machine_plan=machine_plan)? BootError.ExitFailed

    fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
        let machine = bringup(firmware=firmware)?

        let paths = machine.devices.net0.split()
        let app = PacketCounter.new(paths=paths)

        loop:
            app.tick()
            app.wait()
```
