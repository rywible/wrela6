# Invalid Programs

Every fragment in this document is intentionally invalid. The goal is to stress
test the language invariants from `happy.md` and make the compiler's rejection
surface concrete.

These examples are not syntax tests for polish. They are invariant tests: each
program should fail because it attempts to forge, alias, leak, reuse, misroute,
or publish a capability that the language model says must be tracked.

## Sealed Tokens

### Invalid: core code cannot construct a readable buffer

```wr
class App:
    fn fake(self) -> ReadableBuffer:
        return ReadableBuffer(
            len=64,
            capacity=2048,
        )
```

Reject because `ReadableBuffer` is a sealed affine token. Only private
edge-internal minting helpers can create it from trusted descriptor tokens.

### Invalid: core code cannot construct a writable buffer

```wr
class App:
    fn fake(self) -> WritableBuffer:
        return WritableBuffer(
            capacity=4096,
            initialized_prefix=4096,
        )
```

Reject because `WritableBuffer` is sealed. The initialized prefix cannot be
forged by ordinary code.

### Invalid: edge code cannot construct a writable buffer with a literal either

```wr
edge class BadTx:
    fn acquire(self) -> Option[WritableBuffer]:
        return Some(WritableBuffer(
            capacity=4096,
            initialized_prefix=0,
        ))
```

Reject because even edge code must mint sealed tokens through private
edge-internal helpers that preserve slot identity.

### Invalid: validated buffers cannot be constructed by ordinary literals

```wr
class App:
    fn fake_packet(self) -> Packet:
        return Packet(
            kind=PacketKind.data,
            payload_len=12,
        )
```

Reject because `Packet` is a validated buffer. Only `Packet.validate(...)` can
mint it.

### Invalid: rejection data is not ownership

```wr
class App:
    fn fake_reject(self) -> PacketReject:
        return PacketReject(error=PacketError.malformed)

    fn close(self, batch: RxBatch):
        let rejected = self.fake_reject()
        batch.drop_rx(buffer=rejected, rejected=rejected)
```

Reject because `PacketReject` is ordinary forgeable data. It does not carry a
buffer obligation.

### Invalid: private minting helpers are not callable from core code

```wr
class App:
    fn fake(self, builder: RxBatchBuilder, ready: SyncedRxBuffer):
        builder.attach_readable(ready=ready)
```

Reject because `RxBatchBuilder` is private edge-internal state and
`attach_readable` is private edge-internal minting.

### Invalid: private platform functions are not callable from core code

```wr
class App:
    fn publish(self, batch: RxBatch, packet: Packet):
        batch.publish_packet_rx(packet=packet)
```

Reject because platform functions are private trusted boundaries.

### Invalid: platform functions cannot appear in ordinary classes

```wr
class App:
    private platform fn poke_mmio(self)
```

Reject because platform functions are only allowed inside edge classes and
other trusted runtime surfaces defined by the core language.

### Invalid: slot tokens cannot be forged

```wr
class App:
    fn fake_slot(self) -> TxSlot:
        return TxSlot(index=0)
```

Reject because `TxSlot` is a sealed platform token.

### Invalid: completion tokens cannot be forged

```wr
class App:
    fn fake_completion(self) -> RxCompletion:
        return RxCompletion(
            descriptor=RxDescriptor(index=0),
            written_len=128,
        )
```

Reject because `RxCompletion` and `RxDescriptor` are sealed platform tokens.

## Unique Edge Roots And Edge Paths

### Invalid: unique edge devices cannot be constructed by ordinary code

```wr
class App:
    fn fake(self) -> NetworkDevice:
        return NetworkDevice()
```

Reject because unique edge root instances come from image/device binding or
bringup, not constructors.

### Invalid: two fields cannot hold the same unique edge root

```wr
class TwoNics:
    a: NetworkDevice
    b: NetworkDevice

    constructor fn new(device: NetworkDevice) -> TwoNics:
        return TwoNics(
            a=device,
            b=device,
        )
```

Reject because unique edge roots are affine capabilities and cannot be
duplicated.

### Invalid: using a consumed device after split

```wr
fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
    let machine = bringup(firmware=firmware)?
    let paths = machine.devices.net0.split()

    machine.devices.net0.split()

    loop:
        yield paths.wake
```

Reject because `split(consume self)` consumes `machine.devices.net0`.

### Invalid: splitting the same device twice

```wr
fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
    let machine = bringup(firmware=firmware)?

    let paths_a = machine.devices.net0.split()
    let paths_b = machine.devices.net0.split()

    loop:
        yield paths_a.wake
```

Reject because the first split consumes the device.

### Invalid: storing the same path twice

```wr
class BadPaths:
    rx_a: NetworkRx
    rx_b: NetworkRx

    constructor fn new(paths: NetworkPaths) -> BadPaths:
        return BadPaths(
            rx_a=paths.rx,
            rx_b=paths.rx,
        )
```

Reject because `paths.rx` is an affine edge path.

### Invalid: using constructor-consumed paths after construction

```wr
fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
    let machine = bringup(firmware=firmware)?
    let paths = machine.devices.net0.split()
    let app = PacketCounter.new(paths=paths)

    paths.tx.flush()

    loop:
        app.tick()
```

Reject because `constructor fn new(paths=...)` consumes stored affine fields.

### Invalid: two image declarations binding the same device name

```wr
uefi image BadImage:
    devices:
        net0: NetworkDevice
        net0: NetworkDevice
```

Reject because each bound unique edge device name must be unique in the image
graph.

### Invalid: binding an edge path as an image device

```wr
uefi image BadImage:
    devices:
        rx0: NetworkRx
```

Reject because image device bindings mint unique edge root classes. Edge path
classes such as `NetworkRx` are minted by root driver APIs like
`NetworkDevice.split(...)`.

### Invalid: core paths cannot be constructed by ordinary code

```wr
class App:
    fn fake(self) -> Core:
        return Core()
```

Reject because `Core` is an affine edge path minted by `CpuTopology.split(...)`,
not an ordinary constructible class.

### Invalid: binding a core path as an image device

```wr
uefi image BadImage:
    devices:
        core1: Core
```

Reject because image bindings mint unique edge root classes such as
`CpuTopology`, not edge path classes such as `Core`.

## Receiver And Move Rules

### Invalid: implicit copy of an affine value

```wr
class App:
    fn dup(self, buffer: WritableBuffer):
        let a = buffer
        let b = buffer
        self.use_tx(buffer=a)
        self.use_tx(buffer=b)
```

Reject because sealed affine tokens cannot be copied.

### Invalid: use after move

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                self.tx.send(buffer=buffer, len=0)
                buffer.write_u8(offset=0, value=1)
```

Reject because `send` consumes `buffer`.

### Invalid: consume self then use self

```wr
class Worker:
    fn stop(consume self):
        return

    fn bad(self):
        self.stop()
        self.stop()
