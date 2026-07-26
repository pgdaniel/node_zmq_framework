// The node mixin, Node-style: boot(NodeClass, ...args) mirrors the Ruby
// original's `RubyZmqFramework.boot(NodeClass, *args)` almost exactly —
// fitting, since both are dynamically-typed languages with no compile
// step, so both check the node contract (a handleMessage method) at boot
// time with a thrown error, rather than at compile time the way the
// Zig/Go/Rust ports do.
import { Bus } from "./bus.js";

export const HEARTBEAT_INTERVAL_MS = 5000;

function envList(key) {
  const raw = process.env[key];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function envInt(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

class Heartbeat {
  #bus;
  #name;
  #timer;
  #stopped = false;

  constructor(bus, name) {
    this.#bus = bus;
    this.#name = name;
    this.#tick();
  }

  async #tick() {
    if (this.#stopped) return;
    try {
      await this.#bus.publish("heartbeat", {
        node_name: this.#name,
        status: "ok",
        timestamp: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      console.error(`[Framework Error] Heartbeat failed for ${this.#name}: ${err.message}`);
    }
    if (!this.#stopped) {
      this.#timer = setTimeout(() => this.#tick(), HEARTBEAT_INTERVAL_MS);
    }
  }

  /// Wakes the timer chain rather than killing it mid-publish. Idempotent.
  stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
  }
}

/// Returned by boot(): owns the bus, the constructed node (`.node`), and
/// the heartbeat timer. Node scripts call handle.broadcast(...) the way a
/// Ruby node calls self.broadcast(...).
export class NodeHandle {
  #heartbeat;

  constructor(bus, name, node, heartbeat) {
    this.bus = bus;
    this.name = name;
    this.node = node;
    this.#heartbeat = heartbeat;
  }

  async broadcast(topic, payload) {
    try {
      await this.bus.publish(topic, payload);
    } catch (err) {
      console.error(`[Framework Error] broadcast ${topic} failed: ${err.message}`);
    }
  }

  /// Call before closing the bus this node broadcasts on.
  stopHeartbeat() {
    this.#heartbeat.stop();
  }
}

/// Boots a node the flow-runtime way: all bus wiring comes from
/// environment variables (set by flowctl, or by hand), so node code never
/// contains ports, peer lists, or subscription calls.
///
///   BUS_PORT        port to bind (default 0 = OS-assigned ephemeral)
///   BUS_PEERS       comma-separated peer endpoints ("127.0.0.1:5555,...")
///   BUS_SUBSCRIBES  comma-separated topics routed to node.handleMessage
///   NODE_NAME       heartbeat identity (defaults to the class name)
///
/// NodeClass must take the bus as its first constructor argument. With no
/// environment set, the node still boots standalone on an ephemeral port
/// — handy for poking at a single node in isolation.
export async function boot(NodeClass, ...args) {
  if (typeof NodeClass.prototype?.handleMessage !== "function") {
    throw new TypeError(
      `[Framework Error] Contract Violation: ${NodeClass.name} missing handleMessage(topic, payload)`
    );
  }

  const busPort = envInt("BUS_PORT", 0);
  const peers = envList("BUS_PEERS");
  const subscribes = envList("BUS_SUBSCRIBES");

  const bus = await Bus.create(busPort, peers, "127.0.0.1");
  const node = new NodeClass(bus, ...args);

  const name = process.env.NODE_NAME || NodeClass.name;
  for (const topic of subscribes) {
    bus.subscribe(topic, node);
  }

  const heartbeat = new Heartbeat(bus, name);
  installSignalHandlers();

  return new NodeHandle(bus, name, node, heartbeat);
}

/// Booted nodes are processes managed by a supervisor (flowctl) or a
/// terminal: exit quietly on TERM/INT instead of dumping a stack trace.
function installSignalHandlers() {
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}

/// Equivalent of Ruby's trailing bare `sleep` — parks the caller forever
/// while the event loop (heartbeat timer, bus listener) does the work.
export function sleepForever() {
  return new Promise(() => {});
}
