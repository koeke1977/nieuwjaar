import test from "node:test";
import assert from "node:assert/strict";
import { localToDate, ordersClosed } from "../src/utils/time.js";

test("Belgian local time is converted correctly in winter and summer", () => {
  assert.equal(localToDate("2026-12-20T23:59").toISOString(), "2026-12-20T22:59:00.000Z");
  assert.equal(localToDate("2027-07-01T12:00").toISOString(), "2027-07-01T10:00:00.000Z");
  assert.equal(
    localToDate("2026-12-20").toISOString(),
    "2026-12-20T22:59:00.000Z",
    "a date alone means the end of that day"
  );
  assert.equal(localToDate("morgen"), null);
});

test("orders close after the deadline, not before", () => {
  assert.equal(ordersClosed("2026-12-20T23:59", new Date("2026-12-20T22:58:00Z")), false);
  assert.equal(ordersClosed("2026-12-20T23:59", new Date("2026-12-20T23:00:00Z")), true);
  assert.equal(ordersClosed(null), false, "no deadline: ordering stays open");
});
