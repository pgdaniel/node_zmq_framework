// Parses (and, uniquely among the five ports, serializes) a flow manifest
// (flow.yml) — the graph as data, Node-RED style. The manifest is the
// ONLY place that knows the topology; node processes learn their wiring
// from environment variables computed here (see Flow#wiring), and a
// node's code never mentions another node.
//
// Only the small subset of YAML flow.yml actually uses is supported: a
// top-level `nodes:` map, one 2-space-indented block per node, each with
// `cmd:` (scalar), `publishes:`/`subscribes:` (flow lists `[a, b]`), and
// an optional `env:` (flow map `{ K: "v" }`). That's deliberate — the
// whole point of the manifest is to stay this simple, and it means this
// package has no YAML dependency at all, on either the read or write side
// (toYamlText() emits the same subset it parses).
import { readFileSync } from "node:fs";

export class FlowError extends Error {}

export class Flow {
  constructor(nodes) {
    this.nodes = nodes;
    this.#warnAboutDeafSubscriptions();
  }

  static loadFile(path) {
    return Flow.parse(readFileSync(path, "utf8"));
  }

  static parse(text) {
    return new Flow(parseNodes(text));
  }

  /// The environment for every node process, given a {name: port} map.
  /// This is the whole trick that keeps nodes blackboxes: each node's
  /// peer list is computed from who publishes the topics it subscribes to.
  wiring(ports) {
    return this.nodes.map((node) => {
      const peers = this.#peerNames(node).map((name) => {
        const port = ports[name];
        if (port === undefined) {
          throw new FlowError(`[Framework Error] no port assigned for ${name}`);
        }
        return `127.0.0.1:${port}`;
      });

      const myPort = ports[node.name];
      if (myPort === undefined) {
        throw new FlowError(`[Framework Error] no port assigned for ${node.name}`);
      }

      const env = {
        BUS_PORT: String(myPort),
        BUS_PEERS: peers.join(","),
        BUS_SUBSCRIBES: node.subscribes.join(","),
        NODE_NAME: node.name,
        ...node.env,
      };
      return { nodeName: node.name, env };
    });
  }

  /// The node-to-node topology, for visualization (flowctl --graph, and
  /// the viewer). Every topic a node subscribes to becomes an edge from
  /// each of its publishers, except heartbeat (implicit, all-to-all) and
  /// topics nobody publishes (surfaced as unresolved instead of a
  /// dangling edge).
  graph() {
    const nodes = this.nodes.map((n) => ({
      name: n.name,
      cmd: n.cmd,
      publishes: n.publishes,
      subscribes: n.subscribes,
      env: { ...n.env },
    }));

    const edges = [];
    const unresolved = [];
    for (const node of this.nodes) {
      for (const topic of node.subscribes) {
        if (topic === "heartbeat") continue;
        const publishers = this.#publisherNames(topic, node.name);
        if (publishers.length === 0) {
          unresolved.push({ topic, to: node.name });
        } else {
          for (const from of publishers) edges.push({ from, to: node.name, topic });
        }
      }
    }

    return { nodes, edges, unresolved };
  }

  /// Serializes back to the same minimal YAML subset every parser (Ruby/
  /// Zig/Go/Rust/Node) understands. This is what powers the viewer's
  /// optional write-back API (see bin/flow-edit-server.js) — round-trip
  /// fidelity with the hand-rolled parsers in the other four ports is the
  /// whole point, so any change here needs re-verifying against them.
  toYamlText() {
    const lines = ["nodes:"];
    for (const node of this.nodes) {
      lines.push(`  ${node.name}:`);
      lines.push(`    cmd: ${node.cmd}`);
      if (node.publishes.length) lines.push(`    publishes: [${node.publishes.join(", ")}]`);
      if (node.subscribes.length) lines.push(`    subscribes: [${node.subscribes.join(", ")}]`);
      const envEntries = Object.entries(node.env);
      if (envEntries.length) {
        const pairs = envEntries.map(([k, v]) => `${k}: ${quoteIfNeeded(v)}`).join(", ");
        lines.push(`    env: { ${pairs} }`);
      }
      lines.push("");
    }
    return lines.join("\n").replace(/\n+$/, "\n");
  }

  /// Every node broadcasts :heartbeat implicitly, so for that topic
  /// everyone counts as a publisher. A node never peers with itself — the
  /// bus already delivers its own publishes locally.
  #publisherNames(topic, exclude) {
    if (topic === "heartbeat") {
      return this.nodes.filter((n) => n.name !== exclude).map((n) => n.name);
    }
    return this.nodes.filter((n) => n.name !== exclude && n.publishes.includes(topic)).map((n) => n.name);
  }

  #peerNames(node) {
    const seen = new Set();
    const out = [];
    for (const topic of node.subscribes) {
      for (const name of this.#publisherNames(topic, node.name)) {
        if (!seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    }
    return out;
  }

  #warnAboutDeafSubscriptions() {
    for (const node of this.nodes) {
      for (const topic of node.subscribes) {
        if (topic === "heartbeat") continue;
        const published = this.nodes.some((n) => n.publishes.includes(topic));
        if (!published) {
          console.error(
            `[Framework Warning] ${node.name} subscribes to "${topic}" but no node in the flow publishes it`
          );
        }
      }
    }
  }
}

