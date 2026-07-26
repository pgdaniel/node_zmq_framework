import test from "node:test";
import assert from "node:assert/strict";
import { Bus } from "./bus.js";

test("bus binds an ephemeral port and reports it back", async () => {
  const bus = await Bus.create(0, [], "127.0.0.1");
  assert.notEqual(bus.port, 0);
  bus.close();
});

test("publish dispatches locally to subscribers on the same bus", async () => {
  const bus = await Bus.create(0, [], "127.0.0.1");
  let seen = null;
  bus.subscribe("engine_data", (topic, payload) => {
    seen = payload;
  });

  await bus.publish("engine_data", { rpm: 4200 });

  assert.deepEqual(seen, { rpm: 4200 });
  bus.close();
});

test("a throwing handler doesn't stop the next handler or kill the bus", async () => {
  const bus = await Bus.create(0, [], "127.0.0.1");
  let secondCalled = false;
  bus.subscribe("x", () => {
    throw new Error("boom");
  });
  bus.subscribe("x", () => {
    secondCalled = true;
  });

  await bus.publish("x", { ok: true });
  assert.equal(secondCalled, true);

  // and the bus is still alive for further messages
  let laterSeen = false;
  bus.subscribe("y", () => {
    laterSeen = true;
  });
  await bus.publish("y", {});
  assert.equal(laterSeen, true);

  bus.close();
});
