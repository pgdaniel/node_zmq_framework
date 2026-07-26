import test from "node:test";
import assert from "node:assert/strict";
import { Flow, FlowError } from "./flow.js";

const FLOW_SPEC = `nodes:
  ecu:
    cmd: ruby nodes/ecu.rb
    publishes: [engine_data]
    subscribes: [throttle_request]

  telemetry:
    cmd: ruby nodes/telemetry.rb
    publishes: [throttle_request]
    subscribes: [engine_data]

  registry:
    cmd: ruby nodes/state_registry.rb
    subscribes: [heartbeat, engine_data]
    env: { VERBOSE: "1" }
`;

const PORTS = { ecu: 5001, telemetry: 5002, registry: 5003 };

test("peers are computed from topic publishers", () => {
  const flow = Flow.parse(FLOW_SPEC);
  const wiring = Object.fromEntries(flow.wiring(PORTS).map((w) => [w.nodeName, w.env]));
  assert.equal(wiring.ecu.BUS_PEERS, "127.0.0.1:5002");
  assert.equal(wiring.telemetry.BUS_PEERS, "127.0.0.1:5001");
});

test("heartbeat makes every node a publisher except yourself", () => {
  const flow = Flow.parse(FLOW_SPEC);
  const wiring = Object.fromEntries(flow.wiring(PORTS).map((w) => [w.nodeName, w.env]));
  const peers = wiring.registry.BUS_PEERS.split(",").sort();
  assert.deepEqual(peers, ["127.0.0.1:5001", "127.0.0.1:5002"]);
});

test("each node gets its own port, name, and subscriptions", () => {
  const flow = Flow.parse(FLOW_SPEC);
  const wiring = Object.fromEntries(flow.wiring(PORTS).map((w) => [w.nodeName, w.env]));
  assert.equal(wiring.ecu.BUS_PORT, "5001");
  assert.equal(wiring.ecu.NODE_NAME, "ecu");
  assert.equal(wiring.registry.BUS_SUBSCRIBES, "heartbeat,engine_data");
});

test("custom env is merged into the wiring", () => {
  const flow = Flow.parse(FLOW_SPEC);
  const wiring = Object.fromEntries(flow.wiring(PORTS).map((w) => [w.nodeName, w.env]));
  assert.equal(wiring.registry.VERBOSE, "1");
});

test("a node without cmd is rejected", () => {
  const spec = "nodes:\n  broken:\n    publishes: [x]\n";
  assert.throws(() => Flow.parse(spec), (err) => err instanceof FlowError && /broken needs a cmd/.test(err.message));
});

test("a manifest without a nodes key is rejected", () => {
  assert.throws(() => Flow.parse("not_nodes: {}\n"), FlowError);
});

test("graph has one edge per publisher and ignores heartbeat", () => {
  const flow = Flow.parse(FLOW_SPEC);
  const { edges } = flow.graph();
  assert.ok(edges.some((e) => e.from === "ecu" && e.to === "telemetry" && e.topic === "engine_data"));
  assert.ok(edges.some((e) => e.from === "telemetry" && e.to === "ecu" && e.topic === "throttle_request"));
  assert.ok(!edges.some((e) => e.topic === "heartbeat"));
});

test("graph surfaces unpublished topics as unresolved instead of an edge", () => {
  const spec = 'nodes:\n  lonely:\n    cmd: "true"\n    subscribes: [ghost_topic]\n';
  const flow = Flow.parse(spec);
  const { edges, unresolved } = flow.graph();
  assert.deepEqual(unresolved, [{ topic: "ghost_topic", to: "lonely" }]);
  assert.equal(edges.length, 0);
});

test("toYamlText round-trips through parse with identical wiring/graph output", () => {
  const original = Flow.parse(FLOW_SPEC);
  const reparsed = Flow.parse(original.toYamlText());

  assert.deepEqual(reparsed.wiring(PORTS), original.wiring(PORTS));
  assert.deepEqual(reparsed.graph(), original.graph());
});

test("toYamlText quotes values that would otherwise be ambiguous in a flow map", () => {
  const flow = Flow.parse('nodes:\n  n:\n    cmd: x\n    env: { MSG: "has, comma and: colon" }\n');
  const text = flow.toYamlText();
  const reparsed = Flow.parse(text);
  assert.equal(reparsed.nodes[0].env.MSG, "has, comma and: colon");
});

test("toYamlText quotes numeric-looking env values so a real YAML parser wouldn't misread them as ints", () => {
  const flow = Flow.parse('nodes:\n  n:\n    cmd: x\n    env: { WEB_PORT: "4567" }\n');
  const text = flow.toYamlText();
  assert.match(text, /WEB_PORT: "4567"/);
  assert.equal(Flow.parse(text).nodes[0].env.WEB_PORT, "4567");
});
