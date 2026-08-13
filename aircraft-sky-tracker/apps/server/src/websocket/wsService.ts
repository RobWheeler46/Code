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
import { authorized } from "../api/auth.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("websocket");

export interface WsHooks {
  /** Build the initial messages sent to a freshly connected client. */
  onConnect(): ServerMessage[];
}

export class WebSocketService {
  private readonly wss: WebSocketServer;
  private hooks: WsHooks | undefined;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
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
      if (!authorized(req.headers)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws: WebSocket) => {
      log.debug("client connected", { clients: this.wss.clients.size });
      if (this.hooks) {
        for (const message of this.hooks.onConnect()) {
          this.send(ws, message);
        }
      }
      ws.on("error", (err) => log.warn("client socket error", { error: String(err) }));
    });
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
