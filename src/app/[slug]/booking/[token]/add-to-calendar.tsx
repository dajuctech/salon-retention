"use client";

// Downloads an .ics file so the booking lands in the customer's phone calendar.
function icsDate(iso: string) {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escape(text: string) {
  return text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}

export function AddToCalendar(props: { title: string; startsAt: string; endsAt: string; description: string }) {
  function download() {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//salon-retention//booking//EN",
      "BEGIN:VEVENT",
      `UID:${icsDate(props.startsAt)}-${Math.random().toString(36).slice(2)}@salon-retention`,
      `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(props.startsAt)}`,
      `DTEND:${icsDate(props.endsAt)}`,
      `SUMMARY:${escape(props.title)}`,
      `DESCRIPTION:${escape(props.description)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "booking.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="w-full rounded-2xl bg-brand-900 py-4 text-lg font-semibold text-white"
    >
      Add to my calendar
    </button>
  );
}