```

Reject because `consume self` moves the receiver.

### Invalid: moving a field then using the whole object as if intact

```wr
class App:
    tx: NetworkTx
    wake: NetworkWake

    fn bad(self):
        let moved_tx = self.tx
        self.tick()
```

Reject because `self` is missing its `tx` field after the partial move.

### Invalid: ordinary functions cannot consume linear arguments accidentally

```wr
class App:
    tx: NetworkTx

    fn helper(self, buffer: WritableBuffer):
        self.tx.send(buffer=buffer, len=0)
```

Reject because ordinary `fn` parameters are session-bound by default. A terminal
discharge requires a terminal function or an explicit consume path.

### Invalid: ordinary function stores a session-bound packet

```wr
class App:
    saved: Option[Packet]

    fn remember(self, packet: Packet):
        self.saved = Some(packet)
```

Reject because session-bound validated buffers cannot be stored.

### Invalid: ordinary function returns a session-bound packet

```wr
class App:
    fn identity(self, packet: Packet) -> Packet:
        return packet
```

Reject because ordinary `fn` cannot return a session-bound token.

## Stream And Session Rules

### Invalid: binding a stream-producing call before take

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        let pending = self.rx.receive()
        take pending as batch:
            for buffer in batch:
                take buffer:
                    batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
```

Reject because stream-producing calls are take-only expressions. `receive()`
must appear directly as the operand of `take`.

### Invalid: receiving twice through unopened stream values

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        let a = self.rx.receive()
        let b = self.rx.receive()

        take a as batch_a:
            for buffer in batch_a:
                take buffer:
                    batch_a.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
```

Reject because an unopened stream result cannot be bound at all. The RX loan
opens atomically with `take self.rx.receive() as ...`, so there is no gap where
callers can collect pending stream values.

### Invalid: dropping an unopened stream result

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        let pending = self.rx.receive()
        return
```

Reject because stream-producing calls cannot be bound, and a stream session
cannot be silently dropped.

### Invalid: storing an unopened stream result

```wr
class App:
    rx: NetworkRx
    saved: Option[RxBatch]

    fn bad(self):
        self.saved = Some(self.rx.receive())
```

Reject because streams are take-only session values, not ordinary values that
can enter `Option` or object state.

### Invalid: returning an unopened stream result

```wr
class App:
    rx: NetworkRx

    fn bad(self) -> RxBatch:
        return self.rx.receive()
```

Reject because stream-producing calls must be opened by `take` at the call site.
They cannot be returned to open later.

### Invalid: calling receive twice while the first stream is open

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as a:
            take self.rx.receive() as b:
                for buffer in b:
                    take buffer:
                        b.drop_rx(
                            buffer=buffer,
                            rejected=PacketReject(error=PacketError.malformed),
                        )
```

Reject because `self.rx` is loaned to stream `a`.

### Invalid: touching the loaned RX path directly

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            let again = self.rx.receive()
```

Reject because `NetworkRx` cannot be touched directly while its stream loan is
open.

### Invalid: returning a stream

```wr
class App:
    rx: NetworkRx

    fn leak(self) -> RxBatch:
        take self.rx.receive() as batch:
            return batch
```

Reject because streams are one-shot session values and cannot escape their
`take` scope.

### Invalid: storing a stream

```wr
class App:
    rx: NetworkRx
    saved: Option[RxBatch]

    fn bad(self):
        take self.rx.receive() as batch:
            self.saved = Some(batch)
```

Reject because streams cannot be stored.

### Invalid: copying a stream

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            let also_batch = batch
            for buffer in batch:
                take buffer:
                    also_batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
```

Reject because streams are affine and cannot be copied.

### Invalid: indexing a stream

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            let first = batch[0]
```

Reject because streams cannot be indexed. They only move-yield each item once.

### Invalid: iterating a stream twice

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )

            for buffer in batch:
                take buffer:
                    batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
```

Reject because a stream is one-shot.

### Invalid: copying a yielded buffer

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                let a = buffer
                let b = buffer
                take a:
                    batch.drop_rx(
                        buffer=a,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
                take b:
                    batch.drop_rx(
                        buffer=b,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
```

Reject because yielded buffers are unique affine obligations.

### Invalid: closing a yielded buffer through the wrong batch

```wr
class App:
    rx_a: NetworkRx
    rx_b: NetworkRx

    fn bad(self):
        take self.rx_a.receive() as a:
            take self.rx_b.receive() as b:
                for buffer in a:
                    take buffer:
                        b.drop_rx(
                            buffer=buffer,
                            rejected=PacketReject(error=PacketError.malformed),
                        )
```

Reject because the buffer belongs to stream session `a`, not `b`.

### Invalid: returning a packet through the wrong batch

```wr
class App:
    rx_a: NetworkRx
    rx_b: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx_a.receive() as a:
            take self.rx_b.receive() as b:
                for buffer in a:
                    take buffer:
                        match Packet.validate(source=buffer, limits=self.limits):
                            case Ok(packet):
                                b.return_rx(packet=packet)
                            case Err(rejected):
                                a.drop_rx(buffer=buffer, rejected=rejected)
```

Reject because the validated packet retains the membership of the source buffer.

### Invalid: closing the same buffer twice

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
                    batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
```

Reject because the first terminal call consumes `buffer`.

### Invalid: using a buffer after terminal close

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
                    let n = buffer.len
```

Reject because terminal close invalidates the token.

### Invalid: forgetting to close a yielded buffer

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    let n = buffer.len
```

Reject because every yielded buffer must be closed exactly once.

### Invalid: breaking with a live buffer obligation

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    break
```

Reject because `break` cannot cross a live linear obligation.

### Invalid: returning with a live stream item

```wr
class App:
    rx: NetworkRx

    fn bad(self) -> usize:
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    return buffer.len
```

Reject because `return` would leave the buffer undisposed.

### Invalid: yielding with a live buffer obligation

```wr
class App:
    rx: NetworkRx
    wake: NetworkWake

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    yield self.wake
```

Reject because `yield` is only legal when no linear obligations are live.

### Invalid: yielding with a live stream loan

```wr
class App:
    rx: NetworkRx
    wake: NetworkWake

    fn bad(self):
        take self.rx.receive() as batch:
            yield self.wake
```

Reject because the receive stream loan is live.

## Validation Rules

### Invalid: storing a validation result

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits
    saved: Option[Validation[Packet, PacketReject, ReadableBuffer]]

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    let result = Packet.validate(source=buffer, limits=self.limits)
                    self.saved = Some(result)
```

Reject because `Validation` is single-use and cannot be stored.

### Invalid: returning a validation result

```wr
class App:
    limits: PacketLimits

    fn validate_later(self, buffer: ReadableBuffer)
        -> Validation[Packet, PacketReject, ReadableBuffer]:
        return Packet.validate(source=buffer, limits=self.limits)
