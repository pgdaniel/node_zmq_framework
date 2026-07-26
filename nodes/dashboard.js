#!/usr/bin/env node
// Consumer side of the async state-sync pattern: request the registry's
// snapshot once on startup, then log whatever comes back.
// Publishes: request_global_state. Subscribes: global_state_snapshot.
import { boot, sleepForever } from "../lib/framework.js";

class Dashboard {
  constructor(bus) {
    this.bus = bus;
  }

  handleMessage(topic, payload) {
    if (topic !== "global_state_snapshot") return;
    console.log(`Synced global state: ${JSON.stringify(payload)}`);
  }
}

const handle = await boot(Dashboard);
console.log("online");

await new Promise((r) => setTimeout(r, 1000)); // let PUB/SUB connections settle before the fire-and-forget request
await handle.broadcast("request_global_state", { requester: handle.name });
await sleepForever();
