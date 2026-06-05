"use client";

import { useEffect, useMemo, useState } from "react";
import { LINEUP, STAGES, STAGE_COLORS, STAGE_EMOJIS, type Slot } from "@/data/lineup";

function getNow(): Date {
  return new Date();
}

function getCurrentSlot(stage: string, now = getNow()): Slot | null {
  return LINEUP.find((slot) => slot.stage === stage && new Date(slot.start) <= now && new Date(slot.end) > now) ?? null;
}

function getNextSlot(stage: string, now = getNow()): Slot | null {
  return LINEUP
    .filter((slot) => slot.stage === stage && new Date(slot.start) > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;
}

function formatCEST(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getCopenhagenDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function getDayLabel(date: Date): string {
  const dateKey = getCopenhagenDateKey(date);
  if (dateKey === "2026-06-05") return "FRI 5 JUNE";
  if (dateKey === "2026-06-06") return "SAT 6 JUNE";
  return "SEE YOU NEXT YEAR 👋";
}

function formatCopenhagenClock(date: Date): string {
  return `${date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} CEST`;
}

export default function Lineup() {
  const [now, setNow] = useState(() => getNow());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(getNow());
      setTick((value) => value + 1);
    }, 30000);

    return () => clearInterval(id);
  }, []);

  const stageRows = useMemo(
    () =>
      STAGES.map((stage) => ({
        stage,
        color: STAGE_COLORS[stage],
        emoji: STAGE_EMOJIS[stage],
        currentSlot: getCurrentSlot(stage, now),
        nextSlot: getNextSlot(stage, now),
      })),
    [now]
  );

  return (
    <section className="lineup-screen" aria-label="Lineup">
      <div className="lineup-header">
        <span>{getDayLabel(now)}</span>
        <span>{formatCopenhagenClock(now)}</span>
      </div>
      <span hidden>{tick}</span>

      {stageRows.map(({ stage, color, emoji, currentSlot, nextSlot }) => (
        <article
          className="lineup-card"
          key={stage}
          style={{
            borderLeft: `3px solid ${color}`,
          }}
        >
          <div className="lineup-stage" style={{ color }}>
            {emoji} {stage}
          </div>

          <div className="lineup-now">
            <span>NOW</span>
            {currentSlot ? (
              <div className="lineup-now-artist">
                <span className="lineup-now-dot" />
                <strong>{currentSlot.artist}</strong>
                <small>until {formatCEST(currentSlot.end)}</small>
              </div>
            ) : (
              <p>— nothing playing</p>
            )}
          </div>

          {nextSlot && (
            <div className="lineup-next">
              <span>NEXT:</span>
              <strong>{nextSlot.artist}</strong>
              <small>from {formatCEST(nextSlot.start)}</small>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
