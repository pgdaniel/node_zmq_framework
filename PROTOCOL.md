# Bus Protocol

This one page is the entire contract. A node written in any language that
follows it is a full citizen of the flow — no framework code required.
It is deliberately small enough to paste into an LLM prompt as the
complete context for writing a new node.

This is the same protocol as
[ruby_zmq_framework](https://github.com/pgdaniel/ruby_zmq_framework) and its
Zig, Go, and Rust ports (`zig_zmq_framework`, `go_zmq_framework`,
`rust_zmq_framework`): a node from any of the five repos is an
interchangeable entry in one `flow.yml`, because the wire format never
mentions any particular language.

## Transport

ZeroMQ PUB/SUB over TCP. Every node owns exactly one PUB socket (bound to
its own port, where it publishes everything) and one SUB socket
(connected to each peer's PUB port, subscribed to `""` — all topics —
with filtering done after receipt).

## Wire format

Every message is a two-frame ZeroMQ multipart message:

| frame | content                                    |
|-------|--------------------------------------------|
| 0     | topic — UTF-8 string, `lower_snake_case`   |
| 1     | payload — a JSON **object** (`{...}`), UTF-8 |

Anything else (single frames, non-JSON payloads) is dropped by
well-behaved receivers with a warning. Never crash on a bad message.

## Process environment (set by the launcher)

A node learns its wiring from four environment variables and must not
hardcode any topology:

| variable         | meaning                                            | example                         |
|------------------|----------------------------------------------------|---------------------------------|
| `BUS_PORT`       | port to bind the PUB socket on (`0`/unset = any)   | `5555`                          |
| `BUS_PEERS`      | comma-separated `host:port` list to connect SUB to | `127.0.0.1:5556,127.0.0.1:5557` |
| `BUS_SUBSCRIBES` | comma-separated topics this node should act on     | `engine_data,heartbeat`         |
| `NODE_NAME`      | this node's identity, used in heartbeats           | `ecu`                           |

Unset variables mean: bind any free port, no peers, no subscriptions —
the node must still start (standalone mode).

## Heartbeat

Every node publishes on topic `heartbeat` every **5 seconds**:

```json
{ "node_name": "<NODE_NAME>", "status": "ok", "timestamp": 1784796766 }
```

`timestamp` is Unix seconds. A node that stops heartbeating is presumed
dead; there is no other liveness mechanism.

## Conventions

- Payloads are always JSON objects, never bare arrays/scalars.
- Delivery is fire-and-forget: no acks, no replay. A slow consumer loses
  old messages (ZeroMQ drops at the high-water mark). Design for
  latest-value-wins.
- PUB/SUB connections take ~a few hundred ms to establish ("slow
  joiner"): wait ~1s after startup before your first meaningful publish,
  or design so early messages are harmless to lose.
- Request/response is done with a topic pair by convention, e.g. publish
  `request_global_state` → someone publishes `global_state_snapshot`.

## Minimal node (Node.js shown — this is literally what `lib/bus.js` does)

```js
import * as zmq from "zeromq";

const pub = new zmq.Publisher();
await pub.bind(`tcp://127.0.0.1:${process.env.BUS_PORT || "*"}`);

const sub = new zmq.Subscriber();
for (const peer of (process.env.BUS_PEERS || "").split(",").filter(Boolean)) {
  sub.connect(peer.includes("://") ? peer : `tcp://${peer}`);
}
sub.subscribe("");

const name = process.env.NODE_NAME || "node-node";
const topics = new Set((process.env.BUS_SUBSCRIBES || "").split(",").filter(Boolean));

setInterval(() => {
  pub.send(["heartbeat", JSON.stringify({ node_name: name, status: "ok", timestamp: Math.floor(Date.now() / 1000) })]);
}, 5000);

for await (const [topic, payload] of sub) {
  if (topics.has(topic.toString())) {
    handle(topic.toString(), JSON.parse(payload.toString())); // your logic here
  }
}
```

Add the node to `flow.yml` with its `cmd`, `publishes`, and `subscribes`,
and `flowctl` wires it in.
