import { describe, it, expect } from "vitest";
import { model, score, standing, type Doc, type Athlete } from "./model";
const division: Doc = { _id: "d1", lifts: { dead: true }, scoreBy: "TOTAL" };
function athlete(id: string, bodyWeight: number, weight: number): Athlete {
  return {
    _id: id,
    bodyWeight,
    platformId: "p1",
    session: 1,
    flight: "A",
    attempts: [
      {
        _id: "a" + id,
        lifterId: id,
        liftName: "dead",
        attemptNumber: 1,
        weight,
        result: "good",
      },
    ],
  };
}
describe("attempt scenarios", () => {
  const a = athlete("la", 74, 200),
    b = athlete("lb", 73, 205);
  it("a rival wins a tied total on lighter bodyweight", () => {
    expect(
      standing(a, [a, b], division, {
        la: { lift: "dead", n: 2, weight: 205, make: true },
      }),
    ).toBe("2");
  });
  it("counts only the improvement to the best lift", () => {
    expect(
      score(a, division, { lift: "dead", n: 2, weight: 210, make: true }).total,
    ).toBe(210);
  });
  it("keeps the previous best on a miss", () => {
    expect(
      score(a, division, { lift: "dead", n: 2, weight: 210, make: false })
        .total,
    ).toBe(200);
  });
  it("models simultaneous rival calls", () => {
    expect(
      standing(a, [a, b], division, {
        la: { lift: "dead", n: 2, weight: 210, make: true },
        lb: { lift: "dead", n: 2, weight: 215, make: false },
      }),
    ).toBe("1");
  });
  it("excludes fourth attempts from totals", () => {
    expect(
      score(
        {
          ...a,
          attempts: [
            ...a.attempts,
            {
              _id: "ax",
              liftName: "dead",
              attemptNumber: 4,
              result: "good",
              weight: 300,
            },
          ],
        },
        division,
      ).total,
    ).toBe(200);
  });
  it("marks a bomb-out on a third miss", () => {
    const p = {
      ...a,
      attempts: [1, 2].map((n) => ({
        ...a.attempts[0],
        result: "bad",
        attemptNumber: n,
      })),
    };
    expect(
      score(p, division, { lift: "dead", n: 3, weight: 200, make: false }).out,
    ).toBe(true);
  });
  it("reports unresolved equal-bodyweight ties", () => {
    expect(standing(a, [a, { ...a, _id: "lr" }], division)).toBe("T1");
  });
  it("counts attempts, including repeat lifters, from the official current pointer", () => {
    const attempts: Doc[] = [
      ["la", 1, 100],
      ["lb", 1, 110],
      ["la", 2, 120],
      ["lb", 2, 125],
    ].map(([id, n, w], i) => ({
      _id: "a" + i,
      lifterId: String(id),
      liftName: "dead",
      attemptNumber: n,
      weight: Number(w),
    }));
    const platform = { _id: "p1", currentAttemptId: "a1" };
    const m = model([a, b, platform, ...attempts]);
    expect(m.queue(platform).map((x) => x.a._id)).toEqual(["a1", "a2", "a3"]);
    const pending = model([a, b, platform, ...attempts.slice(0, 3)]);
    expect(pending.queue(platform).map((x) => x.a._id)).toEqual(["a1"]);
  });
});
