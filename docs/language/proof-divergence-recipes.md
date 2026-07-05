# Proof Divergence Recipes

Proof divergence usually means two control-flow paths reach the same proof point
with incompatible facts, consumed resources, or pending split state. These recipes
show small source rewrites that make the state at a join explicit and uniform.

The snippets are Wrela-ish source sketches. Keep the shape of the rewrite, but
adapt names and platform calls to the concrete API you are using.

## Hoist the fact

Use this when each branch establishes the same requirement separately, but the
join cannot see one stable fact.

Before:

```wr
fn copy_packet(packet: Packet, destination: Buffer) -> Result:
    if packet.has_ipv4:
        let length = packet.ipv4_length()
        require length <= destination.capacity
        destination.copy_from(packet, length)
    else:
        let length = packet.raw_length()
        require length <= destination.capacity
        destination.copy_from(packet, length)

    return destination.finish()
```

After:

```wr
fn copy_packet(packet: Packet, destination: Buffer) -> Result:
    let length = packet.payload_length()
    require length <= destination.capacity

    if packet.has_ipv4:
        destination.copy_from(packet, length)
    else:
        destination.copy_from(packet, length)

    return destination.finish()
```

Diagnostic note: this is a first try for `PROOF_CHECK_DIVERGENT_JOIN` or
`PROOF_CHECK_UNSATISFIED_REQUIREMENT` when both predecessors should provide the
same bound, layout, or capability fact.

## Consume before the merge

Use this when one branch consumes or moves a value and the other branch carries
it past the join. Make the consume happen on every path before the merge, or
return early from the consuming path.

Before:

```wr
fn send_or_drop(consume packet: Packet, port: Port, should_send: bool) -> Result:
    if should_send:
        port.send(consume packet)

    log_packet(packet)
    return ok
```

After:

```wr
fn send_or_drop(consume packet: Packet, port: Port, should_send: bool) -> Result:
    if should_send:
        port.send(consume packet)
        return ok

    log_packet(packet)
    drop(consume packet)
    return ok
```

Diagnostic note: this addresses joins that later surface as
`PROOF_CHECK_DIVERGENT_JOIN`, `PROOF_CHECK_USE_AFTER_CONSUME`, or
`PROOF_CHECK_UNSATISFIED_REQUIREMENT` because ownership is not the same on all
incoming paths.

## Split the join

Use this when two branches legitimately end with different proof states. Keep
the state-specific tail inside each branch instead of forcing a single join to
prove both cases.

Before:

```wr
fn validate_then_read(buffer: Buffer, mode: Mode) -> Result:
    if mode == Mode.header:
        let view = validate header buffer
    else:
        let view = validate payload buffer

    require view.length <= buffer.length
    return read(view)
```

After:

```wr
fn validate_then_read(buffer: Buffer, mode: Mode) -> Result:
    if mode == Mode.header:
        let view = validate header buffer
        require view.length <= buffer.length
        return read(view)

    let view = validate payload buffer
    require view.length <= buffer.length
    return read(view)
```

Diagnostic note: use this for `PROOF_CHECK_DIVERGENT_SPLIT_STATE` or
`PROOF_CHECK_DIVERGENT_JOIN` when the split result, validation token, or pending
attempt state is branch-specific by design.

## Duplicate the tail

Use this when the code after a join is small and depends on facts that are
different but equivalent in source terms. Duplicating the tail can be clearer
than inventing a broader proof abstraction.

Before:

```wr
fn checksum(frame: Frame, source: Source) -> u32:
    if source == Source.dma:
        require frame.dma_region.is_mapped
        let bytes = frame.dma_region.bytes
    else:
        require frame.inline_region.is_mapped
        let bytes = frame.inline_region.bytes

    return crc32(bytes)
```

After:

```wr
fn checksum(frame: Frame, source: Source) -> u32:
    if source == Source.dma:
        require frame.dma_region.is_mapped
        return crc32(frame.dma_region.bytes)

    require frame.inline_region.is_mapped
    return crc32(frame.inline_region.bytes)
```

Diagnostic note: this is useful for `PROOF_CHECK_DIVERGENT_JOIN` and
`PROOF_CHECK_UNSATISFIED_REQUIREMENT` when the joined value hides which source
fact proves the tail requirement.

## Choosing a recipe

- If every branch should prove the same thing, try [hoist the fact](#hoist-the-fact).
- If ownership differs after an action, try [consume before the merge](#consume-before-the-merge).
- If the branch states are intentionally different, try [split the join](#split-the-join).
- If the shared tail is short, try [duplicate the tail](#duplicate-the-tail).
