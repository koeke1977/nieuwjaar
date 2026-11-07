import test from "node:test";
import assert from "node:assert/strict";
import { html, joinHtml, raw } from "../src/utils/html.js";

test("html`` escapes every value unless it is html`` itself", () => {
  const name = `Kobe <script>&'"`;
  assert.equal(
    String(html`<b title="${name}">${name}</b>`),
    '<b title="Kobe &lt;script&gt;&amp;&#39;&quot;">Kobe &lt;script&gt;&amp;&#39;&quot;</b>'
  );
  assert.equal(String(html`<p>${html`<i>${"<x>"}</i>`}</p>`), "<p><i>&lt;x&gt;</i></p>");
  assert.equal(String(html`<p>${raw("<br>")}</p>`), "<p><br></p>");
});

test("html`` joins arrays, skips null/undefined and keeps numbers and booleans as text", () => {
  assert.equal(String(html`<ul>${[html`<li>a</li>`, html`<li>b</li>`]}</ul>`), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(String(html`<i>${null}${undefined}${0}${false}</i>`), "<i>0false</i>");
  assert.equal(html``, "");
  assert.equal(joinHtml([]), "");
  assert.equal(String(joinHtml([html`<b>1</b>`, html`<b>2</b>`], raw("<hr>"))), "<b>1</b><hr><b>2</b>");
});

test("line breaks vanish next to tags and become one space inside text", () => {
  const out = html`<div>
      <p>Een lange
        zin over ${"twee"}
        regels.</p>
    </div>`;
  assert.equal(String(out), "<div><p>Een lange zin over twee regels.</p></div>");
});

test("strict mode catches markup that was built as plain text", () => {
  globalThis.__HTML_STRICT__ = true;
  try {
    assert.throws(() => html`<ul>${"<li>oeps</li>"}</ul>`, /looks like HTML/);
    assert.doesNotThrow(() => html`<p>${"3 < 4"}</p>`);
  } finally {
    delete globalThis.__HTML_STRICT__;
  }
});
