// Small helpers shared by the edition modules.

export const METHODS = ["general", "adults", "meat", "bar"];

export const ID = /^[A-Za-z0-9_-]{1,120}$/;
export const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const CONFLICT = "edition-state-conflict";

export function parse(json, fallback) {
  try {
    return JSON.parse(json || "");
  } catch {
    return fallback;
  }
}
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
