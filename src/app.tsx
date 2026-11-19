import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { directory, meetId, read, useFeed, write, type Listing } from "./feed";
import {
  model,
  score,
  slotKey,
  standing,
  title,
  turn,
  type Athlete,
  type Lift,
} from "./model";
import { Planner, type Plans } from "./Planner";
import "./style.css";
function Dialog({
  name,
  close,
  children,
}: {
  name: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-label={name}>
      <div className="dialoghead">
        <h2>{name}</h2>
        <button onClick={close} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="dialogbody">{children}</div>
    </dialog>
  );
}
function Finder({ open }: { open: (id: string) => void }) {
  const [items, setItems] = useState<Listing[]>(() => read("directory", [])),
    [message, setMessage] = useState("Loading meet directory…"),
    [q, query] = useState(""),
    [limit, more] = useState(30),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    directory(c.signal)
      .then((list) => {
        setItems(list);
        write("directory", list);
        setMessage("");
      })
      .catch(() => {
        if (!c.signal.aborted) setMessage("Meet directory unavailable");
      });
    return () => c.abort();
  }, [retry]);
  const link = meetId(q),
    results = items.filter((m) =>
      m.name.toLowerCase().includes(q.trim().toLowerCase()),
    );
  return (
    <section className="finder">
      <h2>Select meet</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (link) open(link);
        }}
      >
        <label htmlFor="search">Meet name or LiftingCast URL</label>
        <input
          type="search"
          id="search"
          value={q}
          onChange={(e) => {
            query(e.target.value);
            more(30);
          }}
          placeholder="Search meets or paste a link"
        />
        {link && <button className="primary">Open meet</button>}
      </form>
      {message && (
        <p role="status">
          {message}{" "}
          {message.includes("unavailable") && (
            <button onClick={() => setRetry(retry + 1)}>Retry</button>
          )}
        </p>
      )}
      {!link && (
        <>
          <div className="listhead">
            <span>{q ? "Search results" : "Meets near today"}</span>
            <span>Date</span>
          </div>
          {results.slice(0, limit).map((m) => (
            <button className="row" key={m._id} onClick={() => open(m._id)}>
              <b>{m.name}</b>
              <small>{m.date}</small>
            </button>
          ))}
          {!results.length && !message && <p>No matching meets.</p>}
          {results.length > limit && (
            <button onClick={() => more(limit + 30)}>Show more</button>
          )}
        </>
      )}
    </section>
  );
}
type Prefs = {
  pins: string[];
  platform: string;
  groups: Record<string, string>;
  plans: Plans;
};
function Board({ id, change }: { id: string; change: () => void }) {
  const { snap, status } = useFeed(id),
    m = useMemo(() => model(snap?.docs || []), [snap?.docs]);
  const [prefs, setPrefs] = useState<Prefs>(() =>
    read("prefs:" + id, { pins: [], platform: "", groups: {}, plans: {} }),
  );
  const [storeError, setError] = useState(false);
  function patch(v: Partial<Prefs>) {
    const next = { ...prefs, ...v };
    setError(!write("prefs:" + id, next));
    setPrefs(next);
  }
  const [tab, setTab] = useState("Lifting order"),
    [roster, setRoster] = useState(false),
    [q, setQ] = useState(""),
    [selected, select] = useState(""),
    [classKey, setClass] = useState("");
  const platforms = m.platforms,
    platform = platforms.find((p) => p._id === prefs.platform) || platforms[0];
  const queues = useMemo(
    () => new Map(platforms.map((p) => [p._id, m.queue(p)])),
    [m, platforms],
  );
  const line = platform ? queues.get(platform._id) || [] : [];
  const active = m.byId.get(selected);
  const group = (p: Athlete) =>
    m.groups(p).find((g) => g.key === prefs.groups[p._id]) || m.groups(p)[0];
  const classes = new Map(
    m.people.flatMap((p) => m.groups(p)).map((g) => [g.key, g]),
  );
  const pinnedGroup = prefs.pins
    .map((key) => m.byId.get(key))
    .find((p) => p && group(p));
  const cat =
    classes.get(classKey) ||
    (pinnedGroup && group(pinnedGroup)) ||
    classes.values().next().value;
  const field = cat
    ? m.people.filter((p) =>
        m.groups(p).some((g) => g.key === cat.key && g.eligible),
      )
    : [];
  function pin(id: string) {
    patch({
      pins: prefs.pins.includes(id)
        ? prefs.pins.filter((x) => x !== id)
        : [...prefs.pins, id],
    });
  }
  const ahead = (p: Athlete) =>
    (queues.get(p.platformId || "") || []).findIndex((x) => x.p._id === p._id);
  const pins = prefs.pins
    .map((id) => m.byId.get(id))
    .filter((p): p is Athlete => !!p)
    .sort(
      (a, b) =>
        (ahead(a) < 0 ? Infinity : ahead(a)) -
        (ahead(b) < 0 ? Infinity : ahead(b)),
    );
  function planned(p: Athlete) {
    return Object.entries(prefs.plans)
      .filter(([k]) => k.startsWith(p._id + "/"))
      .filter(([k]) => {
        const [, lift, n] = k.split("/");
        return !p.attempts.some(
          (a) =>
            a.liftName === lift &&
            Number(a.attemptNumber) === Number(n) &&
            a.result,
        );
      })
      .map(([k, v]) => {
        const [, lift, n] = k.split("/");
        const actual = p.attempts.find(
          (a) => a.liftName === lift && Number(a.attemptNumber) === Number(n),
        );
        return (
          <small key={k}>
            {title(lift as Lift)} {n} · planned {v}
            {actual?.weight && Number(actual.weight) !== v
              ? " · posted " + actual.weight + " (differs)"
              : ""}
          </small>
        );
      });
  }
  return (
    <>
      <div className="status" role="status">
        <i className={status === "Live" ? "live" : ""} />
        {status}
        {snap && " · synced " + new Date(snap.at).toLocaleTimeString()}
      </div>
      <header className="meet">
        <div>
          <h1>{m.meet?.name || "Meet scoreboard"}</h1>
        </div>
        <button onClick={change}>Change meet</button>
      </header>
      {storeError && (
        <p role="alert">
          Device storage unavailable. Changes last for this session.
        </p>
      )}
      <section>
        <div className="heading">
          <h2>My lifters</h2>
          <button
            disabled={!m.people.length}
            onClick={() => {
              setRoster(true);
              setQ("");
            }}
          >
            Manage lifters
          </button>
        </div>
        {!pins.length && (
          <div className="empty">
            {snap
              ? "Pin lifters from the meet roster to follow their attempts."
              : "Waiting for the meet roster."}
          </div>
        )}
        <div className="cards">
          {pins.map((p) => {
            const plat = m.map.get(p.platformId || ""),
              i = ahead(p),
              pace = plat && m.pace(plat),
              s = m.next(p),
              g = group(p),
              queue = queues.get(p.platformId || ""),
              a = i >= 0 ? queue?.[i].a : s?.a;
            const peers = g?.eligible
              ? m.people.filter((x) =>
                  m.groups(x).some((c) => c.eligible && c.key === g.key),
                )
              : [];
            return (
              <button
                key={p._id}
                className="card"
                onClick={() => select(p._id)}
              >
                <span className="cardtop">
                  <b>{p.name}</b>
                  <small>Platform {plat?.name || "—"}</small>
                </span>
                <strong>
                  {i >= 0
                    ? turn(i)
                    : s
                      ? "Flight " + (p.flight || "pending")
                      : "Finished"}
                </strong>
                <small>
                  {!s && i < 0
                    ? ""
                    : status !== "Live"
                      ? "Estimate paused"
                      : i === 0
                        ? "On platform"
                        : i > 0 && pace
                          ? "~" + Math.max(1, Math.round(i * pace)) + " min"
                          : i >= 0
                            ? "Estimating pace"
                            : "Awaiting platform order"}
                </small>
                <span className="cardline">
                  {a?.liftName
                    ? title(a.liftName) + " " + a.attemptNumber
                    : s
                      ? title(s.lift) + " " + s.n
                      : "Attempts complete"}
                  {a?.weight
                    ? " · " + a.weight + " " + m.meet?.units?.toLowerCase()
                    : ""}
                </span>
                <small>
                  Place {g?.eligible ? standing(p, peers, g.div) : "—"} ·{" "}
                  {g?.label || "Division pending"}
                </small>
                {planned(p)}
              </button>
            );
          })}
        </div>
      </section>
      <section>
        <div className="heading">
          <h2>Scoreboard</h2>
          <select
            aria-label="Scoreboard platform"
            value={platform?._id || ""}
            onChange={(e) => patch({ platform: e.target.value })}
          >
            {platforms.map((x) => (
              <option value={x._id} key={x._id}>
                Platform {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="switch">
          {["Lifting order", "Standings"].map((t) => (
            <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === "Lifting order" ? (
          <>
            <div className="listhead">
              <span>Platform queue</span>
              <span>{m.meet?.units?.toUpperCase() || "Weight"}</span>
            </div>
            {line.map(({ p, a }, i) => (
              <button className="row" key={a._id} onClick={() => select(p._id)}>
                <span>
                  <b>{p.name}</b>
                  <small>
                    {turn(i)} · {title(a.liftName!)} {a.attemptNumber}
                  </small>
                </span>
                <b>{a.weight}</b>
              </button>
            ))}
            {!line.length && (
              <div className="empty">Waiting for an active platform queue.</div>
            )}
          </>
        ) : (
          <>
            <label>
              Division · all platforms
              <select
                value={cat?.key || ""}
                onChange={(e) => setClass(e.target.value)}
              >
                {[...classes.values()]
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
              </select>
            </label>
            <div className="listhead">
              <span>Place / lifter</span>
              <span>Total · {m.meet?.units}</span>
            </div>
            {field
              .map((p) => ({
                p,
                rank: standing(p, field, cat?.div),
                points: score(p, cat?.div),
              }))
              .sort(
                (a, b) =>
                  (parseInt(a.rank.replace("T", "")) || 999) -
                  (parseInt(b.rank.replace("T", "")) || 999),
              )
              .map(({ p, rank, points }) => (
                <button
                  className="row"
                  key={p._id}
                  onClick={() => select(p._id)}
                >
                  <b>
                    {rank}　{p.name}
                  </b>
                  <span>{points.out ? "Out" : points.total}</span>
                </button>
              ))}
            <small>* Running subtotal · T unresolved tie · — unranked</small>
          </>
        )}
      </section>
      {roster && (
        <Dialog name="My lifters" close={() => setRoster(false)}>
          <input
            aria-label="Search roster"
            type="search"
            placeholder="Search roster"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {m.people
            .filter((p) => p.name?.toLowerCase().includes(q.toLowerCase()))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
            .map((p) => (
              <button
                className="row"
                key={p._id}
                onClick={() => pin(p._id)}
                aria-pressed={prefs.pins.includes(p._id)}
              >
                <span>{p.name}</span>
                <small>
                  {prefs.pins.includes(p._id) ? "Pinned ✓" : "Pin +"}
                </small>
              </button>
            ))}
        </Dialog>
      )}
      {active && (
        <Dialog name={active.name || "Attempt plan"} close={() => select("")}>
          <small>
            {status} · {snap && new Date(snap.at).toLocaleTimeString()}
          </small>
          <Planner
            p={active}
            m={m}
            division={prefs.groups[active._id]}
            choose={(key) =>
              patch({ groups: { ...prefs.groups, [active._id]: key } })
            }
            plans={prefs.plans}
            save={(k, w) => {
              patch({ plans: { ...prefs.plans, [k]: w } });
              select("");
            }}
          />
          {Object.keys(prefs.plans).some((k) =>
            k.startsWith(active._id + "/"),
          ) && (
            <details className="history">
              <summary>Saved attempt plans</summary>
              {Object.entries(prefs.plans)
                .filter(([k]) => k.startsWith(active._id + "/"))
                .map(([k, weight]) => {
                  const [, lift, n] = k.split("/");
                  const actual = active.attempts.find(
                    (a) =>
                      a.liftName === lift &&
                      Number(a.attemptNumber) === Number(n),
                  );
                  return (
                    <p key={k}>
                      {title(lift as Lift)} {n} · planned {weight}{" "}
                      {m.meet?.units?.toLowerCase()}
                      {actual?.weight ? " · posted " + actual.weight : ""}
                      {actual?.result ? " · " + actual.result : ""}
                    </p>
                  );
                })}
            </details>
          )}
        </Dialog>
      )}
    </>
  );
}
function App() {
  const [id, setId] = useState(() => read("meet", "")),
    [finder, show] = useState(false);
  function open(k: string) {
    write("meet", k);
    setId(k);
    show(false);
  }
  return (
    <main>
      <div className="brand">
        <img src="/ops-mark.png" alt="OPS" />
        <b>GAMEDAY <span>TOOLKIT</span></b>
      </div>
      {id ? (
        <Board key={id} id={id} change={() => show(true)} />
      ) : (
        <Finder open={open} />
      )}
      {finder && (
        <Dialog name="Change meet" close={() => show(false)}>
          <Finder open={open} />
        </Dialog>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
