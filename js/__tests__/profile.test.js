"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFiles } = require("./loadModule");

const { SommProfile } = loadFiles(["data.js", "profile.js"]);

test("buildProfileFromQuiz applies dim/type/adventure/budget effects and marks onboarded", () => {
  const answers = [
    { dims: { tannin: 0.2, sweet: -0.1 } },
    { types: { sparkling: 0.15 }, dims: { acid: 0.1 } },
    { adventure: 0.1 },
    { budget: [15, 30] },
  ];
  const p = SommProfile.buildProfileFromQuiz(answers);
  const base = SommProfile.defaultProfile();

  assert.equal(p.onboarded, true);
  assert.ok(Math.abs(p.dims.tannin - (base.dims.tannin + 0.2)) < 1e-9);
  assert.ok(Math.abs(p.dims.sweet - (base.dims.sweet - 0.1)) < 1e-9);
  assert.ok(Math.abs(p.dims.acid - (base.dims.acid + 0.1)) < 1e-9);
  assert.ok(Math.abs(p.types.sparkling - (base.types.sparkling + 0.15)) < 1e-9);
  assert.ok(Math.abs(p.adventure - (base.adventure + 0.1)) < 1e-9);
  // Compare element-by-element rather than with deepEqual: the vm sandbox has its own
  // realm/Array constructor, so cross-realm arrays that are structurally identical aren't
  // deepStrictEqual-reference-equal to plain arrays created in this test file.
  assert.equal(p.budget.store[0], 15);
  assert.equal(p.budget.store[1], 30);
  // Restaurant budget is derived as store * 2.5, rounded.
  assert.equal(p.budget.restaurant[0], 38);
  assert.equal(p.budget.restaurant[1], 75);
});

test("buildProfileFromQuiz clamps dims to [0,1] even with extreme cumulative effects", () => {
  const answers = Array(10).fill({ dims: { tannin: 0.5 } });
  const p = SommProfile.buildProfileFromQuiz(answers);
  assert.equal(p.dims.tannin, 1);
});

test("buildProfileFromQuiz 'no' answers zero out excluded types and cap related dims", () => {
  const p = SommProfile.buildProfileFromQuiz([{ no: "sweet" }, { no: "oak" }]);
  assert.ok(p.nos.includes("sweet"));
  assert.ok(p.nos.includes("oak"));
  assert.equal(p.types.dessert, 0);
  assert.ok(p.dims.sweet <= 0.15);
  assert.ok(p.dims.oak <= 0.2);
});

test("buildProfileFromQuiz accepts answers that are arrays of effects (multi-select questions)", () => {
  const p = SommProfile.buildProfileFromQuiz([[{ dims: { acid: 0.1 } }, { dims: { fruit: 0.1 } }]]);
  const base = SommProfile.defaultProfile();
  assert.ok(Math.abs(p.dims.acid - (base.dims.acid + 0.1)) < 1e-9);
  assert.ok(Math.abs(p.dims.fruit - (base.dims.fruit + 0.1)) < 1e-9);
});

test("learnFromRating nudges dims toward a loved wine's attrs and records history", () => {
  const p = SommProfile.defaultProfile();
  const startTannin = p.dims.tannin;
  const wine = {
    name: "Big Bold Red", region: "Napa, USA", grape: "Cabernet Sauvignon", type: "red",
    attrs: { body: 0.9, sweet: 0.05, acid: 0.5, tannin: 0.95, fruit: 0.6, oak: 0.7 },
    price: [20, 40],
  };
  SommProfile.learnFromRating(p, wine, "love", "store");

  assert.equal(p.ratingCount, 1);
  assert.equal(p.history.length, 1);
  assert.equal(p.history[0].name, "Big Bold Red");
  assert.equal(p.history[0].rating, "love");
  // Loving a high-tannin wine should move the profile's tannin dim UP toward it.
  assert.ok(p.dims.tannin > startTannin);
  assert.ok(p.grapes["Cabernet Sauvignon"] > 0);
  assert.ok(p.regions["Napa"] > 0);
});

test("learnFromRating pushes dims away from a disliked wine's extreme attrs", () => {
  const p = SommProfile.defaultProfile();
  const startTannin = p.dims.tannin; // .45
  const wine = {
    name: "Harsh Red", type: "red",
    attrs: { body: 0.9, sweet: 0.05, acid: 0.5, tannin: 0.98, fruit: 0.6, oak: 0.7 },
    price: [20, 40],
  };
  SommProfile.learnFromRating(p, wine, "no", "store");
  assert.ok(p.dims.tannin < startTannin);
  assert.ok(p.grapes === p.grapes); // no grape given — should not throw
});

test("learnFromRating: negative ratings for the same grape accumulate below zero", () => {
  const p = SommProfile.defaultProfile();
  const wine = { name: "X", grape: "Merlot", type: "red", attrs: null, price: [10, 20] };
  SommProfile.learnFromRating(p, wine, "no", "store");
  SommProfile.learnFromRating(p, wine, "no", "store");
  assert.equal(p.grapes["Merlot"], -2);
});

