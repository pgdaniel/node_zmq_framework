#!/usr/bin/env node
// Subscribes to one topic and appends each JSON object payload as a CSV
// row. Column order is fixed from the first payload's keys (or
// CSV_COLUMNS, if set) and reused for every row after — later payloads
// with a different key set just get missing keys written as empty cells
// and extra keys dropped, rather than corrupting the file's column count.
//
//   CSV_PATH      required — file to append to (created with a header if new)
//   CSV_TOPIC     required — topic to write; must also be in the node's
//                 flow.yml `subscribes:` list, same as any other node
//   CSV_COLUMNS   optional comma-separated column order; inferred from
//                 the first message otherwise
import { existsSync, appendFileSync, writeFileSync } from "node:fs";
import { boot, sleepForever } from "../lib/framework.js";
import { csvRow } from "./csv.js";

const path = process.env.CSV_PATH;
const topic = process.env.CSV_TOPIC;
if (!path || !topic) {
  console.error("[csv_writer] CSV_PATH and CSV_TOPIC are required");
  process.exit(1);
}

let columns = process.env.CSV_COLUMNS ? process.env.CSV_COLUMNS.split(",").map((c) => c.trim()) : null;

class CsvWriter {
  handleMessage(msgTopic, payload) {
    if (msgTopic !== topic) return;

    if (!columns) {
      columns = Object.keys(payload);
      if (!existsSync(path)) writeFileSync(path, csvRow(columns));
    }
    appendFileSync(path, csvRow(columns.map((c) => payload[c])));
  }
}

await boot(CsvWriter);
console.log(`online (writing ${topic} -> ${path})`);
await sleepForever();