```

Reject because `Validation` cannot escape the source buffer's `take` scope.

### Invalid: binding a validation result without matching it

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    let result = Packet.validate(source=buffer, limits=self.limits)
                    self.log(message="not handling it")
```

Reject because a named `Validation` binding is legal only when it is consumed by
exactly one exhaustive match inside the source buffer's `take` scope.

### Invalid: matching a validation result twice

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    let result = Packet.validate(source=buffer, limits=self.limits)

                    match result:
                        case Ok(packet):
                            batch.return_rx(packet=packet)
                        case Err(rejected):
                            batch.drop_rx(buffer=buffer, rejected=rejected)

                    match result:
                        case Ok(packet):
                            self.count(packet=packet)
                        case Err(rejected):
                            self.log(rejected=rejected)
```

Reject because `Validation` is single-use.

### Invalid: using source buffer after successful validation

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    match Packet.validate(source=buffer, limits=self.limits):
                        case Ok(packet):
                            let n = buffer.len
                            batch.return_rx(packet=packet)

                        case Err(rejected):
                            batch.drop_rx(buffer=buffer, rejected=rejected)
```

Reject because validation success consumes the source buffer into `Packet`.

### Invalid: returning source buffer after successful validation

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    match Packet.validate(source=buffer, limits=self.limits):
                        case Ok(packet):
                            batch.drop_rx(
                                buffer=buffer,
                                rejected=PacketReject(error=PacketError.malformed),
                            )

                        case Err(rejected):
                            batch.drop_rx(buffer=buffer, rejected=rejected)
```

Reject because the `Ok` branch no longer owns `buffer`.

### Invalid: returning packet on validation failure

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    match Packet.validate(source=buffer, limits=self.limits):
                        case Ok(packet):
                            batch.return_rx(packet=packet)

                        case Err(rejected):
                            batch.return_rx(packet=packet)
```

Reject because `packet` is not bound in the `Err` branch.

### Invalid: ignoring validation failure and leaving source live

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    match Packet.validate(source=buffer, limits=self.limits):
                        case Ok(packet):
                            batch.return_rx(packet=packet)

                        case Err(rejected):
                            self.log(rejected=rejected)
```

Reject because the `Err` branch still owns `buffer` and must close it.

### Invalid: treating validation like an Option

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    if let packet = Packet.validate(source=buffer, limits=self.limits):
                        batch.return_rx(packet=packet)
```

Reject because `Validation` must be exhaustively matched as `Ok` or `Err`.

### Invalid: non-exhaustive validation match

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    match Packet.validate(source=buffer, limits=self.limits):
                        case Ok(packet):
                            batch.return_rx(packet=packet)
```

Reject because validation matches must be exhaustive and the `Err` path owns the
source buffer.

### Invalid: constructing a PacketReject with hidden ownership

```wr
dataclass PacketReject:
    error: PacketError
    buffer: ReadableBuffer
```

Reject because ordinary dataclasses cannot contain sealed buffer obligations.
Rejection data is not the ownership channel.

## Validated Buffer Layout Rules

### Invalid: reading a dynamic field before proving fixed fields fit

```wr
validated buffer BadPacket:
    layout:
        payload_len: u8 at 1
        payload: bytes at 2 len usize(payload_len)

    require:
        payload[0] == 1 else PacketReject(error=PacketError.malformed)
        source.len >= 2 else PacketReject(error=PacketError.too_short)
```

Reject because fixed-field fit must be proven before derived dynamic reads.

### Invalid: layout arithmetic without checked validation

```wr
validated buffer BadPacket:
    layout:
        count: usize at 0
        bytes: bytes at 8 len count * 64

    require:
        layout.fits else PacketReject(error=PacketError.malformed)
```

Reject because validator-critical dynamic arithmetic must be checked or generated
by the validated-buffer layout system.

### Invalid: reading undeclared trailing bytes

```wr
class App:
    fn bad(self, packet: Packet):
        let tail = packet.trailing_bytes
```

Reject because `layout.fits` is a containment proof. Packets may have trailing
bytes after the declared payload, but those bytes remain opaque unless the
validated-buffer schema declares them.

### Invalid: require returns the wrong error type

```wr
validated buffer BadPacket:
    layout:
        kind: u8 at 0

    require:
        source.len >= 1 else PacketError.too_short
```

Reject because every `require` branch must return the validator's rejection type.

### Invalid: a validated buffer with mutable foreign fields

```wr
validated buffer MutablePacket:
    layout:
        kind: u8 at 0

    fn set_kind(self, kind: u8):
        self.kind = kind
```

Reject because validated buffers expose checked views, not mutable ordinary
fields.

### Invalid: a validated buffer method

```wr
validated buffer PacketWithMethod:
    layout:
        kind: u8 at 0

    fn helper(self) -> u8:
        return self.kind
```

Reject because validated buffers are declarative schema only. Behavior belongs
in classes or free functions.

### Invalid: dataclass contains a validated buffer

```wr
dataclass Saved:
    packet: Packet
```

Reject because dataclasses are copy-safe value aggregates and cannot contain
session-bound sealed tokens.

### Invalid: dataclass contains static or edge memory

```wr
dataclass Saved:
    buffer: WritableBuffer
```

Reject because dataclasses cannot contain linear memory tokens.

## Terminal Function Rules

### Invalid: terminal function does not discharge

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        return
```

Reject because terminal functions must discharge their linear argument into a
platform function or another terminal function.

### Invalid: terminal function can branch without discharge

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        if len == 0:
            return

        self.publish_tx(buffer=buffer, len=len)

    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
```

Reject because the `len == 0` path leaves `buffer` undisposed.

### Invalid: terminal recursion

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        self.send(buffer=buffer, len=len)
```

Reject because terminal control flow must be acyclic.

### Invalid: terminal cycle through another terminal fn

```wr
edge class BadTx:
    terminal fn a(self, buffer: WritableBuffer):
        self.b(buffer=buffer)

    terminal fn b(self, buffer: WritableBuffer):
        self.a(buffer=buffer)
```

Reject because terminal discharge graphs must be acyclic.

### Invalid: terminal function calls ordinary function to discharge

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        self.helper(buffer=buffer, len=len)

    fn helper(self, buffer: WritableBuffer, len: usize):
        self.publish_tx(buffer=buffer, len=len)

    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
```

Reject because terminal discharge must remain in terminal functions or platform
functions. Ordinary functions cannot smuggle ownership closure.

### Invalid: terminal function stores the token before discharge

```wr
edge class BadTx:
    saved: Option[WritableBuffer]

    terminal fn send(self, buffer: WritableBuffer, len: usize):
        self.saved = Some(buffer)
