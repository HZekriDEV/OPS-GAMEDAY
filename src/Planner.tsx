import { useState } from "react";
import {
  score,
  standing,
  title,
  slotKey,
  type Athlete,
  type Meet,
  type Pick,
  type Slot,
} from "./model";
export type Plans = Record<string, number>;
export function Planner({
  p,
  m,
  division,
  choose,
  plans,
  save,
}: {
  p: Athlete;
  m: Meet;
  division: string;
  choose: (key: string) => void;
  plans: Plans;
  save: (key: string, weight: number) => void;
}) {
  const groups = m.groups(p),
    g = groups.find((g) => g.key === division) || groups[0];
  const s = m.next(p);
  const currentSlot = s ? slotKey(p, s) : "";
  const [editingSlot, setEditingSlot] = useState(currentSlot);
  return (
    <>
      <label>
        Awards division
        <select value={g?.key || ""} onChange={(e) => choose(e.target.value)}>
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      {s && editingSlot !== currentSlot ? (
        <div role="status">
          <p>The official attempt changed while this plan was open.</p>
          <button onClick={() => setEditingSlot(currentSlot)}>
            Plan {title(s.lift)} {s.n}
          </button>
        </div>
      ) : s ? (
        <Scenario key={slotKey(p, s)} {...{ p, m, s, plans, save }} group={g} />
      ) : (
        <p>
          All scheduled attempts are complete, or the meet has not assigned
          events yet.
        </p>
      )}
    </>
  );
}
type Group = ReturnType<Meet["groups"]>[number];
function Scenario({
  p,
  m,
  s,
  plans,
  save,
  group,
}: {
  p: Athlete;
  m: Meet;
  s: Slot;
  plans: Plans;
  save: (k: string, v: number) => void;
  group?: Group;
}) {
  const div = group?.div,
    unit = m.meet?.units?.toLowerCase() || "kg",
    step = unit === "kg" ? 2.5 : 5;
  const [draft, setWeight] = useState<string>();
  const weight = draft ?? String(plans[slotKey(p, s)] || s.a?.weight || "");
  const [make, setMake] = useState(true);
  const field = group?.eligible
    ? m.people.filter((x) =>
        m.groups(x).some((g) => g.eligible && g.key === group.key),
      )
    : [];
  const rivals = field
    .filter((x) => x._id !== p._id)
    .sort(
      (a, b) =>
        Math.abs(score(a, div).total - score(p, div).total) -
        Math.abs(score(b, div).total - score(p, div).total),
    );
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const groupKey = group?.key ?? "";
  const shown = (
    added[groupKey] ?? rivals.slice(0, 1).map((r) => r._id)
  ).filter((id) => rivals.some((r) => r._id === id));
  const [edits, setEdits] = useState<
    Record<string, { key: string; weight: string; make: boolean }>
  >({});
  const valid = Number.isFinite(+weight) && +weight > 0;
  const mine: Pick = { lift: s.lift, n: s.n, weight: +weight, make };
  const base = valid ? { [p._id]: mine } : {};
  const posted: Record<string, Pick> = { ...base },
    scenario: Record<string, Pick> = { ...base };
  for (const r of rivals) {
    const t = m.next(r);
    if (!t) continue;
    const pick = {
      lift: t.lift,
      n: t.n,
      weight: Number(t.a?.weight || 0),
      make: true,
    };
    if (pick.weight > 0) posted[r._id] = pick;
    const edit = edits[r._id];
    const custom =
      edit?.key === slotKey(r, t)
        ? { ...pick, make: edit.make, weight: Number(edit.weight) }
        : pick;
    if (custom.weight > 0) scenario[r._id] = custom;
  }
  const rank = (picks: Record<string, Pick>) =>
    valid && group?.eligible ? standing(p, field, div, picks) : "—";
  const supported = div?.scoreBy === "TOTAL" && group?.eligible;
  const outcome = score(p, div, mine);
  return (
    <>
      <h3>
        {title(s.lift)} {s.n}
      </h3>
      <label>
        Planned weight ({unit})
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={weight}
          placeholder={String(s.a?.weight || "Weight")}
          onChange={(e) => setWeight(e.target.value)}
        />
      </label>
      <div className="switch">
        {[true, false].map((v) => (
          <button
            aria-pressed={make === v}
            key={String(v)}
            onClick={() => setMake(v)}
          >
            {v ? "Make" : "Miss"}
          </button>
        ))}
      </div>
      <div className="metrics">
        <div>
          <small>Current totals</small>
          <strong>{rank(base)}</strong>
        </div>
        <div>
          <small>Rivals make posted lifts</small>
          <strong>{rank(posted)}</strong>
        </div>
      </div>
      <p className="muted">
        {supported
          ? "Projected division place · * running subtotal · T unresolved tie"
          : "Place unavailable for this scoring method or weight class."}
      </p>
      <h3>Rival scenarios</h3>
      {shown.map((id) => {
        const r = m.byId.get(id);
        if (!r) return null;
        const t = m.next(r);
        if (!t) return <p key={id}>{r.name} · finished</p>;
        const key = slotKey(r, t),
          e =
            edits[id]?.key === key
              ? edits[id]
              : { key, make: true, weight: String(t.a?.weight || "") };
        const update = (data: Partial<typeof e>) =>
          setEdits({ ...edits, [id]: { ...e, ...data } });
        const before = score(r, div),
          best = Math.max(
            0,
            ...r.attempts
              .filter(
                (a) =>
                  a.liftName === t.lift &&
                  a.result === "good" &&
                  Number(a.attemptNumber) <= 3,
              )
              .map((a) => Number(a.weight)),
          );
        const equalWins = !!(
          p.bodyWeight &&
          r.bodyWeight &&
          r.bodyWeight < p.bodyWeight
        );
        const needed = outcome.total - before.total + best;
        const target = Math.max(
          step,
          (equalWins
            ? Math.ceil(needed / step)
            : Math.floor(needed / step) + 1) * step,
          Number(t.a?.weight) || 0,
        );
        return (
          <div className="rival" key={id}>
            <b>{r.name}</b>
            <label>
              {title(t.lift)} {t.n} ·{" "}
              {t.a?.weight ? "posted " + t.a.weight + " " + unit : "unposted"}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="Hypothetical weight"
                value={e.weight}
                onChange={(v) => update({ weight: v.target.value })}
              />
            </label>
            <div className="switch">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  aria-pressed={e.make === v}
                  onClick={() => update({ make: v })}
                >
                  {v ? "Make" : "Miss"}
                </button>
              ))}
            </div>
            {supported &&
              valid &&
              !before.out &&
              !outcome.out &&
              div?.lifts?.[t.lift] && (
                <small>
                  {before.total > outcome.total ||
                  (before.total === outcome.total && equalWins)
                    ? "Already ahead on totals"
                    : "To move ahead: " +
                      target +
                      " " +
                      unit +
                      " on a " +
                      step +
                      " " +
                      unit +
                      " increment"}
                </small>
              )}
          </div>
        );
      })}
      {rivals.some((r) => !shown.includes(r._id)) && (
        <select
          aria-label="Add a rival"
          value=""
          onChange={(e) =>
            setAdded({ ...added, [groupKey]: [...shown, e.target.value] })
          }
        >
          <option value="">Add a rival…</option>
          {rivals
            .filter((r) => !shown.includes(r._id))
            .map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
        </select>
      )}
      {rivals.length > 0 && (
        <p>
          Scenario place <b>{rank(scenario)}</b>
        </p>
      )}
      <button
        className="primary wide"
        disabled={!valid}
        onClick={() => save(slotKey(p, s), +weight)}
      >
        Save planned attempt
      </button>
    </>
  );
}
