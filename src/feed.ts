import { useEffect, useState } from "react";
import type { Doc } from "./model";
export function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem("ops:" + key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function write(key: string, value: unknown) {
  try {
    localStorage.setItem("ops:" + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export type Listing = {
  _id: string;
  name: string;
  date: string;
  dateFormat?: string;
};
export function meetId(input: string) {
  try {
    const u = new URL(input.trim());
    if (
      u.protocol === "https:" &&
      /^(?:[a-z0-9-]+\.)?liftingcast\.com$/i.test(u.hostname)
    )
      return u.pathname.match(/^\/meets\/(m[a-z0-9]+)(?:\/|$)/i)?.[1];
  } catch {
    /* Incomplete URL. */
  }
}
export async function directory(signal: AbortSignal): Promise<Listing[]> {
  const r = await fetch("https://liftingcast.com/api/meets", {
    signal,
    cache: "no-store",
  });
  if (!r.ok) throw Error("Directory unavailable");
  const { docs } = await r.json();
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const distance = (m: Listing) => {
    const [a, b, y] = m.date.split("/").map(Number);
    const dd = m.dateFormat?.startsWith("DD");
    return Math.abs(
      new Date(y, (dd ? b : a) - 1, dd ? a : b, 12).getTime() - noon.getTime(),
    );
  };
  return docs
    .filter((m: Listing) => m.name && m.date)
    .sort((a: Listing, b: Listing) => distance(a) - distance(b));
}
type Raw = Doc & { changes?: { attribute: string; timeStamp: string }[] };
function project(d: Raw): Doc | undefined {
  if (!/^[madlp]/.test(d._id)) return;
  const {
    _id,
    name,
    units,
    platformId,
    flight,
    session,
    lot,
    bodyWeight,
    divisions,
    weightClasses,
    scoreBy,
    lifts,
    currentAttemptId,
    lifterId,
    liftName,
    attemptNumber,
    weight,
    result,
    endOfRound,
    guest,
  } = d;
  const time = d.changes
    ?.filter((c) => c.attribute === "result")
    .pop()?.timeStamp;
  return {
    _id,
    name,
    units,
    platformId,
    flight,
    session,
    lot,
    bodyWeight,
    divisions,
    weightClasses,
    scoreBy,
    lifts,
    currentAttemptId,
    lifterId,
    liftName,
    attemptNumber,
    weight,
    result,
    endOfRound,
    guest,
    time: time ? Date.parse(time) : undefined,
  };
}
type Snapshot = { docs: Doc[]; seq: string | number; at: number };
export function useFeed(id: string) {
  const [snap, setSnap] = useState<Snapshot | undefined>(() => {
    const saved = read<Snapshot | undefined>("snapshot:" + id, undefined);
    const check = read<{ seq: Snapshot["seq"]; at: number } | undefined>(
      "sync:" + id,
      undefined,
    );
    return saved && check?.seq === saved.seq
      ? { ...saved, at: check.at }
      : saved;
  });
  const [status, setStatus] = useState("Connecting");
  useEffect(() => {
    let snapshot = read<Snapshot | undefined>("snapshot:" + id, undefined);
    let map = new Map(snapshot?.docs.map((d) => [d._id, d]));
    let needsFullSnapshot = !snapshot;
    let immediate = true;
    let stopped = false,
      epoch = 0,
      timer: ReturnType<typeof setTimeout>,
      controller: AbortController;
    const base = "https://couchdb.liftingcast.com/" + id + "_readonly/";
    async function sync(generation: number) {
      if (stopped || generation !== epoch) return;
      if (!navigator.onLine) {
        setStatus("Offline");
        return;
      }
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 24000);
      try {
        const incremental = !!snapshot && !needsFullSnapshot;
        const path =
          incremental && snapshot
            ? "_changes?include_docs=true&" +
              (immediate ? "" : "feed=longpoll&timeout=10000&") +
              "since=" +
              encodeURIComponent(snapshot.seq)
            : "_all_docs?include_docs=true&update_seq=true";
        const res = await fetch(base + path, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (incremental && res.status === 400) needsFullSnapshot = true;
        if (!res.ok)
          throw Error(
            res.status === 404 ? "Meet feed unavailable" : "Updates delayed",
          );
        const data = await res.json();
        if (stopped || generation !== epoch) return;
        const rows = incremental ? data.results : data.rows;
        const seq = incremental ? data.last_seq : data.update_seq;
        if (
          !Array.isArray(rows) ||
          !["number", "string"].includes(typeof seq) ||
          rows.some(
            (row) =>
              !row ||
              typeof row.id !== "string" ||
              (!row.deleted && row.doc?._id !== row.id),
          )
        )
          throw Error("Updates delayed");
        const updated = !incremental
          ? new Map<string, Doc>()
          : rows.length
            ? new Map(map)
            : map;
        for (const row of rows) {
          if (row.deleted) updated.delete(row.id);
          else if (row.doc) {
            const d = project(row.doc);
            if (d) updated.set(d._id, d);
          }
        }
        if (!updated.has(id)) throw Error("Meet feed unavailable");
        map = updated;
        needsFullSnapshot = false;
        const changed = rows.length > 0 || !snapshot;
        snapshot = {
          docs: rows.length || !snapshot ? [...map.values()] : snapshot.docs,
          seq,
          at: Date.now(),
        };
        if (changed) write("snapshot:" + id, snapshot);
        write("sync:" + id, { seq: snapshot.seq, at: snapshot.at });
        immediate = false;
        setSnap(snapshot);
        setStatus("Live");
        timer = setTimeout(() => sync(generation), 100);
      } catch (err) {
        if (stopped || generation !== epoch) return;
        setStatus(
          navigator.onLine
            ? err instanceof Error && err.message === "Meet feed unavailable"
              ? err.message
              : "Updates delayed"
            : "Offline",
        );
        timer = setTimeout(() => sync(generation), 3000);
      } finally {
        clearTimeout(timeout);
      }
    }
    function restart() {
      immediate = true;
      epoch++;
      controller?.abort();
      clearTimeout(timer);
      if (document.hidden) return;
      setStatus(navigator.onLine ? "Connecting" : "Offline");
      void sync(epoch);
    }
    restart();
    window.addEventListener("online", restart);
    window.addEventListener("offline", restart);
    document.addEventListener("visibilitychange", restart);
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timer);
      window.removeEventListener("online", restart);
      window.removeEventListener("offline", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [id]);
  return { snap, status };
}
