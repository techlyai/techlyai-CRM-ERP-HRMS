import { Reminders, type ReminderView } from "@/components/reminders";
import { context } from "@/lib/database";
import { isUuid, type Reminder, type ReminderPolicy } from "@/lib/reminders";

export const metadata = { title: "Reminders" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: {
    view?: string | string[];
    q?: string | string[];
    page?: string | string[];
    id?: string | string[];
    new?: string | string[];
  };
}) {
  const { db, profile } = await context();
  const view: ReminderView =
    typeof searchParams.view === "string" &&
    ["active", "overdue", "completed", "all"].includes(searchParams.view)
      ? (searchParams.view as ReminderView)
      : "active";
  const requestedPage =
    typeof searchParams.page === "string" ? Number(searchParams.page) : 1;
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 100000)
      : 1;
  const query = (typeof searchParams.q === "string" ? searchParams.q : "")
    .trim()
    .slice(0, 200);
  const selectedId = typeof searchParams.id === "string" ? searchParams.id : "";
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    select: "*",
    order:
      view === "completed" ? "updated_at.desc,id.asc" : "due_at.asc,id.asc",
    limit: String(PAGE_SIZE + 1),
    offset: String((page - 1) * PAGE_SIZE),
  });
  if (view === "active" || view === "overdue")
    params.set("status", "eq.Pending");
  if (view === "completed") params.set("status", "eq.Completed");
  if (view === "overdue") params.set("due_at", "lt." + now);
  if (query) params.set("title", "ilike.*" + query + "*");

  const [rows, settings, people, selected] = await Promise.all([
    db.select<Reminder>("reminders", params.toString()),
    db.select<{ data: ReminderPolicy }>("settings", "select=data&id=eq.1"),
    db.select<{ id: string; full_name: string }>(
      "profiles",
      "select=id,full_name&limit=10000",
    ),
    selectedId && isUuid(selectedId)
      ? db.select<Reminder>("reminders", "select=*&id=eq." + selectedId)
      : Promise.resolve([] as Reminder[]),
  ]);

  return (
    <Reminders
      initial={rows.slice(0, PAGE_SIZE)}
      policy={settings[0]?.data || {}}
      viewer={{ id: profile.id, role: profile.role }}
      names={Object.fromEntries(
        people.map((person) => [person.id, person.full_name]),
      )}
      view={view}
      query={query}
      page={page}
      hasMore={rows.length > PAGE_SIZE}
      selected={selected[0] || null}
      missingSelection={Boolean(selectedId) && !selected.length}
      initiallyCreate={searchParams.new === "1"}
      now={now}
    />
  );
}
