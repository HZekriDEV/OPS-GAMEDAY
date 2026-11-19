import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { chromium, webkit } from "playwright-core";
import { id, names, meetName, fixture } from "./meet.mjs";

const meet = fixture(),
  issues = [],
  errors = [];
let outage = false,
  invalid = false,
  expired = false,
  ack = -1,
  fullReads = 0;
const feed = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (path.pathname === "/api/meets")
    return res.end(
      JSON.stringify({
        docs: [{ _id: id, name: meetName, date: "11/19/2026" }],
      }),
    );
  if (outage) return res.writeHead(503).end();
  if (invalid)
    return res.end(
      JSON.stringify({
        results: [{ id: "l0", deleted: true }],
        last_seq: null,
      }),
    );
  if (path.pathname.endsWith("_all_docs")) {
    fullReads++;
    return res.end(
      JSON.stringify({
        rows: [...meet.records.values()].map((doc) => ({ id: doc._id, doc })),
        update_seq: meet.history.length,
      }),
    );
  }
  if (expired) {
    expired = false;
    return res.writeHead(400).end();
  }
  if (!path.pathname.endsWith("_changes")) return res.writeHead(404).end();
  const since = Number(path.searchParams.get("since"));
  ack = since;
  res.end(
    JSON.stringify({
      results: meet.history.slice(since),
      last_seq: meet.history.length,
    }),
  );
});
await new Promise((resolve) => feed.listen(0, "127.0.0.1", resolve));
const feedUrl = "http://127.0.0.1:" + feed.address().port;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = await readFile(
      join("dist", path === "/" ? "index.html" : path),
    );
    res.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
      }[extname(path)] || "text/html",
    );
    res.end(file);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const browser =
  process.env.AUDIT_BROWSER === "webkit"
    ? await webkit.launch()
    : await chromium.launch({
        channel: process.env.AUDIT_BROWSER || "msedge",
        headless: true,
      });
