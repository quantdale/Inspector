import { randomUUID } from "node:crypto";

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type InspectorId = string;

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function assertId(value: unknown, what = "id"): asserts value is string {
  if (!isId(value)) {
    throw new Error(`malformed ${what}: ${JSON.stringify(value)}`);
  }
}

const PREFIXES: Record<string, string> = {
  run: "run",
  env: "env",
  step: "step",
  action: "act",
  obs: "obs",
  artifact: "art",
  finding: "find",
};

export function newId(kind?: keyof typeof PREFIXES): string {
  const raw = randomUUID().replace(/-/g, "");
  const prefix = kind ? `${PREFIXES[kind]}_` : "";
  return `${prefix}${raw}`;
}
