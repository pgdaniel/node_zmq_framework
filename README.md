# node_zmq_framework

**A Node.js port of [ruby_zmq_framework](https://github.com/pgdaniel/ruby_zmq_framework)
and its Zig, Go, and Rust siblings: Node-RED without the UI — fitting,
since Node's event loop already gives this framework its concurrency
story for free.**

- **Nodes** are independent OS processes. Each one does one job, lives in one
  file, and knows nothing about any other node — not their ports, not their
  names, not their language.
- **Wires** are pub/sub topics carrying JSON, over ZeroMQ.
- **The graph is data**: [`flow.yml`](flow.yml) is the only artifact that
  knows the topology. `flowctl` reads it, computes the wiring, and runs
  everything.
- **The contract is one page**: [`PROTOCOL.md`](PROTOCOL.md) is everything a
  node in any language needs to join — and it's the *same* contract as the
  Ruby, Zig, Go, and Rust originals, so nodes from any of the five repos
  can sit in one `flow.yml` together without any of them knowing the
  others exist.

## Quick start

You need Node.js 18+ and the ZeroMQ library (`libzmq3-dev` on
Debian/Ubuntu, `brew install zeromq` on macOS — the `zeromq` npm package
ships prebuilt binaries for most platforms, but falls back to compiling
against your system libzmq), then:

```bash
npm install
bin/flowctl.js
```

That runs the demo graph from `flow.yml`: a simulated ECU blasting RPM data,
a telemetry node that commands a throttle cut on over-rev, a web dashboard
on <http://localhost:4567>, a state registry caching heartbeats and
telemetry, and a dashboard consumer syncing the registry's snapshot. Output
is streamed with a `[node_name]` prefix; Ctrl-C stops everything.

`bin/flowctl.js --plan` prints the computed wiring without running
anything. `bin/flowctl.js --graph` prints the node topology as JSON.

## Writing a node

A Node node is a class with one method, booted from the environment:

```js
import { boot } from "../lib/framework.js"; // adjust the path to wherever nodes/ sits relative to lib/

class RpmSmoother {
  #window = [];

  constructor(bus) {
    this.bus = bus;
  }

  async handleMessage(topic, payload) {
    if (topic !== "engine_data") return;
    this.#window.push(payload.rpm);
    if (this.#window.length > 5) this.#window.shift();

    const avg = this.#window.reduce((a, b) => a + b, 0) / this.#window.length;
    await this.bus.publish("engine_data_smooth", { rpm: avg });
  }
}

const handle = await boot(RpmSmoother);
console.log("online");
```

Note what's absent: no ports, no peers, no subscribe calls. Wiring comes
from environment variables (`BUS_PORT`, `BUS_PEERS`, `BUS_SUBSCRIBES`,
`NODE_NAME` — see `PROTOCOL.md`), which `flowctl` computes from the node's
entry in the manifest:

```yaml
  rpm_smoother:
    cmd: node nodes/rpm_smoother.js
    subscribes: [engine_data]
    publishes: [engine_data_smooth]
```

Run standalone (no environment needed — it binds an ephemeral port) to poke
at a node in isolation: `node nodes/rpm_smoother.js`.

Every node automatically heartbeats every 5 seconds. `boot(NodeClass)`
checks that `NodeClass.prototype.handleMessage` exists and throws
immediately if it doesn't — the same contract-at-construction-time check
the Ruby original does (both being dynamically typed with no compile
step), as opposed to the compile-time check the Zig/Go/Rust ports get from
their type systems.

## Nodes in other languages

The bus is just two-frame ZeroMQ pub/sub — `[topic, json]` — and the whole
contract fits on one page: [`PROTOCOL.md`](PROTOCOL.md), including the raw
`zeromq` calls this framework's `boot()` makes under the hood. Follow it,
add a `cmd` entry to `flow.yml`, and the language never matters again —
including the original
[ruby_zmq_framework](https://github.com/pgdaniel/ruby_zmq_framework) and
its Zig, Go, and Rust ports, which all speak the exact same wire format.

## What's in the box

| piece | file | job |
|-------|------|-----|
| `Bus` | `lib/bus.js` | ZeroMQ transport via the `zeromq` npm package; Node's single-threaded event loop makes "handlers never run concurrently" true by construction — no actor thread, recursive mutex, or send-lock needed, unlike the other four ports |
| `boot()` | `lib/framework.js` | wires a node from `BUS_*`/`NODE_NAME`, checks the `handleMessage` contract, auto-heartbeat, `NodeHandle.broadcast`, TERM/INT handling |
| `Flow` | `lib/flow.js` | parses **and serializes** `flow.yml` — the only one of the five ports that can write the manifest back out, which is what makes the interactive graph viewer's editing feature possible (see the parent repo's `viewer/`) |
| `flowctl` | `bin/flowctl.js` | assigns ports, spawns nodes, prefixes output, tears down on Ctrl-C |
| `StateRegistry` | `lib/state_registry.js` | passive cluster-state cache; replays snapshots on request |
| demo nodes | `nodes/*.js` | one blackbox process per file |

Delivery is fire-and-forget (latest-value-wins), and a throwing handler
can never kill the bus's listener (caught and logged, mirroring the other
ports' per-handler error isolation).

> **Note on the ZeroMQ binding:** the Zig, Go, and Rust ports each bind
> straight to libzmq's C ABI with no ZeroMQ-specific wrapper, because
> each of those languages has a lightweight, no-extra-tooling path to do
> that (`@cImport`, cgo, `extern "C"`). Node doesn't — any FFI route here
> is *also* a native addon needing prebuilt binaries, so it doesn't buy
> back any of the simplicity that trick gets the other three. The `zeromq`
> npm package is the standard, well-maintained binding for exactly this,
> so that's what this port uses.

> **Note on `Flow#toYamlText()`:** it round-trips through this port's own
> parser exactly, including values with commas/colons inside quotes (the
> other four ports' flow-map/list parsers do a naive comma-split and
> aren't quote-aware, so a value like `env: { MSG: "a, b" }` would
> misparse there). In practice every env value across all five ports so
> far has been a simple bare token, so this hasn't mattered — but if
> you're hand-editing a `flow.yml` meant to stay portable across all five
> implementations, keep env values comma-free.

## Library: reusable nodes

`library/` (as opposed to `nodes/`, which is the demo graph) holds small,
general-purpose nodes meant to be dropped into *any* flow.yml, not just
this repo's demo one:

| node | job | key env vars |
|------|-----|--------------|
| `library/csv_reader.js` | reads a CSV file, publishes each row as JSON | `CSV_PATH`, `CSV_TOPIC`, `CSV_HAS_HEADER`, `CSV_INTERVAL_MS` |
| `library/csv_writer.js` | subscribes to a topic, appends each payload as a CSV row | `CSV_PATH`, `CSV_TOPIC`, `CSV_COLUMNS` |
| `library/json_transform.js` | subscribes to one topic, pick/renames fields, republishes on another | `JSON_SRC_TOPIC`, `JSON_DST_TOPIC`, `JSON_MAP` |

They compose like any other nodes — wire them together with ordinary
`flow.yml` entries:

```yaml
nodes:
  reader:
    cmd: node library/csv_reader.js
    publishes: [people]
    env: { CSV_PATH: people.csv, CSV_TOPIC: people }

  transform:
    cmd: node library/json_transform.js
    subscribes: [people]
    publishes: [people_short]
    env: { JSON_SRC_TOPIC: people, JSON_DST_TOPIC: people_short, JSON_MAP: "name=first_name,years=age" }

  writer:
    cmd: node library/csv_writer.js
    subscribes: [people_short]
    env: { CSV_PATH: out.csv, CSV_TOPIC: people_short }
```

That's `csv_reader → json_transform → csv_writer` end to end over the bus
— run it and `out.csv` ends up with just the renamed `name`/`years`
columns. `library/csv.js` is a small hand-rolled RFC-4180-ish parser/writer
(quoted fields, embedded commas, escaped quotes) — no CSV dependency,
same minimal-dependency approach as everything else here.

## Known gap: no CAN bridge

The other four ports include a `CanBridge` that relays real SocketCAN
frames onto the bus. Node has no built-in raw-socket support for exotic
address families like `AF_CAN` (unlike the `syscall`/`libc`/raw-FFI paths
the other ports use), and pulling in a native SocketCAN module felt like
the wrong trade for what this port is for. If you need CAN on this bus,
run one of the other four ports' `can_bridge` node alongside a Node flow
— they all speak the same wire protocol, so it just works.

## Tests

```bash
npm test
```

Tests live in `lib/*.test.js` and `library/*.test.js`, using Node's
built-in test runner (zero extra dependency — `npm test` discovers both
directories automatically), mirroring the other ports' suites: bus
dispatch, flow wiring/graph computation (plus a round-trip parse →
serialize → parse test, since this port uniquely needs that to hold),
StateRegistry's heartbeat/telemetry/snapshot behavior, and the CSV
parser/writer's quoting and round-trip behavior.
