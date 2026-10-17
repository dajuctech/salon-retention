// Display formatting in the salon's timezone (shared by server and client components).

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(iso),
  );
}

/** "Thu 15 Oct" */
export function formatShortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone })
    .format(new Date(iso))
    .replace(",", "");
}

export function formatWeekday(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(new Date(iso));
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 1140 → "7pm", 1170 → "7:30pm" */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

/** "Thu 15 Oct at 11:30" */
export function formatDateTimeLong(iso: string, timeZone: string): string {
  return `${formatShortDate(iso, timeZone)} at ${formatTime(iso, timeZone)}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
