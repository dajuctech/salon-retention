"use client";

// Calendar day grid (design p5) with drag-to-reschedule (US-14 AC2). Dragging uses a handle so a
// tap still opens the booking, and scrolling still works on phones. The server re-checks every
// move exactly like the Reschedule panel; a refused move snaps back with the reason.
import { GripVertical } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { PAYMENT_BADGE } from "@/components/ui";
import { atLocal } from "@/domain/time";
import { moveBookingAction } from "../actions";

export const PX_PER_MIN = 100 / 60;
export const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-status-in-chair text-[#5a3d00]",
  CONFIRMED: "bg-status-confirmed text-brand-900",
  IN_PROGRESS: "bg-status-in-chair text-[#5a3d00]",
  COMPLETED: "bg-status-done text-ink",
  NO_SHOW: "bg-status-danger text-status-danger-ink",
};
export const STATUS_TEXT: Record<string, string> = { PENDING: "Pending", CONFIRMED: "Confirmed", IN_PROGRESS: "In chair", COMPLETED: "Done", NO_SHOW: "No-show" };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Booking = { id: string; startMin: number; durationMin: number; customer: string; service: string; status: string; paymentStatus: string; walkIn: boolean; movable: boolean };
type Column = { id: string; name: string; bookings: Booking[] };

type Drag = { bookingId: string; fromCol: number; startMin: number; durationMin: number; x0: number; y0: number; col: number; min: number };

