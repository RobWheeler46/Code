import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { WS_PATH } from "@ast/shared";
import { WebSocketService } from "./wsService.js";

/** Wait for one message from a socket. */
function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(String(d)))));
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WebSocketService heartbeat", () => {
  let server: Server;
  let svc: WebSocketService;
  let port: number;

  before(async () => {
    server = createServer();
    // Short heartbeat so the test runs quickly.
    svc = new WebSocketService(80);
    svc.setHooks({ onConnect: () => [{ type: "source.status", status: "connected" }] });
    svc.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(() => {
    svc.close();
    server.close();
  });

  it("sends the onConnect messages to a new client", async () => {
    const ws = new WebSocket(`ws://localhost:${port}${WS_PATH}`);
    const msg = await nextMessage(ws);
    assert.deepEqual(msg, { type: "source.status", status: "connected" });
    ws.close();
  });

  it("keeps a responsive client connected across heartbeats", async () => {
    const ws = new WebSocket(`ws://localhost:${port}${WS_PATH}`);
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    let pinged = false;
    ws.on("ping", () => (pinged = true)); // ws auto-responds with a pong
    // Several heartbeat cycles pass; an auto-ponging client must survive.
    await wait(300);
    assert.equal(ws.readyState, WebSocket.OPEN, "healthy client should stay open");
    assert.equal(pinged, true, "server should ping clients");
    assert.equal(svc.clientCount(), 1);
    ws.close();
    await wait(20);
  });

  it("terminates a client that stops responding to pings", async () => {
    const ws = new WebSocket(`ws://localhost:${port}${WS_PATH}`);
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    // Suppress the automatic pong so the server sees the client as unresponsive.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws as any)._socket.removeAllListeners("data");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws as any).pong = () => {};
    const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    // Two heartbeat sweeps: one pings, the next finds no pong and terminates.
    await Promise.race([closed, wait(600)]);
    await wait(50);
    assert.equal(svc.clientCount(), 0, "unresponsive client should be dropped");
  });
});
