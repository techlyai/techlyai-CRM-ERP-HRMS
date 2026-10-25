/** Match the company calendar: a special day overrides holidays and weekdays. */
export function attendanceDayStatus({
  date,
  today,
  recordedStatus,
  holidays,
  workingDays,
  specialDays,
}: {
  date: string;
  today: string;
  recordedStatus?: string;
  holidays: string[];
  workingDays: number[];
  specialDays: { date: string; working: boolean }[];
}) {
  if (recordedStatus) return recordedStatus;
  const special = specialDays.find((day) => day.date === date);
  if (special) {
    if (!special.working) return "Day off";
  } else {
    if (holidays.includes(date)) return "Holiday";
    const weekday = new Date(date + "T12:00:00Z").getUTCDay();
    if (!workingDays.includes(weekday)) return "Day off";
  }
  return date <= today ? "Not recorded" : "Upcoming";
}