```

Reject because terminal functions close obligations; they do not store them.

### Invalid: terminal function consumes the same token twice

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        self.publish_tx(buffer=buffer, len=len)
        self.publish_tx(buffer=buffer, len=len)

    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
```

Reject because the first platform call consumes `buffer`.

## Platform Requires Rules

### Invalid: platform typestate transition without consume

```wr
edge class BadRx:
    private platform fn sync_for_cpu(
        self,
        completion: RxCompletion,
    ) -> SyncedRxBuffer
```

Reject because a platform function that changes ownership or typestate of a
sealed affine token must mark that token `consume`.

### Invalid: platform call without proving value precondition

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        self.publish_tx(buffer=buffer, len=len)

    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
        requires:
            len <= buffer.initialized_prefix
```

Reject because `send` has not proven `len <= buffer.initialized_prefix`.

### Invalid: proving the wrong value

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        if len <= buffer.capacity:
            self.publish_tx(buffer=buffer, len=len)

    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
        requires:
            len <= buffer.initialized_prefix
```

Reject because capacity is not initialization.

### Invalid: platform requires cannot be satisfied by comments

```wr
edge class BadTx:
    terminal fn send(self, buffer: WritableBuffer, len: usize):
        // len is definitely initialized.
        self.publish_tx(buffer=buffer, len=len)

    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
        requires:
            len <= buffer.initialized_prefix
```

Reject because `requires` needs compiler-visible facts.

### Invalid: platform functions cannot declare runtime validation with ensures

```wr
edge class BadTx:
    private platform fn claim_tx_slot(self) -> Option[TxSlot]
        ensures:
            result.Some.is_fresh
```

Reject because platform functions do not use `ensures`. Trusted return facts must
be encoded in sealed token types.

### Invalid: requires on hidden provenance facts

```wr
edge class BadTx:
    private platform fn publish_tx(self, consume buffer: WritableBuffer, len: usize)
        requires:
            buffer.origin == self
            len <= buffer.initialized_prefix
```

Reject because hidden provenance is compiler-tracked, not source-visible.
`requires` is for value facts.

### Invalid: requires calls an ordinary function

```wr
edge class BadRx:
    fn can_insert(self, descriptor: RxDescriptor) -> bool:
        return true

    private platform fn attach_readable(
        self,
        consume ready: SyncedRxBuffer,
    )
        requires:
            self.can_insert(descriptor=ready.descriptor)
```

Reject because `requires` may call only `predicate fn`, not ordinary functions.

### Invalid: predicate mutates state

```wr
private class BadBuilder:
    count: usize

    predicate fn can_insert(self, descriptor: RxDescriptor) -> bool:
        self.count = usize.saturating_add(lhs=self.count, rhs=1)
        return true
```

Reject because `predicate fn` must be pure proof code. It cannot mutate state.

### Invalid: requires calls a platform function

```wr
edge class BadTx:
    private platform fn read_slot_capacity(self, slot: TxSlot) -> usize

    private platform fn mint_writable(
        self,
        consume slot: TxSlot,
        capacity: usize,
    ) -> WritableBuffer
        requires:
            capacity == self.read_slot_capacity(slot=slot)
```

Reject because `requires` may not call platform functions. Trusted capacity
must live on the sealed token or be proven in checked code.

### Invalid: calling private platform functions from outside their edge

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        let slot = self.tx.claim_tx_slot()
```

Reject because `claim_tx_slot` is private platform code.

## TX Initialization Rules

### Invalid: sending capacity bytes without writing them

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                self.tx.send(buffer=buffer, len=buffer.capacity)
```

Reject because `acquire_tx` mints a buffer with `initialized_prefix == 0`.

### Invalid: sparse write does not initialize the prefix

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                buffer.write_u8(offset=99, value=1)
                self.tx.send(buffer=buffer, len=100)
```

Reject because writing byte 99 does not initialize bytes 0 through 98.

### Invalid: writing past capacity

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                buffer.write_u8(offset=buffer.capacity, value=1)
                self.tx.send(buffer=buffer, len=1)
```

Reject because offset `capacity` is out of bounds.

### Invalid: unchecked dynamic write length

```wr
class App:
    tx: NetworkTx

    fn bad(self, len: usize):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                buffer.write_bytes(offset=0, len=len, value=0)
                self.tx.send(buffer=buffer, len=len)
```

Reject because `len <= buffer.capacity` is not proven before the write.

### Invalid: checked capacity does not imply initialized bytes after no write

```wr
class App:
    tx: NetworkTx

    fn bad(self, len: usize):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                if len <= buffer.capacity:
                    self.tx.send(buffer=buffer, len=len)
```

Reject because capacity does not initialize memory.

### Invalid: zero-length send after moving buffer and then using it

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                self.tx.send(buffer=buffer, len=0)
                self.tx.send(buffer=buffer, len=0)
```

Reject because the first send consumes the buffer.

### Invalid: writing after send

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                buffer.write_u8(offset=0, value=1)
                self.tx.send(buffer=buffer, len=1)
                buffer.write_u8(offset=0, value=2)
```

Reject because `buffer` is invalid after terminal send.

### Invalid: sending through the wrong TX path

```wr
class App:
    tx_a: NetworkTx
    tx_b: NetworkTx

    fn bad(self):
        if let buffer = self.tx_a.acquire_tx():
            take buffer:
                buffer.write_u8(offset=0, value=1)
                self.tx_b.send(buffer=buffer, len=1)
```

Reject because the buffer was minted by `tx_a`, not `tx_b`.

## RX Edge Internals

### Invalid: minting readable before validating descriptor length

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            let ready = builder.sync_for_cpu(completion=completion)

            builder.attach_readable(ready=ready)

        return builder.seal()
```

Reject because `attach_readable` requires visible proofs for
`builder.can_insert(...)` and `ready.written_len <= ready.capacity`.

### Invalid: quarantine without leaving failing path

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            if completion.written_len > completion.capacity:
                builder.quarantine(completion=completion)

            let ready = builder.sync_for_cpu(completion=completion)
            builder.attach_readable(ready=ready)

        return builder.seal()
```

Reject because the failing branch does not `continue`, `return`, or otherwise
leave the path before using a consumed/quarantined completion.

### Invalid: sync after completion was consumed by quarantine

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            builder.quarantine(completion=completion)
            let ready = builder.sync_for_cpu(completion=completion)

        return builder.seal()
```

Reject because `quarantine` consumes the completion.

### Invalid: attaching the same synced buffer twice

```wr
edge class BadRx:
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
            builder.attach_readable(ready=ready)

        return builder.seal()
```

Reject because the first attach consumes `ready` into the builder.

### Invalid: minting readable from unsynced DMA memory

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            if completion.written_len > completion.capacity:
                builder.quarantine(completion=completion)
                continue

            if not builder.can_insert(descriptor=completion.descriptor):
                builder.quarantine(completion=completion)
                continue

            builder.attach_readable(ready=completion)

        return builder.seal()
```