/// Keeps bare tokens bare (matches the style flow.yml already uses, e.g.
/// `CAN_IFACE: vcan0`), but quotes anything with spaces/colons/etc. so it
/// round-trips through every parser's flow-map splitter unambiguously —
/// and quotes anything that *looks* numeric (e.g. "4567") even though
/// none of the five hand-rolled parsers do YAML-style type inference: a
/// value like WEB_PORT is meant to be a string, and an unquoted number is
/// exactly what a real YAML library would silently reinterpret as an int.
function quoteIfNeeded(value) {
  if (value === "") return '""';
  if (/^-?\d+(\.\d+)?$/.test(value)) return JSON.stringify(value);
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

// --- parsing ---

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isBlankOrComment(trimmed) {
  return trimmed === "" || trimmed.startsWith("#");
}

function stripQuotes(s) {
  if (s.length >= 2) {
    if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/// Splits "key: value" (or "key:" with an empty value) at the first
/// colon-then-space (or a trailing colon). Values may contain their own
/// colons (e.g. a URL) without being mistaken for a new key.
function splitKeyValue(trimmed) {
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== ":") continue;
    if (i + 1 === trimmed.length) return [trimmed.slice(0, i), ""];
    if (trimmed[i + 1] === " ") return [trimmed.slice(0, i), trimmed.slice(i + 1).trim()];
  }
  return null;
}

/// Splits on `delimiter`, but not inside a '...' or "..." span — so a
/// quoted value containing a comma (`env: { MSG: "a, b" }`) doesn't get
/// torn in half. (The other four ports' flow-map/list splitters don't do
/// this, so a value with a literal comma will only round-trip cleanly
/// through this parser — fine in practice, since every env value in this
/// framework so far has been a simple bare token.)
function splitRespectingQuotes(s, delimiter) {
  const parts = [];
  let current = "";
  let quoteChar = null;
  for (const c of s) {
    if (quoteChar) {
      current += c;
      if (c === quoteChar) quoteChar = null;
    } else if (c === '"' || c === "'") {
      quoteChar = c;
      current += c;
    } else if (c === delimiter) {
      parts.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

function parseFlowList(value) {
  if (value.length < 2 || value[0] !== "[" || value.at(-1) !== "]") return [];
  return splitRespectingQuotes(value.slice(1, -1), ",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(stripQuotes);
}

function parseFlowMap(value) {
  if (value.length < 2 || value[0] !== "{" || value.at(-1) !== "}") return {};
  const out = {};
  for (const part of splitRespectingQuotes(value.slice(1, -1), ",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const kv = splitKeyValue(trimmed);
    if (!kv) continue;
    out[kv[0].trim()] = stripQuotes(kv[1]);
  }
  return out;
}

function parseNodes(text) {
  const lines = text.split("\n");

  let idx = 0;
  let foundNodesKey = false;
  for (; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (indentOf(line) !== 0 || isBlankOrComment(trimmed)) continue;
    if (trimmed === "nodes:") {
      foundNodesKey = true;
      idx++;
      break;
    }
    // Some other top-level key before `nodes:` — keep scanning.
  }
  if (!foundNodesKey) {
    throw new FlowError('[Framework Error] Flow manifest needs a top-level "nodes" map');
  }

  const out = [];
  let nodeIndent = null;
  let fieldIndent = null;
  let current = null;

  const finish = () => {
    if (!current) return;
    if (!current.hasCmd) {
      throw new FlowError(`[Framework Error] Flow node ${current.name} needs a cmd`);
    }
    out.push({
      name: current.name,
      cmd: current.cmd,
      publishes: current.publishes,
      subscribes: current.subscribes,
      env: current.env,
    });
  };

  for (; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (isBlankOrComment(trimmed)) continue;

    const indent = indentOf(line);
    if (indent === 0) break; // next top-level key: nodes section is over
    if (nodeIndent === null) nodeIndent = indent;

    if (indent === nodeIndent) {
      finish();
      const name = trimmed.endsWith(":") ? trimmed.slice(0, -1) : trimmed;
      current = { name, cmd: "", hasCmd: false, publishes: [], subscribes: [], env: {} };
      fieldIndent = null;
      continue;
    }

    if (fieldIndent === null) fieldIndent = indent;
    if (indent !== fieldIndent || !current) continue;

    const kv = splitKeyValue(trimmed);
    if (!kv) continue;
    const key = kv[0].trim();
    const value = kv[1];
    switch (key) {
      case "cmd":
        current.cmd = stripQuotes(value);
        current.hasCmd = true;
        break;
      case "publishes":
        current.publishes = parseFlowList(value);
        break;
      case "subscribes":
        current.subscribes = parseFlowList(value);
        break;
      case "env":
        current.env = parseFlowMap(value);
        break;
    }
  }
  finish();

  return out;
}
