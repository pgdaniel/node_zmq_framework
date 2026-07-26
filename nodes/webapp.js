#!/usr/bin/env node
// HTTP bridge onto the bus: shows live telemetry, sends commands back.
// Publishes: throttle_request. Subscribes: engine_data.
import http from "node:http";
import { boot } from "../lib/framework.js";

// Global state shared between the bus dispatch path and HTTP handlers.
// Safe with no lock, same reasoning as StateRegistry: Node's single
// thread means nothing preempts a handler mid-update.
let latest = { rpm: 0, status: "Waiting for data..." };

class WebBridge {
  constructor(bus) {
    this.bus = bus;
  }

  handleMessage(topic, payload) {
    if (topic !== "engine_data") return;
    latest = { rpm: payload.rpm, status: "Live" };
  }
}

const handle = await boot(WebBridge);
console.log("online");

const port = process.env.WEB_PORT || "4567";

const page = () => `<!DOCTYPE html>
<html>
<head>
  <title>ZMQ Telemetry Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 2rem; }
    .card { background: #222; padding: 1.5rem; border-radius: 8px; max-width: 400px; margin-bottom: 1rem;}
    h1 { margin-top: 0; color: #4ade80; }
    button { background: #ef4444; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; }
    button:hover { background: #dc2626; }
  </style>
  <meta http-equiv="refresh" content="1">
</head>
<body>
  <div class="card">
    <h1>Telemetry Dashboard</h1>
    <p><strong>Status:</strong> ${latest.status}</p>
    <p><strong>RPM:</strong> <span style="font-size: 1.5em; font-weight: bold;">${latest.rpm}</span></p>
  </div>
  <div class="card">
    <h2>Overrides</h2>
    <form action="/command" method="POST">
      <input type="hidden" name="throttle" value="0">
      <button type="submit">Send Engine Kill (0% Throttle)</button>
    </form>
  </div>
</body>
</html>
`;

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(page());
    return;
  }

  if (req.method === "POST" && req.url === "/command") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);
    const throttlePos = parseInt(params.get("throttle") ?? "0", 10) || 0;

    await handle.broadcast("throttle_request", { position: throttlePos });
    console.log(`Broadcasted throttle command: ${throttlePos}%`);

    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(Number(port), "0.0.0.0");