Reject because `attach_readable` accepts `SyncedRxBuffer`, not `RxCompletion`.

### Invalid: forging RX capacity with a scalar

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            if completion.written_len > completion.capacity:
                builder.quarantine(completion=completion)
                continue

            let fake_capacity = usize.max
            let ready = builder.sync_for_cpu(completion=completion)

            if not builder.can_insert(descriptor=ready.descriptor):
                builder.return_synced(ready=ready)
                continue

            builder.attach_readable(
                ready=ready,
                capacity=fake_capacity,
            )

        return builder.seal()
```

Reject because `attach_readable` has no scalar capacity parameter. Capacity is
trusted metadata carried by the sealed `SyncedRxBuffer`.

### Invalid: opening builder above the stream bound

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=128)
        return builder.seal()
```

Reject because `open_rx_builder` requires `max == 64`.

### Invalid: opening two RX builders at once

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let a = self.open_rx_builder(max=64)
        let b = self.open_rx_builder(max=64)

        return a.seal()
```

Reject because `RxBatchBuilder` is a linear edge-internal loan. The same RX path
cannot open another builder while one is live.

### Invalid: dropping a private RX builder without sealing it

```wr
edge class BadRx:
    fn bad(self):
        let builder = self.open_rx_builder(max=64)
        return
```

Reject because private builder state is affine and cannot be dropped. It must be
sealed into the public stream or otherwise closed by a checked edge operation.

### Invalid: copying a private RX builder

```wr
edge class BadRx:
    fn bad(self):
        let builder = self.open_rx_builder(max=64)
        let alias = builder

        builder.seal()
```

Reject because private classes are affine state tokens, not aliasable mutable
objects.

### Invalid: binding a private stream constructor result

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)
        let batch = builder.seal()

        return batch
```

Reject because private stream constructors may only appear in tail position of a
stream-producing edge function. `builder.seal()` cannot be bound as an ordinary
value.

### Invalid: polling a builder after exhaustion

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            builder.quarantine(completion=completion)

        let again = builder.next_completion()

        return builder.seal()
```

Reject because observing `None` at the end of the `while let` leaves the builder
in an exhausted state. It may be sealed, not polled again.

### Invalid: attaching without proving builder capacity

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)

        while let completion = builder.next_completion():
            if completion.written_len > completion.capacity:
                builder.quarantine(completion=completion)
                continue

            let ready = builder.sync_for_cpu(completion=completion)
            builder.attach_readable(ready=ready)

        return builder.seal()
```

Reject because `attach_readable` requires visible `builder.can_insert(...)`.

### Invalid: predicate fact from an old private builder state

```wr
private class BadBuilder:
    predicate fn can_insert(self, descriptor: RxDescriptor) -> bool
    private platform fn note_progress(self)

    private platform fn attach_readable(
        self,
        consume ready: SyncedRxBuffer,
    )
        requires:
            self.can_insert(descriptor=ready.descriptor)

edge class BadRx:
    fn bad(self, builder: BadBuilder, ready: SyncedRxBuffer):
        if builder.can_insert(descriptor=ready.descriptor):
            builder.note_progress()
            builder.attach_readable(ready=ready)
```

Reject because private builder methods advance the private state token.
Predicate facts proven for the previous builder state do not satisfy `requires`
on the later state.

### Invalid: returning a sealed completion from receive

```wr
edge class BadRx:
    fn leak(self) -> Option[RxCompletion]:
        let builder = self.open_rx_builder(max=64)
        return builder.next_completion()
```

Reject because sealed platform completion tokens cannot escape checked edge
logic.

## Control Flow And Obligations

### Invalid: `?` crosses a live buffer obligation

```wr
class App:
    tx: NetworkTx

    fn maybe_fail(self) -> Result[usize, BootError]

    fn bad(self) -> Result[usize, BootError]:
        if let buffer = self.tx.acquire_tx():
            take buffer:
                let n = self.maybe_fail()?
                self.tx.send(buffer=buffer, len=0)
                return Ok(n)

        return Ok(0)
```

Reject because `?` cannot cross the live `buffer` obligation.

### Invalid: returning an error with a live buffer

```wr
class App:
    tx: NetworkTx

    fn bad(self) -> Result[Never, BootError]:
        if let buffer = self.tx.acquire_tx():
            take buffer:
                return Err(BootError.DeviceUnavailable)

        loop:
            self.tx.flush()
```

Reject because the error path drops `buffer`.

### Invalid: continue crosses live buffer

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        loop:
            take self.rx.receive() as batch:
                for buffer in batch:
                    take buffer:
                        continue
```

Reject because `continue` would leave the buffer obligation live.

### Invalid: break crosses live stream loan

```wr
class App:
    rx: NetworkRx

    fn bad(self):
        loop:
            take self.rx.receive() as batch:
                break
```

Reject because `break` would exit while the stream loan is live.

### Invalid: panic with live obligation

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                panic("lost buffer")
```

Reject because `panic` is not an obligation-carrying effect in this model. It
cannot cross a live buffer obligation.

## Attempt And Boot Rules

### Invalid: fallible consume without an Attempt-like rule

```wr
private fn plan_machine_untyped(
    firmware: UefiFirmware,
    devices: { net0: NetworkDevice },
) -> Result[MachinePlan, BootError]

private fn bringup(firmware: UefiFirmware) -> Result[Machine, BootError]:
    let devices = firmware.discover_virtio()? BootError.DeviceDiscovery

    let net0 = firmware.bind_virtio_net(
        device=devices.net0,
        name="net0",
    )? BootError.DeviceUnavailable

    let machine_plan = plan_machine_untyped(
        firmware=firmware,
        devices={
            net0: net0,
        },
    )? BootError.MachinePlanFailed

    return firmware.exit(machine_plan=machine_plan)? BootError.ExitFailed
```

Reject because fallible calls that may consume affine inputs must be typed as an
Attempt: success consumes `net0`, and error must retain, return, or discharge it.

### Invalid: using a device after successful plan_machine consumes it

```wr
private fn bringup(firmware: UefiFirmware) -> Result[Machine, BootError]:
    let devices = firmware.discover_virtio()? BootError.DeviceDiscovery
    let net0 = firmware.bind_virtio_net(
        device=devices.net0,
        name="net0",
    )? BootError.DeviceUnavailable

    let machine_plan = firmware.plan_machine(
        devices={
            net0: net0,
        },
    )? BootError.MachinePlanFailed

    net0.split()

    return firmware.exit(machine_plan=machine_plan)? BootError.ExitFailed
```

Reject because successful `plan_machine` consumes `net0` into the machine plan.

### Invalid: using machine_plan after successful exit

