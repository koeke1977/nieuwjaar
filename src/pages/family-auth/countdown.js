import { plural } from "../../utils/html.js";
// Countdown to the event (edition date/time, local time, e.g. "2026-12-31T20:00").
const DAY = 24 * 60 * 60 * 1000;

export function eventDate(startsAt) {
  if (!startsAt) return null;
  const date = new Date(startsAt.length === 10 ? startsAt + "T20:00" : startsAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

// { phase: "future" | "soon" | "now" | "over", text, short }
export function countdownState(startsAt, eventName, now = new Date()) {
  const date = eventDate(startsAt);
  if (!date) return null;
  const ms = date.getTime() - now.getTime();
  if (ms <= -DAY) return { phase: "over" };
  if (ms <= 0) return { phase: "now", text: "Gelukkig " + eventName + "! 🎆", short: "🎆 Het is zover!" };
  const days = Math.floor(ms / DAY),
    hours = Math.floor((ms % DAY) / 3600000),
    minutes = Math.floor((ms % 3600000) / 60000),
    seconds = Math.floor((ms % 60000) / 1000);
  if (days === 0)
    return {
      phase: "soon",
      text:
        "Vandaag is het zover! Nog " +
        plural(hours, "uur", "uur") +
        " en " +
        plural(minutes, "minuut", "minuten") +
        " 🥂",
      short: "🥂 Vandaag!",
      parts: { days, hours, minutes, seconds }
    };
  return {
    phase: "future",
    text: "Nog " + plural(days, "dag", "dagen") + " tot " + eventName,
    short: "🎆 nog " + plural(days, "dag", "dagen"),
    parts: { days, hours, minutes, seconds }
  };
}

const pad = n => String(n).padStart(2, "0");

export function formatEventDate(startsAt) {
  const date = eventDate(startsAt);
  return date
    ? date.toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long" }) +
        " om " +
        pad(date.getHours()) +
        ":" +
        pad(date.getMinutes())
    : "";
}
