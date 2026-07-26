import test from "node:test";
import assert from "node:assert/strict";
import { boot } from "./framework.js";

test("boot rejects a node class missing handleMessage", async () => {
  class NoHandler {
    constructor(bus) {
      this.bus = bus;
    }
  }
  await assert.rejects(() => boot(NoHandler), /Contract Violation/);
});

test("boot constructs the node, wires it up, and returns a working handle", async () => {
  const originalPort = process.env.BUS_PORT;
  const originalName = process.env.NODE_NAME;
  delete process.env.BUS_PORT;
  process.env.NODE_NAME = "test-node";

  class Echo {
    constructor(bus) {
      this.bus = bus;
      this.messages = [];
    }
    handleMessage(topic, payload) {
      this.messages.push([topic, payload]);
    }
  }

  const handle = await boot(Echo);
  try {
    assert.equal(handle.name, "test-node");
    assert.ok(handle.bus.port !== 0);
    assert.ok(handle.node instanceof Echo);
  } finally {
    handle.stopHeartbeat();
    handle.bus.close();
    if (originalPort === undefined) delete process.env.BUS_PORT;
    else process.env.BUS_PORT = originalPort;
    if (originalName === undefined) delete process.env.NODE_NAME;
    else process.env.NODE_NAME = originalName;
  }
});
