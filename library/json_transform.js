#!/usr/bin/env node
// Subscribes to one topic, remaps/narrows its JSON fields via a simple
// mapping spec, and republishes on another topic. Not a general
// transformation engine on purpose — for anything fancier than
// pick/rename, write a normal node instead.
//
//   JSON_SRC_TOPIC   required
//   JSON_DST_TOPIC   required
//   JSON_MAP         optional "newKey=oldKey,newKey2=oldKey2" (renames and
//                    narrows to just these fields); without it, the
//                    payload passes through unchanged.
import { boot, sleepForever } from "../lib/framework.js";

const srcTopic = process.env.JSON_SRC_TOPIC;
const dstTopic = process.env.JSON_DST_TOPIC;
if (!srcTopic || !dstTopic) {
  console.error("[json_transform] JSON_SRC_TOPIC and JSON_DST_TOPIC are required");
  process.exit(1);
}

const mapping = (process.env.JSON_MAP || "")
  .split(",")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => pair.split("=").map((s) => s.trim()));

class JsonTransform {
  constructor(bus) {
    this.bus = bus;
  }

  async handleMessage(topic, payload) {
    if (topic !== srcTopic) return;
    const out =
      mapping.length > 0 ? Object.fromEntries(mapping.map(([to, from]) => [to, payload[from]])) : payload;
    await this.bus.publish(dstTopic, out);
  }
}

await boot(JsonTransform);
console.log(`online (${srcTopic} -> ${dstTopic}${mapping.length ? " via JSON_MAP" : ""})`);
await sleepForever();
