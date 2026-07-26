import test from "node:test";
import assert from "node:assert/strict";
import { Bus } from "./bus.js";
import { StateRegistry } from "./state_registry.js";

test("starts with an empty store", () => {
  const registry = new StateRegistry({});
  assert.deepEqual(registry.store, { active_nodes: {}, telemetry: {} });
});

test("heartbeat updates active_nodes", async () => {
  const registry = new StateRegistry({});
  await registry.handleMessage("heartbeat", { node_name: "Foo", status: "ok", timestamp: 123 });
  assert.deepEqual(registry.store.active_nodes.Foo, { status: "ok", timestamp: 123 });
});

test("an arbitrary topic is cached as telemetry", async () => {
  const registry = new StateRegistry({});
  await registry.handleMessage("engine_data", { rpm: 4200 });
  assert.deepEqual(registry.store.telemetry.engine_data, { rpm: 4200 });
});

test("request_global_state broadcasts the current store", async () => {
  const bus = await Bus.create(0, [], "127.0.0.1");
  const registry = new StateRegistry(bus);

  await registry.handleMessage("heartbeat", { node_name: "Foo", status: "ok", timestamp: 123 });
  await registry.handleMessage("engine_data", { rpm: 4200 });

  let seen = null;
  bus.subscribe("global_state_snapshot", (topic, payload) => {
    seen = payload;
  });
  await registry.handleMessage("request_global_state", { requester: "Dashboard" });

  assert.deepEqual(seen, registry.store);
  bus.close();
});

test("an offline node keeps its last known state without raising", async () => {
  const registry = new StateRegistry({});
  await registry.handleMessage("heartbeat", { node_name: "Foo", status: "ok", timestamp: 100 });
  await registry.handleMessage("heartbeat", { node_name: "Bar", status: "ok", timestamp: 100 });
  await registry.handleMessage("heartbeat", { node_name: "Foo", status: "ok", timestamp: 200 });

  assert.equal(registry.store.active_nodes.Foo.timestamp, 200);
  assert.equal(registry.store.active_nodes.Bar.timestamp, 100);
});
