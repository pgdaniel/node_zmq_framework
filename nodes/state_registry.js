#!/usr/bin/env node
// Runs the library's StateRegistry as a flow node. What it caches is
// decided entirely by the subscribes list in flow.yml — this file knows
// nothing about topics. Prints its snapshot every 5 seconds.
import { boot, sleepForever } from "../lib/framework.js";
import { StateRegistry } from "../lib/state_registry.js";

const handle = await boot(StateRegistry);
console.log("online");

setInterval(() => {
  console.log("---- Global State Snapshot ----");
  console.log(JSON.stringify(handle.node.store, null, 2));
}, 5000);

await sleepForever();
