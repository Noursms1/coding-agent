const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "5 minutes ago", with the exact time on hover. */
export function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let text = "just now";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      text = format.format(Math.round(seconds / size), unit);
      break;
    }
  }
  return (
    <time dateTime={iso} title={date.toLocaleString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
