#!/usr/bin/env node
// Runs a flow manifest: assigns each node a free port, computes the peer
// wiring, spawns every node with that wiring in its environment, and
// streams their output with a [name] prefix. Ctrl-C stops everything.
//
//   flowctl              # runs ./flow.yml
//   flowctl other.yml
//   flowctl --plan       # print computed wiring, run nothing
//   flowctl --graph      # print the topology as JSON, run nothing
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { Flow } from "../lib/flow.js";

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let planOnly = false;
  let graphOnly = false;
  let manifest = "flow.yml";
  for (const arg of args) {
    if (arg === "--plan") planOnly = true;
    else if (arg === "--graph") graphOnly = true;
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: flowctl [--plan | --graph] [flow.yml]");
      return;
    } else manifest = arg;
  }

  const manifestPath = path.resolve(manifest);
  const root = path.dirname(manifestPath);

  let flow;
  try {
    flow = Flow.loadFile(manifestPath);
  } catch (err) {
    fatal(err.message);
  }

  if (graphOnly) {
    console.log(JSON.stringify(flow.graph(), null, 2));
    return;
  }

  const ports = {};
  for (const node of flow.nodes) ports[node.name] = await freePort();

  let wiring;
  try {
    wiring = flow.wiring(ports);
  } catch (err) {
    fatal(err.message);
  }

  if (planOnly) {
    for (const entry of wiring) {
      console.log(entry.nodeName);
      for (const [k, v] of Object.entries(entry.env)) console.log(`  ${k}=${v}`);
    }
    return;
  }

  const wiringByName = Object.fromEntries(wiring.map((e) => [e.nodeName, e.env]));

  const children = [];
  let remaining = flow.nodes.length;
  let shuttingDown = false;

  const pump = (stream, name) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        console.log(`[${name}] ${buf.slice(0, idx)}`);
        buf = buf.slice(idx + 1);
      }
    });
    stream.on("end", () => {
      if (buf) console.log(`[${name}] ${buf}`);
    });
  };

  for (const node of flow.nodes) {
    const env = { ...process.env, ...wiringByName[node.name] };
    const child = spawn("sh", ["-c", node.cmd], { cwd: root, env });
    children.push({ name: node.name, child });

    pump(child.stdout, node.name);
    pump(child.stderr, node.name);

    child.on("exit", (code, signal) => {
      console.log(`[flowctl] ${node.name} exited: ${signal ? `signal ${signal}` : `status ${code}`}`);
      remaining--;
      if (remaining === 0) {
        console.log("[flowctl] all nodes exited");
        process.exit(0);
      }
    });
  }

  console.log(`[flowctl] started ${children.length} nodes: ${children.map((c) => c.name).join(", ")}`);

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[flowctl] shutting down ${remaining} nodes`);
    for (const { child } of children) child.kill("SIGTERM");
    // Safety net only: the per-child 'exit' handler above is what
    // normally prints "all nodes exited" and calls process.exit — this
    // just guards against a child that never responds to SIGTERM.
    setTimeout(() => process.exit(0), 3000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
