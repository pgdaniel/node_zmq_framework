#!/usr/bin/env node
// Watches engine data and commands a throttle cut on over-rev.
// Publishes: throttle_request. Subscribes: engine_data.
import { boot, sleepForever } from "../lib/framework.js";

const OVER_REV_RPM = 6000;

class Telemetry {
  constructor(bus) {
    this.bus = bus;
  }

  async handleMessage(topic, payload) {
    if (topic !== "engine_data") return;

    console.log(`Processing RPM: ${payload.rpm}`);
    if (payload.rpm <= OVER_REV_RPM) return;

    console.log("OVER-REV DETECTED! Commanding throttle cut...");
    await this.bus.publish("throttle_request", { position: 50 });
  }
}

await boot(Telemetry);
console.log("online");
await sleepForever();