export function CalendarGrid({
  columns: initialColumns,
  from,
  to,
  nowMin,
  dateKey,
  gridMin,
  timeZone,
}: {
  columns: Column[];
  from: number;
  to: number;
  nowMin: number | null;
  dateKey: string;
  gridMin: number;
  timeZone: string;
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [, start] = useTransition();
  const gridRef = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const [y, mo, d] = dateKey.split("-").map(Number);

  function colWidth(): number {
    const el = gridRef.current?.querySelector<HTMLElement>("[data-col]");
    return el?.getBoundingClientRect().width ?? 140;
  }

  function onPointerDown(e: React.PointerEvent, colIdx: number, b: Booking) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setMessage(null);
    setDrag({ bookingId: b.id, fromCol: colIdx, startMin: b.startMin, durationMin: b.durationMin, x0: e.clientX, y0: e.clientY, col: colIdx, min: b.startMin });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const deltaMin = Math.round((e.clientY - drag.y0) / PX_PER_MIN / gridMin) * gridMin;
    const deltaCol = Math.round((e.clientX - drag.x0) / colWidth());
    const min = Math.max(from, Math.min(to - drag.durationMin, drag.startMin + deltaMin));
    const col = Math.max(0, Math.min(columns.length - 1, drag.fromCol + deltaCol));
    if (min !== drag.min || col !== drag.col) setDrag({ ...drag, min, col });
  }

  function onPointerUp() {
    if (!drag) return;
    const d0 = drag;
    setDrag(null);
    if (d0.min === d0.startMin && d0.col === d0.fromCol) return;
    const before = columns;
    // Optimistic move; reverted if the server refuses.
    const moved = columns.map((c, i) => ({
      ...c,
      bookings:
        i === d0.fromCol && i === d0.col
          ? c.bookings.map((b) => (b.id === d0.bookingId ? { ...b, startMin: d0.min } : b))
          : i === d0.fromCol
            ? c.bookings.filter((b) => b.id !== d0.bookingId)
            : i === d0.col
              ? [...c.bookings, { ...columns[d0.fromCol].bookings.find((b) => b.id === d0.bookingId)!, startMin: d0.min }]
              : c.bookings,
    }));
    setColumns(moved);
    const startsAt = atLocal(timeZone, y, mo, d, 0, d0.min).toISOString();
    start(async () => {
      const r = await moveBookingAction(d0.bookingId, startsAt, columns[d0.col].id);
      if (r?.error) {
        setColumns(before);
        setMessage({ text: r.error, error: true });
      } else {
        setMessage({ text: `Moved to ${hhmm(d0.min)}${d0.col !== d0.fromCol ? ` with ${columns[d0.col].name}` : ""}. The customer gets an updated confirmation.`, error: false });
      }
    });
  }

  return (
    <>
      {message && (
        <p role={message.error ? "alert" : "status"} className={`mt-3 rounded-xl px-4 py-2 text-sm ${message.error ? "bg-status-danger text-status-danger-ink" : "bg-brand-50 text-brand-900"}`}>
          {message.text}
        </p>
      )}
      <div className="mt-4 overflow-x-auto pb-4">
        <div ref={gridRef} className="relative flex" style={{ minWidth: columns.length > 2 ? `${columns.length * 140 + 48}px` : undefined }}>
          <div className="w-12 shrink-0 pt-7" aria-hidden>
            {hours.map((m) => (
              <div key={m} className="relative text-xs text-ink-muted" style={{ height: m === to ? 0 : 60 * PX_PER_MIN }}>
                <span className="absolute -top-2">{hhmm(m)}</span>
              </div>
            ))}
          </div>
          {columns.map((col, ci) => (
            <div key={col.id} data-col className="min-w-0 flex-1 px-1" role="region" aria-label={`${col.name}'s bookings`}>
              <p className="h-7 text-center text-sm font-bold">{col.name}</p>
              <div className="relative" style={{ height: (to - from) * PX_PER_MIN }}>
                {hours.slice(0, -1).map((m) => (
                  <div key={m} className="absolute inset-x-0 border-t border-border" style={{ top: (m - from) * PX_PER_MIN }} aria-hidden />
                ))}
                {col.bookings.length === 0 && <p className="sr-only">No bookings.</p>}
                {col.bookings.map((b) => {
                  const dragging = drag?.bookingId === b.id;
                  return (
                    <div
                      key={b.id}
                      className={`absolute inset-x-0.5 flex overflow-hidden rounded-lg text-xs leading-tight ${STATUS_STYLE[b.status]} ${dragging ? "opacity-40" : ""}`}
                      style={{ top: (b.startMin - from) * PX_PER_MIN + 1, height: Math.max(40, b.durationMin * PX_PER_MIN - 2) }}
                    >
                      <Link href={`/app/bookings/${b.id}`} className="min-w-0 flex-1 px-2 py-0.5">
                        <span className="block truncate text-sm font-bold">{b.customer}</span>
                        <span className="block truncate">
                          {hhmm(b.startMin)} · {b.service} · {STATUS_TEXT[b.status]} · {PAYMENT_BADGE[b.paymentStatus]?.label ?? b.paymentStatus}
                          {b.walkIn ? " · walk-in" : ""}
                        </span>
                      </Link>
                      {b.movable && (
                        <button
                          type="button"
                          aria-label={`Drag to move ${b.customer}'s booking. Or open it and use Reschedule.`}
                          onPointerDown={(e) => onPointerDown(e, ci, b)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          onPointerCancel={() => setDrag(null)}
                          className="flex w-6 shrink-0 cursor-grab touch-none items-center justify-center opacity-60 hover:opacity-100"
                        >
                          <GripVertical className="size-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  );
                })}
                {drag && drag.col === ci && (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 rounded-lg border-2 border-dashed border-brand-900 bg-brand-50/70 px-2 py-0.5 text-xs font-bold text-brand-900"
                    style={{ top: (drag.min - from) * PX_PER_MIN + 1, height: Math.max(40, drag.durationMin * PX_PER_MIN - 2) }}
                    aria-hidden
                  >
                    {hhmm(drag.min)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {nowMin !== null && nowMin >= from && nowMin <= to && (
            <div className="pointer-events-none absolute right-0 flex items-center" style={{ left: 0, top: 28 + (nowMin - from) * PX_PER_MIN - 7 }} aria-hidden>
              <span className="rounded bg-accent-500 px-1.5 text-[10px] font-bold text-brand-900">NOW</span>
              <span className="h-0.5 flex-1 bg-accent-500" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
