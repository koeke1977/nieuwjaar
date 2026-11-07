// Local Belgian date/time strings ("2026-12-20" or "2026-12-20T23:59") to real moments.
// The server runs in UTC, so the Brussels offset (winter/summer time) is applied explicitly.
export const TIME_ZONE = "Europe/Brussels";

function offsetAt(timestamp, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
      .formatToParts(new Date(timestamp))
      .map(part => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - timestamp;
}

// A date without time means the end of that day (23:59).
export function localToDate(local, timeZone = TIME_ZONE) {
  if (typeof local !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(local)) return null;
  const [day, time = "23:59"] = local.split("T");
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const result = new Date(guess - offsetAt(guess - offsetAt(guess, timeZone), timeZone));
  return Number.isNaN(result.getTime()) ? null : result;
}

export const isLocalDateTime = value =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value) && localToDate(value) !== null;

// Has the order deadline passed? No deadline means ordering stays open.
export function ordersClosed(orderDeadline, now = new Date()) {
  const deadline = orderDeadline ? localToDate(orderDeadline) : null;
  return Boolean(deadline && now.getTime() > deadline.getTime());
}
