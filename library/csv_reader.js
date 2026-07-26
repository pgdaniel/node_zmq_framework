#!/usr/bin/env node
// Reads a CSV file and publishes each row as a JSON object (if the file
// has a header row) or as {row: [...]} (if not) on a single topic.
//
// Lives under library/ rather than nodes/ because it's a general-purpose
// building block, not part of the flow.yml demo graph — drop it into any
// flow's manifest with the env vars below.
//
//   CSV_PATH          required — file to read
//   CSV_TOPIC         default "csv_row"
//   CSV_HAS_HEADER    default "true" — first line becomes each row's keys
//   CSV_INTERVAL_MS   default "0" — 0 replays every row immediately at
//                     startup; >0 paces rows out (e.g. to simulate a live
//                     feed from a recorded log)
import { readFileSync } from "node:fs";
import { boot, sleepForever } from "../lib/framework.js";
import { parseCsv } from "./csv.js";

class CsvReader {
  handleMessage() {}
}

const path = process.env.CSV_PATH;
if (!path) {
  console.error("[csv_reader] CSV_PATH is required");
  process.exit(1);
}
const topic = process.env.CSV_TOPIC || "csv_row";
const hasHeader = (process.env.CSV_HAS_HEADER ?? "true") !== "false";
const intervalMs = Number(process.env.CSV_INTERVAL_MS || "0");

const rows = parseCsv(readFileSync(path, "utf8"));
const header = hasHeader ? rows.shift() : null;

const handle = await boot(CsvReader);
console.log(`online (replaying ${rows.length} rows from ${path} on :${topic})`);

await new Promise((r) => setTimeout(r, 1000)); // let PUB/SUB connections settle

for (const row of rows) {
  // PROTOCOL.md requires payloads to be JSON objects, never bare arrays
  // — headerless files get wrapped rather than publishing a raw array.
  const payload = header ? Object.fromEntries(header.map((k, i) => [k, row[i] ?? ""])) : { row };
  await handle.broadcast(topic, payload);
  if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
}

console.log("done replaying — heartbeating and idling");
await sleepForever();
