#!/usr/bin/env node
// Simulated engine unit. Publishes: engine_data. Subscribes: throttle_request.
import { boot } from "../lib/framework.js";

class Ecu {
  constructor(bus) {
    this.bus = bus;
  }

  handleMessage(topic, payload) {
    if (topic === "throttle_request") {
      console.log(`Received throttle command: ${payload.position}%`);
    }
  }
}

const handle = await boot(Ecu);
console.log("online");

await new Promise((r) => setTimeout(r, 1000)); // let PUB/SUB connections settle before the first broadcast
for (;;) {
  const rpm = 2000 + Math.floor(Math.random() * 5001);
  console.log(`Broadcasting RPM: ${rpm}`);
  await handle.broadcast("engine_data", { rpm });
  await new Promise((r) => setTimeout(r, 1000));
}
