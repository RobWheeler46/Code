/**
 * WebSocketService (FRD §44-46, §80).
 *
 * One persistent connection per browser at /ws. Broadcasts full aircraft
 * snapshots (FRD §45) plus config / source / error status messages. Applies a
 * Host allow-list for LAN deployments (FRD §80).
 */

import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { WS_PATH, type ServerMessage } from "@ast/shared";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("websocket");

export interface WsHooks {
  /** Build the initial messages sent to a freshly connected client. */
  onConnect(): ServerMessage[];
}

/** How often to ping clients to detect dead connections (FRD §95). */
const HEARTBEAT_INTERVAL_MS = 30_000;

export class WebSocketService {
  private readonly wss: WebSocketServer;
  private hooks: WsHooks | undefined;
  /** Clients that have answered a ping since the last heartbeat sweep. */
  private readonly alive = new WeakSet<WebSocket>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private readonly heartbeatMs: number;

  constructor(heartbeatMs: number = HEARTBEAT_INTERVAL_MS) {
    this.wss = new WebSocketServer({ noServer: true });
    this.heartbeatMs = heartbeatMs;
  }

  setHooks(hooks: WsHooks): void {
    this.hooks = hooks;
  }

  /** Attach to an HTTP server's upgrade event, gating on path + Host (FRD §80). */
  attach(server: HttpServer): void {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = req.url ?? "";
      if (!url.startsWith(WS_PATH)) {
        socket.destroy();
        return;
      }
      if (!isAllowedHost(req)) {
        log.warn("rejected websocket upgrade: host not allowed", {
          host: req.headers.host,
        });
        socket.destroy();
        return;
      }
      // Viewing the live display is open - no auth on the WebSocket.
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws: WebSocket) => {
      log.debug("client connected", { clients: this.wss.clients.size });
      // Heartbeat: a fresh client is alive, and every pong keeps it alive.
      this.alive.add(ws);
      ws.on("pong", () => this.alive.add(ws));
      if (this.hooks) {
        for (const message of this.hooks.onConnect()) {
          this.send(ws, message);
        }
      }
      ws.on("error", (err) => log.warn("client socket error", { error: String(err) }));
    });

    // Detect and drop half-open connections so the server does not broadcast into
    // dead sockets, and idle proxies do not silently close a live one (FRD §95).
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.wss.clients) {
        if (!this.alive.has(client)) {
          log.debug("terminating unresponsive client");
          client.terminate();
          continue;
        }
        this.alive.delete(client);
        try {
          client.ping();
        } catch {
          client.terminate();
        }
      }
    }, this.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /** Broadcast a message to all connected clients. */
  broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  clientCount(): number {
    return this.wss.clients.size;
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
  }
}

/** Restrict unexpected Host values for LAN deployments (FRD §80). */
function isAllowedHost(req: IncomingMessage): boolean {
  if (env.allowedHosts.length === 0) return true; // default: allow all
  const host = (req.headers.host ?? "").toLowerCase();
  return env.allowedHosts.includes(host);
}