test("learnFromRating: learning rate decays as ratingCount grows (later ratings move dims less)", () => {
  const p1 = SommProfile.defaultProfile();
  const wine = {
    name: "W", type: "red",
    attrs: { body: 0.9, sweet: 0.05, acid: 0.5, tannin: 0.95, fruit: 0.6, oak: 0.7 },
    price: [10, 20],
  };
  SommProfile.learnFromRating(p1, wine, "love", "store");
  const firstDelta = p1.dims.tannin - SommProfile.defaultProfile().dims.tannin;

  // Fast-forward a profile that has already rated many wines, then apply the same rating.
  const p2 = SommProfile.defaultProfile();
  p2.ratingCount = 20;
  const tanninBefore = p2.dims.tannin;
  SommProfile.learnFromRating(p2, wine, "love", "store");
  const laterDelta = p2.dims.tannin - tanninBefore;

  assert.ok(laterDelta < firstDelta, "learning rate should decay with experience");
});

test("learnFromRating caps history at 200 entries", () => {
  const p = SommProfile.defaultProfile();
  const wine = { name: "Repeat", type: "red", attrs: null, price: [10, 20] };
  for (let i = 0; i < 205; i++) SommProfile.learnFromRating(p, wine, "ok", "store");
  assert.equal(p.history.length, 200);
  assert.equal(p.ratingCount, 205);
});

test("matchPct returns a wine's identical-palate match near the top of the range", () => {
  const p = SommProfile.defaultProfile();
  p.types.red = 1; // maximize the type-affinity term too, so this wine is a total match
  const perfectWine = { type: "red", attrs: { ...p.dims } };
  const pct = SommProfile.matchPct(p, perfectWine);
  assert.ok(pct >= 90, `expected near-perfect match, got ${pct}`);
});

test("matchPct is clamped to [35, 98]", () => {
  const p = SommProfile.defaultProfile();
  const oppositeWine = {
    type: "dessert",
    attrs: { body: 1 - p.dims.body, sweet: 1 - p.dims.sweet, acid: 1 - p.dims.acid, tannin: 1 - p.dims.tannin, fruit: 1 - p.dims.fruit, oak: 1 - p.dims.oak },
  };
  const pct = SommProfile.matchPct(p, oppositeWine);
  assert.ok(pct >= 35 && pct <= 98);
});

test("matchPct ranks a closer-matching wine higher than a farther one", () => {
  const p = SommProfile.defaultProfile();
  const close = { type: "red", attrs: { ...p.dims, tannin: p.dims.tannin + 0.05 } };
  const far = { type: "red", attrs: { ...p.dims, tannin: 1, sweet: 1, oak: 1 } };
  assert.ok(SommProfile.matchPct(p, close) > SommProfile.matchPct(p, far));
});

test("wineAllowed rejects wines matching a hard 'no', allows everything else", () => {
  const p = SommProfile.defaultProfile();
  p.nos = ["white"];
  assert.equal(SommProfile.wineAllowed(p, { type: "white", attrs: p.dims }), false);
  assert.equal(SommProfile.wineAllowed(p, { type: "red", attrs: p.dims }), true);
});

test("scoreWine rewards liked grapes/regions and penalizes prices far outside budget", () => {
  const p = SommProfile.defaultProfile();
  p.grapes["Malbec"] = 5;
  p.regions["Mendoza"] = 3;
  const cheapMatch = {
    name: "Cheap Malbec", type: "red", grape: "Malbec", region: "Mendoza, Argentina",
    attrs: { ...p.dims }, price: [15, 20], pairs: [],
  };
  const wildlyOverBudget = {
    name: "Trophy Malbec", type: "red", grape: "Malbec", region: "Mendoza, Argentina",
    attrs: { ...p.dims }, price: [500, 900], pairs: [],
  };
  const scoreCheap = SommProfile.scoreWine(p, cheapMatch);
  const scoreExpensive = SommProfile.scoreWine(p, wildlyOverBudget);
  assert.ok(scoreCheap > scoreExpensive);
});

test("scoreWine boosts wines whose pairs match requested food tags", () => {
  const p = SommProfile.defaultProfile();
  const base = { name: "Steak Red", type: "red", attrs: { ...p.dims }, price: [15, 25], pairs: ["steak"] };
  const noFood = SommProfile.scoreWine(p, base, {});
  const withFood = SommProfile.scoreWine(p, base, { foodTags: ["steak"] });
  const wrongFood = SommProfile.scoreWine(p, base, { foodTags: ["sushi"] });
  assert.ok(withFood > noFood);
  assert.ok(wrongFood < noFood);
});

test("scoreWine penalizes a wine recently marked 'no' by exact name", () => {
  const p = SommProfile.defaultProfile();
  const wine = { name: "Rejected Red", type: "red", attrs: { ...p.dims }, price: [15, 25], pairs: [] };
  SommProfile.learnFromRating(p, wine, "no", "store");
  const scoreAfterNo = SommProfile.scoreWine(p, wine);

  const p2 = SommProfile.defaultProfile();
  const scoreFresh = SommProfile.scoreWine(p2, wine);
  assert.ok(scoreAfterNo < scoreFresh);
});
