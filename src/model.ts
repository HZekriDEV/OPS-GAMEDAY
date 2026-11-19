export const lifts = ["squat", "bench", "dead"] as const;
export type Lift = (typeof lifts)[number];
export const title = (lift: Lift) =>
  ({ squat: "Squat", bench: "Bench", dead: "Deadlift" })[lift];
type Entry = {
  divisionId: string;
  declaredAwardsWeightClassId?: string;
  awardsWeightClassId?: string;
  guest?: boolean;
};
export type Doc = {
  _id: string;
  name?: string;
  units?: string;
  platformId?: string;
  flight?: string;
  session?: number;
  lot?: number;
  bodyWeight?: number;
  divisions?: Entry[];
  weightClasses?: Record<string, { name: string; maxWeight: number }>;
  scoreBy?: string;
  lifts?: Partial<Record<Lift, boolean>>;
  currentAttemptId?: string;
  lifterId?: string;
  liftName?: Lift;
  attemptNumber?: number | string;
  weight?: number;
  result?: string;
  time?: number;
  endOfRound?: boolean;
  guest?: boolean;
};
export type Athlete = Doc & { attempts: Doc[] };
export type Slot = { lift: Lift; n: number; a?: Doc };
export function model(docs: Doc[]) {
  const map = new Map(docs.map((d) => [d._id, d]));
  const people: Athlete[] = docs
    .filter((d) => d._id.startsWith("l"))
    .map((d) => ({ ...d, attempts: [] }));
  const byId = new Map(people.map((p) => [p._id, p]));
  for (const a of docs)
    if (a.lifterId && a.liftName) byId.get(a.lifterId)?.attempts.push(a);
  const groups = (p: Athlete) =>
    (p.divisions || []).map((e) => {
      const div = map.get(e.divisionId);
      const classes = Object.entries(div?.weightClasses || {}).sort(
        (a, b) => a[1].maxWeight - b[1].maxWeight,
      );
      const w =
        e.awardsWeightClassId ||
        e.declaredAwardsWeightClassId ||
        classes.find(
          ([, c]) => p.bodyWeight && p.bodyWeight <= c.maxWeight,
        )?.[0];
      return {
        key: e.divisionId + "/" + (w || "?"),
        label: [div?.name, div?.weightClasses?.[w || ""]?.name]
          .filter(Boolean)
          .join(" · "),
        div,
        eligible: !!w && !p.guest && !e.guest,
      };
    });
  function next(p: Athlete): Slot | undefined {
    const divisions = groups(p);
    for (const lift of lifts) {
      if (
        !divisions.some((g) => g.div?.lifts?.[lift]) &&
        !p.attempts.some((a) => a.liftName === lift)
      )
        continue;
      for (let n = 1; n <= 3; n++) {
        const a = p.attempts.find(
          (a) => a.liftName === lift && Number(a.attemptNumber) === n,
        );
        if (!a?.result) return { lift, n, a };
      }
    }
  }
  function queue(platform: Doc) {
    const anchor = map.get(platform.currentAttemptId || "");
    const current = byId.get(anchor?.lifterId || "");
    if (!current || !anchor?.liftName) return [];
    const candidates = people.filter(
      (p) =>
        p.platformId === platform._id &&
        p.session === current.session &&
        p.flight === current.flight,
    );
    const all = candidates.flatMap((p) =>
      p.attempts
        .filter(
          (a) =>
            a.liftName === anchor.liftName && !a.result && Number(a.weight) > 0,
        )
        .map((a) => ({ p, a })),
    );
    all.sort(
      (x, y) =>
        Number(x.a.attemptNumber) - Number(y.a.attemptNumber) ||
        Number(!!x.a.endOfRound) - Number(!!y.a.endOfRound) ||
        Number(x.a.weight) - Number(y.a.weight) ||
        Number(x.p.lot || 0) - Number(y.p.lot || 0),
    );
    const active = all.find((x) => x.a._id === anchor._id);
    if (!active) return [];
    const round = Number(anchor.attemptNumber);
    const remaining = all
      .slice(all.indexOf(active) + 1)
      .filter((x) => Number(x.a.attemptNumber) === round);
    for (let n = round + 1; n <= 3; n++) {
      // Until everyone has posted, a lighter call can change the next round's order.
      const entered = candidates.filter((p) =>
        p.attempts.some((a) => a.liftName === anchor.liftName),
      );
      if (
        !entered.every((p) =>
          p.attempts.some(
            (a) =>
              a.liftName === anchor.liftName &&
              Number(a.attemptNumber) === n &&
              (a.result || Number(a.weight) > 0),
          ),
        )
      )
        break;
      remaining.push(...all.filter((x) => Number(x.a.attemptNumber) === n));
    }
    return [active, ...remaining];
  }
  function pace(platform: Doc) {
    const now = Date.now();
    const times = people
      .filter((p) => p.platformId === platform._id)
      .flatMap((p) =>
        p.attempts
          .filter(
            (a) =>
              a.result && a.time && a.time <= now && now - a.time < 1800000,
          )
          .map((a) => a.time!),
      )
      .sort((a, b) => a - b);
    const gaps = times
      .slice(1)
      .map((t, i) => t - times[i])
      .filter((v) => v > 12000 && v < 240000)
      .slice(-8)
      .sort((a, b) => a - b);
    return gaps.length >= 2
      ? gaps[Math.floor(gaps.length / 2)] / 60000
      : undefined;
  }
  return {
    map,
    people,
    byId,
    groups,
    next,
    queue,
    pace,
    platforms: docs
      .filter((d) => d._id.startsWith("p"))
      .sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, {
          numeric: true,
        }),
      ),
    meet: docs.find((d) => d._id.startsWith("m")),
  };
}
export type Meet = ReturnType<typeof model>;
export type Pick = { lift: Lift; n: number; weight: number; make: boolean };
export function score(p: Athlete, div: Doc | undefined, pick?: Pick) {
  let total = 0,
    complete = true,
    out = false;
  for (const lift of lifts.filter((l) => div?.lifts?.[l])) {
    const set = p.attempts.filter(
      (a) => a.liftName === lift && Number(a.attemptNumber) <= 3,
    );
    const best = Math.max(
      0,
      ...set
        .filter((a) => a.result === "good")
        .map((a) => Number(a.weight) || 0),
      pick?.make && pick.lift === lift ? pick.weight : 0,
    );
    total += best;
    if (!best) {
      complete = false;
      out ||=
        set.filter((a) => a.result).length + (pick?.lift === lift ? 1 : 0) >= 3;
    }
  }
  return { total, complete, out };
}
export function standing(
  p: Athlete,
  field: Athlete[],
  div: Doc | undefined,
  picks: Record<string, Pick> = {},
) {
  const mine = score(p, div, picks[p._id]);
  if (!mine.total || mine.out || div?.scoreBy !== "TOTAL") return "—";
  let rank = 1,
    tied = false;
  for (const rival of field.filter((x) => x._id !== p._id)) {
    const other = score(rival, div, picks[rival._id]);
    if (other.out) continue;
    if (other.total > mine.total) rank++;
    if (other.total === mine.total) {
      if (rival.bodyWeight && p.bodyWeight && rival.bodyWeight < p.bodyWeight)
        rank++;
      else if (
        !rival.bodyWeight ||
        !p.bodyWeight ||
        rival.bodyWeight === p.bodyWeight
      )
        tied = true;
    }
  }
  return (tied ? "T" : "") + rank + (mine.complete ? "" : "*");
}
export const slotKey = (p: Athlete, s: Slot) => [p._id, s.lift, s.n].join("/");
export const turn = (i: number) =>
  i === 0 ? "Lifting now" : i === 1 ? "On deck" : i + " attempts ahead";