try {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  // Redirect only the two spectator origins to the local HTTP fixture, preserving browser fetch and service workers.
  await ctx.addInitScript((origin) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) =>
      nativeFetch(
        typeof input === "string"
          ? input.replace(
              /^https:\/\/(?:couchdb\.)?liftingcast\.com(?=\/)/,
              origin,
            )
          : input,
        init,
      );
  }, feedUrl);
  const page = await ctx.newPage();
  page.on("response", (r) => {
    if (process.env.AUDIT_DEBUG) console.log(r.status(), r.url());
  });
  page.on("requestfailed", (r) => {
    if (process.env.AUDIT_DEBUG) console.log(r.url(), r.failure());
  });
  page.on("console", (msg) => {
    if (process.env.AUDIT_DEBUG) console.log(msg.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(7000);
  const button = (name) => page.getByRole("button", { name, exact: true }),
    dialog = page.getByRole("dialog"),
    cards = page.locator(".card");
  async function visibleText(loc, part) {
    await loc.filter({ hasText: part }).first().waitFor();
  }
  async function sync() {
    const goal = meet.history.length;
    await page.waitForFunction(() => true);
    for (let i = 0; i < 100 && ack < goal; i++)
      await new Promise((r) => setTimeout(r, 40));
    assert.ok(
      ack >= goal,
      "change cursor stalled " +
        ack +
        "/" +
        goal +
        " " +
        (await page.locator("body").innerText()) +
        " hidden=" +
        (await page.evaluate(() => document.hidden)),
    );
  }
  async function layout(stage) {
    for (const width of [320, 375, 390, 430, 768]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      const bad = await page.evaluate(() => {
        const root =
          document.querySelector("dialog[open]") || document.documentElement;
        const exceeds = [
          root,
          ...root.querySelectorAll(".dialogbody,.card,.row,.rival"),
        ].some((el) => el.scrollWidth > el.clientWidth + 2);
        const tooSmall = [...root.querySelectorAll("input,select")].some(
          (el) =>
            el.offsetWidth && parseFloat(getComputedStyle(el).fontSize) < 16,
        );
        const overlap = [
          ...root.querySelectorAll(
            ".row,.heading,.cardtop,.dialoghead,.metrics",
          ),
        ].some((el) => {
          const [x, y] = [...el.children].map((c) => c.getBoundingClientRect());
          return (
            x &&
            y &&
            x.width &&
            x.right > y.left + 1 &&
            x.top < y.bottom &&
            x.bottom > y.top
          );
        });
        return { exceeds, tooSmall, overlap };
      });
      for (const [k, v] of Object.entries(bad))
        if (v) issues.push(stage + " " + width + " " + k);
    }
    await page.setViewportSize({ width: 375, height: 667 });
  }
  await page.goto(url);
  await page.getByLabel("Meet name or LiftingCast URL").fill("Invitational");
  await page.locator(".row").filter({ hasText: meetName }).click();
  await sync();
  await button("Change meet").click();
  await dialog
    .getByLabel("Meet name or LiftingCast URL")
    .fill("https://liftingcast.com/meets/" + id + "/platforms/p1/board");
  await button("Open meet").click();
  await button("Manage lifters").click();
  for (const i of [0, 1, 3])
    await dialog
      .getByRole("button", { name: names[i] + " Pin +", exact: true })
      .click();
  await layout("roster");
  await button("Close").click();
  await layout("board");
  assert.equal(await cards.count(), 3);
  await visibleText(cards.filter({ hasText: names[0] }), "Lifting now");
  await visibleText(cards.filter({ hasText: names[1] }), "On deck");
  await page.getByLabel("Scoreboard platform").selectOption("p2");
  await cards.filter({ hasText: names[0] }).click();
  await dialog.getByLabel("Planned weight").fill("112.5");
  await dialog.getByLabel("Awards division").selectOption("djunior/w1");
  if ((await dialog.getByLabel("Planned weight").inputValue()) !== "112.5")
    issues.push("division switch lost draft");
  await dialog.getByLabel("Awards division").selectOption("dopen/w1");
  await dialog.getByLabel("Add a rival").selectOption("l3");
  await dialog.locator(".rival").last().getByRole("spinbutton").fill("120");
  await dialog
    .locator(".rival")
    .last()
    .getByRole("button", { name: "Miss" })
    .click();
  await layout("planner");
  await dialog.getByLabel("Planned weight").fill("112.5");
  await button("Save planned attempt").click();
  await visibleText(
    cards.filter({ hasText: names[0] }),
    "posted 100 (differs)",
  );
  await page.reload();
  await visibleText(cards.filter({ hasText: names[0] }), "planned 112.5");
  assert.equal(await page.getByLabel("Scoreboard platform").inputValue(), "p2");
  await page.getByLabel("Scoreboard platform").selectOption("p1");
  const shots = process.env.AUDIT_SHOTS;
  if (shots) {
    await mkdir(shots, { recursive: true });
    await page.screenshot({
      path: join(shots, "scoreboard.png"),
      fullPage: true,
    });
  }
  for (let i = 0; i < meet.attempts.length; i++) {
    const next = meet.attempts[i];
    if (i === 0) {
      await cards.filter({ hasText: names[0] }).click();
      await dialog.getByLabel("Planned weight").fill("177.5");
      meet.advance();
      await sync();
      await visibleText(dialog, "official attempt changed");
      assert.equal(
        await dialog
          .getByRole("button", { name: "Save planned attempt" })
          .count(),
        0,
      );
      await button("Plan Squat 2").click();
      assert.equal(
        await dialog.getByLabel("Planned weight").inputValue(),
        "105",
      );
      await button("Close").click();
      continue;
    }
    if (i === 4) await visibleText(cards.filter({ hasText: names[1] }), "min");
    if (meet.index === 18) {
      outage = true;
      await visibleText(page.getByRole("status"), "Updates delayed");
      await ctx.setOffline(true);
      await visibleText(page.getByRole("status"), "Offline");
      await page.reload();
      await visibleText(cards.filter({ hasText: names[0] }), "Estimate paused");
      await cards.filter({ hasText: names[0] }).click();
      await dialog.getByLabel("Planned weight").fill("75");
      await button("Save planned attempt").click();
      meet.advance();
      outage = false;
      await ctx.setOffline(false);
      await sync();
      continue;
    }
    if (
      next.lifterId === "l0" &&
      next.liftName === "dead" &&
      next.attemptNumber === 3
    ) {
      await cards.filter({ hasText: names[0] }).click();
      await dialog.getByLabel("Planned weight").fill("190");
      await visibleText(dialog.locator(".metrics > div").first(), "1");
      await dialog.getByLabel("Add a rival").selectOption("l3");
      await dialog.locator(".rival").last().getByRole("spinbutton").fill("200");
      await visibleText(
        dialog.locator("p").filter({ hasText: "Scenario place" }),
        "2",
      );
      if (shots) {
        await dialog.locator(".dialogbody").evaluate(el => el.scrollTo(0,0));
        await page.screenshot({ path: join(shots, "planner.png") });
      }
      await button("Save planned attempt").click();
    }
    meet.advance();
    await sync();
    const target = meet.attempts.slice(i + 1).find((a) => a.lifterId !== "l3");
    if (target) {
      const row = page.locator(".row").first();
      await visibleText(row, names[Number(target.lifterId.slice(1))]);
      await visibleText(row, "Lifting now");
    }
  }
  await visibleText(cards.filter({ hasText: names[0] }), "Finished");
  await button("Standings").click();
  const rows = page.locator(".row");
  // Squat + bench + deadlift bests: base 335 plus 7.5 per athlete.
  for (const [i, total, place] of [
    [0, 335, 4],
    [1, 342.5, 3],
    [3, 357.5, 2],
    [4, 365, 1],
  ]) {
    const row = rows.filter({ hasText: names[i] });
    await visibleText(row, String(total));
    assert.match(await row.innerText(), new RegExp("^" + place));
  }
  await visibleText(rows.filter({ hasText: names[2] }), "Out");
  await layout("standings");
  // Correct a recorded third deadlift and then withdraw the correction document.
  const final = meet.attempts.find(
    (a) =>
      a.lifterId === "l0" && a.liftName === "dead" && a.attemptNumber === 3,
  );
  meet.update({ ...final, weight: 200, result: "good" });
  await sync();
  await visibleText(rows.filter({ hasText: names[0] }), "385");
  assert.match(await rows.filter({ hasText: names[0] }).innerText(), /^1/);
  invalid = true;
  await visibleText(page.getByRole("status"), "Updates delayed");
  await visibleText(cards.filter({ hasText: names[0] }), "Finished");
  invalid = false;
  meet.records.delete(final._id);
  meet.history.push({ id: final._id, deleted: true });
  await sync();
  await visibleText(rows.filter({ hasText: names[0] }), "325");
  await cards.filter({ hasText: names[0] }).click();
  await dialog.locator("summary").click();
  await visibleText(dialog.locator(".history"), "Deadlift 3 · planned 190");
  await button("Close").click();
  const before = fullReads;
  expired = true;
  await visibleText(page.getByRole("status"), "Updates delayed");
  await visibleText(page.getByRole("status"), "Live");
  assert.ok(fullReads > before);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { attempts: meet.index, viewports: [320, 375, 390, 430, 768], issues },
      null,
      2,
    ),
  );
  assert.equal(issues.length, 0, "Audit findings listed above");
} finally {
  await browser.close();
  feed.closeAllConnections();
  server.closeAllConnections();
  await Promise.all(
    [feed, server].map((s) => new Promise((resolve) => s.close(resolve))),
  );
}
