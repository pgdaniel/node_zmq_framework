// ZeroMQ PUB/SUB transport, via the `zeromq` npm package (the standard,
// well-maintained Node binding — unlike the Zig/Go/Rust ports, which bind
// straight to libzmq's C ABI, Node has no lightweight built-in path to do
// that without also shipping a native addon, so a native addon it is).
// Every node owns one PUB socket (bound to its own port) and one SUB
// socket (connected to each peer, subscribed to everything, filtered on
// receipt). Wire format: a two-frame multipart message, [topic, json],
// per PROTOCOL.md.
//
// Node's single-threaded event loop does for free what the other ports
// build actor threads, recursive mutexes, and send-locks for: only one
// piece of JS ever runs at a time, so "handlers on one bus never run
// concurrently" is just true, not something to engineer. The one thing
// this file still owns deliberately is *ordering*: dispatch() always
// awaits every handler before returning, so a burst of locally-published
// messages (or a handler that publishes from inside handleMessage) can't
// interleave with each other.
import * as zmq from "zeromq";

export class Bus {
  #pub;
  #sub;
  #subscribers = new Map(); // topic -> [handler, ...]
  #listening = false;
  #closed = false;
  port = 0;

  static async create(myPort = 0, peers = [], bindHost = "127.0.0.1") {
    const bus = new Bus();
    await bus.#init(myPort, peers, bindHost);
    return bus;
  }

  async #init(myPort, peers, bindHost) {
    this.#pub = new zmq.Publisher();
    const portToken = myPort ? String(myPort) : "*";
    await this.#pub.bind(`tcp://${bindHost}:${portToken}`);
    this.port = Number(this.#pub.lastEndpoint.split(":").pop());

    this.#sub = new zmq.Subscriber();
    for (const peer of peers) {
      this.#sub.connect(peerEndpoint(peer));
    }
    // Subscribe to everything at the socket level, same as the other
    // ports, and filter by BUS_SUBSCRIBES in dispatch() — keeps the wire
    // behavior identical across all five implementations.
    this.#sub.subscribe("");

    this.#listening = true;
    this.#listenLoop();
  }

  subscribe(topic, handler) {
    if (!this.#subscribers.has(topic)) this.#subscribers.set(topic, []);
    this.#subscribers.get(topic).push(handler);
  }

  /// A SUB socket never connects back to its own PUB, so this also
  /// dispatches locally — otherwise two nodes sharing one bus in the same
  /// process couldn't hear each other, and in this framework every node's
  /// own heartbeat is exactly that case.
  async publish(topic, payload) {
    const json = JSON.stringify(payload ?? {});
    await this.#pub.send([topic, json]);
    await this.#dispatch(topic, json);
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#listening = false;
    this.#sub.close();
    this.#pub.close();
  }

  async #listenLoop() {
    try {
      for await (const [topicBuf, payloadBuf] of this.#sub) {
        if (!this.#listening) break;
        await this.#dispatch(topicBuf.toString(), payloadBuf.toString());
      }
    } catch (err) {
      if (this.#listening) {
        console.error(`[Framework Error] Listener failed: ${err.message}`);
      }
      // else: close() caused this, and is already handling shutdown.
    }
  }

  /// A bad payload or a throwing handler must never kill the listener —
  /// one poisoned message would otherwise leave the node deaf for good
  /// while its heartbeat keeps reporting "ok".
  async #dispatch(topic, json) {
    const handlers = this.#subscribers.get(topic);
    if (!handlers || handlers.length === 0) return;

    let payload;
    try {
      payload = JSON.parse(json);
    } catch (err) {
      console.error(`[Framework Error] Dropping malformed payload on ${topic}: ${err.message}`);
      return;
    }

    // Copy so a handler that subscribes mid-dispatch can't mutate the
    // list we're iterating.
    for (const handler of [...handlers]) {
      try {
        const fn = typeof handler === "function" ? handler : handler.handleMessage.bind(handler);
        await fn(topic, payload);
      } catch (err) {
        console.error(`[Framework Error] a handler failed handling ${topic}: ${err.message}`);
      }
    }
  }
}

function peerEndpoint(peer) {
  return peer.includes("://") ? peer : `tcp://${peer}`;
}