```wr
private fn bringup(firmware: UefiFirmware) -> Result[Machine, BootError]:
    let machine_plan = firmware.plan_machine(devices={})? BootError.MachinePlanFailed
    let machine = firmware.exit(machine_plan=machine_plan)? BootError.ExitFailed

    machine_plan.debug()

    return machine
```

Reject because successful `exit` consumes `machine_plan`.

### Invalid: returning from boot after reaching Never loop contract

```wr
fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
    let machine = bringup(firmware=firmware)?
    return Ok()
```

Reject because `Never` cannot be constructed by returning normally.

### Invalid: boot does not handle bringup error

```wr
fn boot(firmware: UefiFirmware) -> Never:
    let machine = bringup(firmware=firmware)?

    loop:
        yield machine.devices.net0
```

Reject because `?` requires an error-compatible return type.

## Dataclass And Value Rules

### Invalid: dataclass method

```wr
dataclass Counter:
    value: u64

    fn increment(self):
        self.value = self.value + 1
```

Reject because dataclasses do not have methods.

### Invalid: dataclass contains edge capability

```wr
dataclass DeviceRecord:
    tx: NetworkTx
```

Reject because dataclasses are ordinary value aggregates and cannot contain edge
capabilities.

### Invalid: dataclass contains stream

```wr
dataclass SavedBatch:
    batch: RxBatch
```

Reject because streams cannot be stored or copied.

### Invalid: dataclass contains writable memory token

```wr
dataclass SavedWrite:
    buffer: WritableBuffer
```

Reject because writable memory tokens are affine obligations.

### Invalid: shadowing a live affine value

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                let buffer = 1
                self.tx.send(buffer=buffer, len=0)
```

Reject because shadowing is disallowed, and it would obscure the live obligation.

### Invalid: implicit null

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        let buffer: WritableBuffer = null
```

Reject because absence is modeled with `Option`, not null.

## Affine Wrapper Rules

### Invalid: dropping an Option that may contain a writable buffer

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        let maybe = self.tx.acquire_tx()
        return
```

Reject because `Option[WritableBuffer]` is affine. If `Some`, it contains a
live TX slot obligation, so the `Option` itself cannot be silently dropped.

### Invalid: storing an affine Option in ordinary state

```wr
class App:
    tx: NetworkTx
    saved: Option[WritableBuffer]

    fn bad(self):
        self.saved = self.tx.acquire_tx()
```

Reject because generic wrappers lift resource kind. `Option[WritableBuffer]`
is an affine obligation, not ordinary copy-safe state.

### Invalid: putting an affine Option into a list

```wr
class App:
    tx: NetworkTx
    saved: List[Option[WritableBuffer]]

    fn bad(self):
        let maybe = self.tx.acquire_tx()
        self.saved.push(item=maybe)
```

Reject because `List[Option[WritableBuffer]]` would need checked ownership and
terminal discharge rules. A normal list cannot hide a live device obligation.

### Invalid: discarding a maybe completion from a private builder

```wr
edge class BadRx:
    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)
        let maybe = builder.next_completion()
        return builder.seal()
```

Reject because `Option[RxCompletion]` is affine. It must be matched so any
`Some` completion is consumed by quarantine, sync, or another checked path.

### Invalid: storing a private completion option

```wr
edge class BadRx:
    saved: Option[RxCompletion]

    fn receive(self) -> RxBatch:
        let builder = self.open_rx_builder(max=64)
        self.saved = builder.next_completion()
        return builder.seal()
```

Reject because sealed platform tokens and wrappers containing them cannot be
stored in ordinary edge fields.

## Static Memory And Bounded Data

### Invalid: unbounded list

```wr
class App:
    fn bad(self):
        let headers = List()
```

Reject because local static memory must declare bounds.

### Invalid: list declaration inside a loop without static placement

```wr
class App:
    fn bad(self):
        loop:
            let headers = List(max=64)
            headers.push(item=1)
```

Reject because static memory declarations are not allowed inside loops. Declare
bounded memory on the worker or in a constructor-created object, then clear it
inside the loop.

### Invalid: using a list across ticks without clearing

```wr
class App:
    headers: List[u8]

    constructor fn new() -> App:
        return App(headers=List(max=64))

    fn tick(self):
        self.headers.push(item=1)
        self.parse(headers=self.headers)
```

Reject because `tick` can run repeatedly and `headers` is persistent static
memory. It must be cleared or use a data structure with an explicit overwrite or
eviction policy.

### Invalid: push beyond static capacity

```wr
class App:
    headers: List[u8]

    constructor fn new() -> App:
        return App(headers=List(max=4))

    fn bad(self):
        self.headers.clear()
        self.headers.push(item=1)
        self.headers.push(item=2)
        self.headers.push(item=3)
        self.headers.push(item=4)
        self.headers.push(item=5)
```

Reject because the fifth push exceeds the statically known capacity.

### Invalid: map without bound

```wr
class App:
    routes: Map[u8, u8]

    constructor fn new() -> App:
        return App(routes=Map())
```

Reject because maps must be capacity-bounded.

### Invalid: map insert beyond capacity without policy

```wr
class App:
    routes: Map[u8, u8]

    constructor fn new() -> App:
        return App(routes=Map(max=1))

    fn bad(self):
        self.routes.clear()
        self.routes.insert(key=1, value=1)
        self.routes.insert(key=2, value=2)
```

Reject because the second insert may exceed capacity unless the map type has a
specified eviction/drop policy.

## Multicore Ownership Transfer

### Invalid: pinning the same core twice

```wr
class Worker:
    constructor fn new() -> Worker:
        return Worker()

    fn run(self) -> Never:
        loop:
            // work forever

fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
    let machine = bringup(firmware=firmware)?
    let cores = machine.cpus.split()

    let a = Worker.new()
    let b = Worker.new()

    cores.core1.pin(worker=a)
    cores.core1.pin(worker=b)

    loop:
        // core0 work
```

Reject because `Core.pin(consume self, consume worker)` consumes the core path.
A core can only be pinned once.

### Invalid: using a worker after pinning it

```wr
class Worker:
    constructor fn new() -> Worker:
        return Worker()

    fn run(self) -> Never:
        loop:
            // work forever

fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
    let machine = bringup(firmware=firmware)?
    let cores = machine.cpus.split()
    let worker = Worker.new()

    cores.core1.pin(worker=worker)
    worker.run()
```

Reject because `pin` explicitly consumes `worker`. The worker and all affine
state inside it move onto the target core.

### Invalid: sharing one static collection between two pinned workers

```wr
class Worker:
    headers: List[u8]

    constructor fn new(headers: List[u8]) -> Worker:
        return Worker(headers=headers)

    fn run(self) -> Never:
        loop:
            self.headers.clear()

fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
    let machine = bringup(firmware=firmware)?
    let cores = machine.cpus.split()
    let headers = List(max=64)

    let a = Worker.new(headers=headers)
    let b = Worker.new(headers=headers)

    cores.core0.pin(worker=a)
    cores.core1.pin(worker=b)
