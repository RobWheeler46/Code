/** Structured application logging (FRD §81). */

import { env, type LogLevel } from "../config/env.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const threshold = LEVEL_ORDER[env.logLevel] ?? LEVEL_ORDER.info;

export interface LogContext {
  [key: string]: unknown;
}

function emit(
  level: LogLevel,
  component: string,
  message: string,
  context?: LogContext,
): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const record = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
  const line = JSON.stringify(record);
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/** Create a logger bound to a named component (FRD §81). */
export function createLogger(component: string): Logger {
  return {
    debug: (m, c) => emit("debug", component, m, c),
    info: (m, c) => emit("info", component, m, c),
    warn: (m, c) => emit("warn", component, m, c),
    error: (m, c) => emit("error", component, m, c),
  };
}
