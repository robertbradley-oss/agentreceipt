import type { ComponentRisk } from "./types.js";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeToken(value = ""): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function unique(values: readonly string[] = []): string[] {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

export function overlapScore(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 1;
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export function riskValue(risk: ComponentRisk): number {
  return { none: 0, read: 1, reversible_write: 2, destructive_write: 3 }[risk];
}

export function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}