```

Reject because static memory has one owner. Moving `headers` into worker `a`
prevents also moving it into worker `b`.

### Invalid: unbounded move ring

```wr
class App:
    fn bad(self):
        let ring = MoveRing[PacketReject].new()
```

Reject because cross-core transfer structures are bounded static memory and
must declare capacity.

### Invalid: splitting a move ring twice

```wr
class App:
    fn bad(self):
        let ring = MoveRing[PacketReject].new(max=64)
        let first = ring.split()
        let second = ring.split()
```

Reject because `MoveRing.split(consume self)` consumes the ring and mints one
producer/consumer pair.

### Invalid: move ring over a validated buffer

```wr
class App:
    fn bad(self):
        let ring = MoveRing[Packet].new(max=64)
```

Reject because `Packet` is a validated buffer session token and does not satisfy
`CoreMovableOwned`.

### Invalid: move ring over an edge-internal completion

```wr
edge class BadRx:
    fn bad(self):
        let ring = MoveRing[RxCompletion].new(max=64)
```

Reject because sealed platform tokens such as `RxCompletion` do not satisfy
`CoreMovableOwned`.

### Invalid: move ring over a validation result

```wr
class App:
    fn bad(self):
        let ring = MoveRing[
            Validation[Packet, PacketReject, ReadableBuffer]
        ].new(max=64)
```

Reject because `Validation[...]` is a single-use session result and does not
satisfy `CoreMovableOwned`.

### Invalid: move ring over a readable buffer

```wr
class App:
    fn bad(self):
        let ring = MoveRing[ReadableBuffer].new(max=64)
```

Reject because live buffer obligations do not satisfy `CoreMovableOwned`.

### Invalid: storing the same move-ring endpoint twice

```wr
class BadChannels:
    a: MoveRingProducer[PacketReject]
    b: MoveRingProducer[PacketReject]

    constructor fn new(paths: MoveRingPaths[PacketReject]) -> BadChannels:
        return BadChannels(
            a=paths.producer,
            b=paths.producer,
        )
```

Reject because ring endpoints are affine edge paths and cannot be duplicated.

### Invalid: ignoring a fallible move-ring push

```wr
class Job:
    value: u8

class App:
    outbox: MoveRingProducer[Job]

    fn bad(self, job: Job):
        let pushed = self.outbox.push(item=job)
        return
```

Reject because `push` returns `Result[TransferOk, Job]`. On `Err`, the job is
returned to the producer and must be handled; the result cannot be dropped.

### Invalid: using a moved item after successful push

```wr
class Job:
    value: u8

class App:
    outbox: MoveRingProducer[Job]

    fn bad(self, job: Job):
        let pushed = self.outbox.push(item=job)

        match pushed:
            case Ok(sent):
                self.log(value=job.value)
            case Err(returned):
                self.retry(job=returned)
```

Reject because `Ok` means the ring consumed `job` and ownership moved to the
consumer core.

### Invalid: sending a live stream buffer through a move ring

```wr
class App:
    rx: NetworkRx
    outbox: MoveRingProducer[ReadableBuffer]

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    let pushed = self.outbox.push(item=buffer)
```

Reject because a yielded `ReadableBuffer` is a live stream obligation. It must
be validated and returned/dropped through its `RxBatch`, not moved to another
core through a generic ring.

### Invalid: interface name as a value parameter type

```wr
edge class BadCore:
    fn pin(consume self, consume worker: Runnable)
```

Reject because interfaces are static constraints only. They may appear in type
parameter bounds like `T: Runnable`, not as ordinary parameter types.

## Edge/Core Separation

### Invalid: core class does MMIO

```wr
class App:
    fn bad(self, addr: usize, value: u32):
        mmio.write32(addr=addr, value=value)
```

Reject because hardware primitives live behind edge platform functions.

### Invalid: core class exposes device descriptor metadata

```wr
class App:
    fn bad(self, buffer: ReadableBuffer):
        let descriptor = buffer.descriptor
```

Reject because descriptor metadata is hidden edge state.

### Invalid: validated packet reads raw buffer bytes directly

```wr
class App:
    fn bad(self, packet: Packet):
        let raw = packet.source.read_u8(offset=0)
```

Reject because validated buffers expose declared fields, not raw source-buffer
access.

### Invalid: core code mutates packet bytes

```wr
class App:
    fn bad(self, packet: Packet):
        packet.write_u8(offset=0, value=0)
```

Reject because `Packet` is a read-only validated view over RX memory.

### Invalid: reading from a writable TX buffer as if initialized

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                let byte = buffer.read_u8(offset=0)
                self.tx.send(buffer=buffer, len=0)
```

Reject because newly acquired TX memory is not initialized for reads.

## Exhaustiveness And Names

### Invalid: non-exhaustive enum match

```wr
class App:
    fn bad(self, kind: PacketKind):
        match kind:
            case PacketKind.ping:
                self.count_ping()
```

Reject because `match` is exhaustive.

### Invalid: unreachable duplicate match case

```wr
class App:
    fn bad(self, kind: PacketKind):
        match kind:
            case PacketKind.ping:
                self.count_ping()
            case PacketKind.ping:
                self.count_ping_again()
            case PacketKind.data:
                self.count_data()
            case PacketKind.ignored:
                self.count_ignored()
```

Reject because duplicate cases make the second `PacketKind.ping` unreachable.

### Invalid: shadowing a local

```wr
class App:
    fn bad(self):
        let count = 1
        let count = 2
```

Reject because shadowing is disallowed.

### Invalid: shadowing an imported core type

```wr
use Packet from core.net

dataclass Packet:
    value: u8
```

Reject because imported names cannot be shadowed.

### Invalid: ambiguous named arguments omitted

```wr
class App:
    fn send_status(self, value: u8)

    fn bad(self):
        self.send_status(1)
```

Reject because calls use named arguments everywhere.

### Invalid: mixed positional and named arguments

```wr
class App:
    fn write(self, offset: usize, value: u8)

    fn bad(self):
        self.write(0, value=1)
```

Reject because all call arguments must be named.

## Cross-Edge Misrouting

### Invalid: RX packet returned to TX

```wr
class App:
    rx: NetworkRx
    tx: NetworkTx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    match Packet.validate(source=buffer, limits=self.limits):
                        case Ok(packet):
                            self.tx.send(buffer=packet, len=1)
                        case Err(rejected):
                            batch.drop_rx(buffer=buffer, rejected=rejected)
```

Reject because `Packet` is an RX validated buffer, not a writable TX buffer.

### Invalid: TX buffer returned to RX

```wr
class App:
    rx: NetworkRx
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                take self.rx.receive() as batch:
                    batch.drop_rx(
                        buffer=buffer,
                        rejected=PacketReject(error=PacketError.malformed),
                    )
```

