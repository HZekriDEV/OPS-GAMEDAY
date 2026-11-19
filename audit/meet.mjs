export const id = "maudit";
export const names = [
  "Morgan Wellington-Santiago",
  "Alexandria MaximilianMontgomeryWellington",
  "Sam North",
  "Riley Cross",
  "Jules West",
];
export const meetName = "Invitational Powerlifting Championships · Session One";
export const longPlatform = "WarmupHallChampionshipPlatformNorth";
const lifts = ["squat", "bench", "dead"];
const athletes = names.map((name, i) => ({
  _id: "l" + i,
  name,
  platformId: i === 3 ? "p2" : "p1",
  session: 1,
  flight: i === 4 ? "B" : "A",
  bodyWeight: [74, 73, 72, 71, 70][i],
  lot: i + 1,
  divisions: (i === 0 ? ["dopen", "djunior"] : ["dopen"]).map((divisionId) => ({
    divisionId,
    declaredAwardsWeightClassId: "w1",
  })),
}));
export function fixture() {
  const records = new Map(),
    history = [],
    attempts = [];
  function update(...docs) {
    for (const doc of docs) {
      records.set(doc._id, doc);
      history.push({ id: doc._id, doc });
    }
  }
  update(
    { _id: id, name: meetName, units: "KG" },
    ...["dopen", "djunior"].map((_id) => ({
      _id,
      name: _id === "dopen" ? "Open" : "Junior",
      scoreBy: "TOTAL",
      lifts: { squat: true, bench: true, dead: true },
      weightClasses: { w1: { name: "75 kg", maxWeight: 75 } },
    })),
    ...athletes,
  );
  for (const [l, liftName] of lifts.entries())
    for (const flight of ["A", "B"])
      for (let round = 1; round <= 3; round++)
        for (const [i, p] of athletes.entries()) {
          if (p.flight !== flight) continue;
          const a = {
            _id: "a" + l + round + i,
            lifterId: p._id,
            liftName,
            attemptNumber: round,
            weight: [100, 65, 140][l] + 5 * (round - 1) + i * 2.5,
          };
          attempts.push(a);
          if (round === 1) update(a);
        }
  let index = 0;
  function pointers() {
    for (const [i, name] of ["1", longPlatform].entries()) {
      const platformId = "p" + (i + 1),
        next = attempts
          .slice(index)
          .find(
            (a) =>
              athletes.find((p) => p._id === a.lifterId).platformId ===
              platformId,
          );
      update({ _id: platformId, name, currentAttemptId: next?._id });
    }
  }
  pointers();
  function advance() {
    const a = attempts[index++];
    const good =
      !(a.lifterId === "l2" && a.liftName === "bench") &&
      !(a.lifterId === "l0" && a.liftName === "dead" && a.attemptNumber === 2);
    update({
      ...a,
      result: good ? "good" : "bad",
      changes: [
        {
          attribute: "result",
          timeStamp: new Date(Date.now() - (45 - index) * 20000).toISOString(),
        },
      ],
    });
    const next = attempts.find(
      (b) =>
        b.lifterId === a.lifterId &&
        b.liftName === a.liftName &&
        b.attemptNumber === a.attemptNumber + 1,
    );
    if (next) update(next);
    pointers();
    return a;
  }
  return {
    records,
    history,
    attempts,
    advance,
    update,
    get index() {
      return index;
    },
  };
}
