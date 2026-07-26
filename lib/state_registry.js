// A passive, in-memory cache of cluster-wide state. It listens to
// heartbeats and telemetry broadcast by other nodes and, on request,
// replays its current snapshot back onto the bus. It never makes a
// blocking call and never crashes when a peer goes quiet — a silent node
// simply stops getting its active_nodes timestamp updated.
//
// Unlike the Go/Zig/Rust ports, there's no locking or defensive copying
// here: Node's single-threaded event loop means handleMessage is never
// preempted mid-update by another handler, so `this.store` is safe to
// read directly from elsewhere too (see nodes/state_registry.js, which
// prints it on a timer) — the same reasoning that let the *original* Ruby
// version stay this simple.
export class StateRegistry {
  constructor(bus) {
    this.bus = bus;
    this.store = { active_nodes: {}, telemetry: {} };
  }

  async handleMessage(topic, payload) {
    switch (topic) {
      case "heartbeat":
        this.store.active_nodes[payload.node_name] = {
          status: payload.status,
          timestamp: payload.timestamp,
        };
        break;
      case "request_global_state":
        await this.bus.publish("global_state_snapshot", this.store);
        break;
      default:
        this.store.telemetry[topic] = payload;
    }
  }
}