Reject because `buffer` is a TX writable buffer, not a readable buffer yielded
by `batch`.

### Invalid: re-entering a stream while one yielded item is live

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn bad(self):
        take self.rx.receive() as batch:
            for first in batch:
                take first:
                    match Packet.validate(source=first, limits=self.limits):
                        case Ok(packet):
                            batch.return_rx(packet=packet)
                        case Err(rejected):
                            for second in batch:
                                take second:
                                    batch.drop_rx(buffer=second, rejected=rejected)
```

Reject because a stream cannot be re-entered while iterating and `first` is
still live. `PacketReject` is only an ordinary reason payload; the live buffer
and batch session are what authorize `drop_rx`.

## Forbidden Runtime Escape Hatches

### Invalid: garbage collection of sealed tokens

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            gc.collect()
```

Reject because sealed affine obligations must be closed explicitly; no ambient
GC can discharge device ownership.

### Invalid: reference counting an edge capability

```wr
class App:
    fn bad(self, tx: NetworkTx):
        let shared = Rc.new(value=tx)
```

Reject because edge capabilities are affine ownership values and cannot enter
reference-counted containers.

### Invalid: ambient heap allocation of unbounded state

```wr
class App:
    fn bad(self):
        let bytes = Heap.allocate(size=self.read_user_size())
```

Reject because this model has no ambient heap. Memory must be statically
bounded, edge-owned, or explicitly planned.

### Invalid: dynamic dispatch over edge capabilities

```wr
interface Sender:
    fn send_any(self, buffer: WritableBuffer, len: usize)

class App:
    sender: dyn Sender
```

Reject because this model uses static monomorphization and does not allow
dynamic dispatch over ownership-sensitive edge capabilities.

### Invalid: higher-order function captures a linear token

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                let f = fn():
                    self.tx.send(buffer=buffer, len=0)
```

Reject because higher-order functions are not part of the model, and closures
would obscure terminal ownership.

## Nice-Looking But Still Invalid

### Invalid: closing in helper after validation

```wr
class App:
    rx: NetworkRx
    limits: PacketLimits

    fn close_packet(self, batch: RxBatch, packet: Packet):
        batch.return_rx(packet=packet)

    fn bad(self):
        take self.rx.receive() as batch:
            for buffer in batch:
                take buffer:
                    match Packet.validate(source=buffer, limits=self.limits):
                        case Ok(packet):
                            self.close_packet(batch=batch, packet=packet)
                        case Err(rejected):
                            batch.drop_rx(buffer=buffer, rejected=rejected)
```

Reject because ordinary functions cannot receive stream sessions or terminally
discharge session-bound tokens. Stream closure must happen in the active `take`
scope through the stream's terminal methods.

### Invalid: putting terminal logic behind an interface

```wr
interface PacketCloser:
    terminal fn close(self, packet: Packet)

class App:
    closer: PacketCloser
```

Reject because terminal dispatch must be statically known.

### Invalid: hidden close in destructor

```wr
class AutoClose:
    batch: RxBatch
    packet: Packet

    fn drop(self):
        self.batch.return_rx(packet=self.packet)
```

Reject because terminal discharge is explicit. Destructors cannot hide device
ownership transitions.

### Invalid: ignoring an acquired TX buffer because Option scope ends

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let buffer = self.tx.acquire_tx():
            take buffer:
                self.log(message="dropping it")
```

Reject because exiting the `take buffer` scope without `send` leaks the TX slot.

### Invalid: using a copied scalar length for a later buffer

```wr
class App:
    tx: NetworkTx
    copied_len: usize

    fn bad(self):
        if let first = self.tx.acquire_tx():
            take first:
                first.write_u8(offset=0, value=1)
                self.copied_len = first.initialized_prefix
                self.tx.send(buffer=first, len=1)

        if let second = self.tx.acquire_tx():
            take second:
                self.tx.send(buffer=second, len=self.copied_len)
```

Reject because `send` must prove `len <= second.initialized_prefix` for the
specific buffer being sent. A copied scalar length does not prove that the later
buffer has initialized bytes.

### Invalid: proving capacity on one buffer and sending another

```wr
class App:
    tx: NetworkTx

    fn bad(self):
        if let a = self.tx.acquire_tx():
            take a:
                if let b = self.tx.acquire_tx():
                    take b:
                        if a.capacity >= 1:
                            b.write_u8(offset=0, value=1)
                            self.tx.send(buffer=b, len=1)
                self.tx.send(buffer=a, len=0)
```

Reject because a fact about `a.capacity` does not prove `b.capacity >= 1`.
Multiple TX buffers may be outstanding, but proof facts stay attached to the
specific buffer token they came from.

### Invalid: packet escapes through ordinary value wrapping

```wr
class BoxedPacket:
    packet: Packet

    constructor fn new(packet: Packet) -> BoxedPacket:
        return BoxedPacket(packet=packet)
```

Reject because wrapping cannot make a session-bound token escape-safe.

### Invalid: packet escapes through a map

```wr
class App:
    packets: Map[usize, Packet]

    fn remember(self, packet: Packet):
        self.packets.insert(key=0, value=packet)
```

Reject because maps cannot store session-bound validated buffers.

### Invalid: readable buffer escapes through a list

```wr
class App:
    buffers: List[ReadableBuffer]

    fn remember(self, buffer: ReadableBuffer):
        self.buffers.push(item=buffer)
```

Reject because lists cannot store live linear obligations unless the list itself
is a checked linear owner with terminal discharge rules.

### Invalid: buffer token sent between images

```wr
class App:
    fn bad(self, packet: Packet):
        ipc.send(value=packet)
```

Reject because sealed memory tokens are image-local capabilities.

### Invalid: buffer token serialized

```wr
class App:
    fn bad(self, packet: Packet) -> bytes:
        return serialize(value=packet)
```

Reject because capabilities cannot be serialized.

### Invalid: buffer token compared for identity in core code

```wr
class App:
    fn bad(self, a: ReadableBuffer, b: ReadableBuffer) -> bool:
        return a == b
```

Reject because buffer identity is hidden edge/session metadata, not a core value.

### Invalid: source length rewritten by core code

```wr
class App:
    fn bad(self, buffer: ReadableBuffer):
        buffer.len = 0
```

Reject because `len` and `capacity` are trusted token metadata, not mutable
fields.

### Invalid: capacity rewritten by core code

```wr
class App:
    fn bad(self, buffer: WritableBuffer):
        buffer.capacity = 4096
```

Reject because capacity is trusted allocation metadata.

### Invalid: initialized prefix rewritten by core code

```wr
class App:
    fn bad(self, buffer: WritableBuffer):
        buffer.initialized_prefix = buffer.capacity
```

Reject because initialized prefix advances only through checked writes.
