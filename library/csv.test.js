import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, csvField, csvRow } from "./csv.js";

test("parseCsv splits plain rows on commas and newlines", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n");
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCsv handles a quoted field with an embedded comma and newline", () => {
  const rows = parseCsv('name,note\nAlice,"hello, world"\nBob,"multi\nline"\n');
  assert.deepEqual(rows, [
    ["name", "note"],
    ["Alice", "hello, world"],
    ["Bob", "multi\nline"],
  ]);
});

test("parseCsv unescapes doubled quotes inside a quoted field", () => {
  const rows = parseCsv('msg\n"she said ""hi"""\n');
  assert.deepEqual(rows, [["msg"], ['she said "hi"']]);
});

test("parseCsv handles a file with no trailing newline", () => {
  const rows = parseCsv("a,b\n1,2");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("csvField quotes values containing commas, quotes, or newlines", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("has,comma"), '"has,comma"');
  assert.equal(csvField('has"quote'), '"has""quote"');
  assert.equal(csvField("has\nnewline"), '"has\nnewline"');
});

test("csvRow round-trips through parseCsv", () => {
  const written = csvRow(["Alice", "hello, world", 42]);
  const [parsed] = parseCsv(written);
  assert.deepEqual(parsed, ["Alice", "hello, world", "42"]);
});
