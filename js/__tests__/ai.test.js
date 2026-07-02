"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFiles } = require("./loadModule");

// ai.js only needs `window.location.hostname` at load time (see loadModule's sandbox) — the
// parsers under test (parseWineCards, parseScanResult) touch nothing else browser-specific.
const { SommAI } = loadFiles(["data.js", "profile.js", "ai.js"]);

// ---------- parseWineCards: <wine>{...}</wine> tags embedded in chat prose ----------

test("parseWineCards extracts a single well-formed card and strips it from prose", () => {
  const text = `Here's a great pick for tonight.
<wine>{"name":"Chateau Test","region":"Bordeaux","grape":"Cabernet Sauvignon","type":"red","price":"€25","match":88,"why":"Bold and structured, matches your tannin preference.","attrs":{"body":0.8,"sweet":0.1,"acid":0.5,"tannin":0.8,"fruit":0.6,"oak":0.6}}</wine>
Enjoy!`;
  const { prose, cards } = SommAI.parseWineCards(text);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, "Chateau Test");
  assert.equal(cards[0].match, 88);
  assert.ok(!prose.includes("<wine>"));
  assert.ok(prose.includes("Here's a great pick"));
  assert.ok(prose.includes("Enjoy!"));
});

test("parseWineCards extracts multiple cards in order", () => {
  const text = [
    'Two options for you:',
    '<wine>{"name":"Wine A","type":"red","match":80,"attrs":{}}</wine>',
    '<wine>{"name":"Wine B","type":"white","match":75,"attrs":{}}</wine>',
  ].join("\n");
  const { cards } = SommAI.parseWineCards(text);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, "Wine A");
  assert.equal(cards[1].name, "Wine B");
});

test("parseWineCards silently skips a malformed (non-JSON) card instead of throwing", () => {
  const text = 'Try this: <wine>{name: "Broken JSON", not valid}</wine> — sorry, my bad.';
  const { prose, cards } = SommAI.parseWineCards(text);
  assert.equal(cards.length, 0);
  // Malformed cards are still stripped from the displayed prose.
  assert.ok(!prose.includes("<wine>"));
});

test("parseWineCards drops a syntactically valid card that's missing a name", () => {
  const text = '<wine>{"type":"red","match":80,"attrs":{}}</wine>';
  const { cards } = SommAI.parseWineCards(text);
  assert.equal(cards.length, 0);
});

test("parseWineCards returns no cards and unmodified prose for plain text", () => {
  const text = "Just a normal reply with no wine cards in it.";
  const { prose, cards } = SommAI.parseWineCards(text);
  assert.equal(cards.length, 0);
  assert.equal(prose, text);
});

test("parseWineCards collapses excess blank lines left behind after stripping cards", () => {
  const text = 'Intro\n\n\n<wine>{"name":"W","type":"red","match":80,"attrs":{}}</wine>\n\n\nOutro';
  const { prose } = SommAI.parseWineCards(text);
  assert.ok(!prose.includes("\n\n\n"), "should collapse 3+ newlines down to at most 2");
});

// ---------- parseScanResult: <scan-result>{...}</scan-result> from the photo-scan flow ----------

test("parseScanResult extracts a valid scan-result JSON block", () => {
  const text = `<scan-result>
{"mode":"bottle","summary":"Solid choice.","picks":[{"rank":1,"name":"Test Wine","type":"red","match":90,"attrs":{"body":0.7}}]}
</scan-result>`;
  const result = SommAI.parseScanResult(text);
  assert.ok(result);
  assert.equal(result.mode, "bottle");
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].name, "Test Wine");
});

test("parseScanResult returns null when no <scan-result> tag is present", () => {
  assert.equal(SommAI.parseScanResult("Sorry, I couldn't read that label clearly."), null);
});

test("parseScanResult returns null (not a throw) for malformed JSON inside the tag", () => {
  const text = "<scan-result>{ this is not valid json }</scan-result>";
  assert.equal(SommAI.parseScanResult(text), null);
});

test("parseScanResult handles an empty picks array", () => {
  const text = '<scan-result>{"mode":"shelf","summary":"Couldn\'t make out any labels.","picks":[]}</scan-result>';
  const result = SommAI.parseScanResult(text);
  assert.ok(result);
  // Not deepEqual: JSON.parse runs inside the vm sandbox's own realm, so the resulting array
  // isn't reference-equal to a plain array literal in this file even when structurally equal.
  assert.equal(result.picks.length, 0);
});

test("parseScanResult only reads the first scan-result block if the model repeats itself", () => {
  const text = [
    '<scan-result>{"mode":"bottle","summary":"First","picks":[]}</scan-result>',
    '<scan-result>{"mode":"bottle","summary":"Second","picks":[]}</scan-result>',
  ].join("\n");
  const result = SommAI.parseScanResult(text);
  assert.equal(result.summary, "First");
});
