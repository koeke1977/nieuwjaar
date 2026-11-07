import test from "node:test";
import assert from "node:assert/strict";
import { countdownState } from "../src/pages/family-auth/countdown.js";

const at = text => new Date(text);

test("counts down in days before the event", () => {
  const state = countdownState("2026-12-31T20:00", "Nieuwjaar", at("2026-12-01T20:00"));
  assert.equal(state.phase, "future");
  assert.equal(state.parts.days, 30);
  assert.equal(state.text, "Nog 30 dagen tot Nieuwjaar");
  assert.equal(countdownState("2026-12-31T20:00", "Nieuwjaar", at("2026-12-30T19:00")).short, "🎆 nog 1 dag");
});

test("on the day it shows hours and minutes, then celebrates, then disappears", () => {
  const soon = countdownState("2026-12-31T20:00", "Nieuwjaar", at("2026-12-31T16:30"));
  assert.equal(soon.phase, "soon");
  assert.match(soon.text, /Nog 3 uur en 30 minuten/);
  assert.equal(countdownState("2026-12-31T20:00", "Nieuwjaar", at("2026-12-31T23:00")).text, "Gelukkig Nieuwjaar! 🎆");
  assert.equal(countdownState("2026-12-31T20:00", "Nieuwjaar", at("2027-01-02T12:00")).phase, "over");
  assert.equal(countdownState(null, "Nieuwjaar"), null, "no date, no countdown");
});
