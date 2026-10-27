import { can, grants, type Database } from "./database";
import type { Profile } from "./modules";
import type { MmcClient, MmcDue, MmcMessage, MmcPayment, MmcSettings, MmcSiteLog, DueStatus, PaymentClaim } from "./mmc";

export type MmcAbilities = { view: boolean; manage: boolean; delete: boolean; settings: boolean };
export async function mmcAbilities(db: Database, profile: Profile): Promise<MmcAbilities> {
  const p = await grants(db);
  return {
    view: can(profile, p, "mmc", "view"),
    manage: can(profile, p, "mmc", "manage"),
    delete: can(profile, p, "mmc", "delete"),
    settings: can(profile, p, "mmc", "settings"),
  };
}
/** Client row plus its money position: owed = open dues, credit = unallocated advance. */
export type ClientRow = MmcClient & { status: DueStatus; owed: string; credit: string; days_overdue: number; next_due: string | null };

const today = `(now() at time zone coalesce((select data->>'timezone' from public.settings where id=1),'Asia/Kolkata'))::date`;
const clientSql = `select c.*,
  case when exists(select 1 from public.mmc_dues d where d.client_id=c.id and d.status='Overdue') then 'Overdue'
       when exists(select 1 from public.mmc_dues d where d.client_id=c.id and d.status='Pending') then 'Pending' else 'Paid' end as status,
  coalesce((select sum(d.amount-d.paid_amount) from public.mmc_dues d where d.client_id=c.id and d.status<>'Paid'),0)::text as owed,
  (coalesce((select sum(p.amount) from public.mmc_payments p where p.client_id=c.id),0)
   -coalesce((select sum(a.amount) from public.mmc_allocations a join public.mmc_payments p on p.id=a.payment_id where p.client_id=c.id),0))::text as credit,
  coalesce((select ${today}-min(d.due_date) from public.mmc_dues d where d.client_id=c.id and d.status='Overdue'),0)::int as days_overdue,
  (select min(x)::text from (select (date_trunc('month',${today})::date + (least(c.billing_day, extract(day from date_trunc('month',${today})+interval '1 month - 1 day')::int)-1)) x
     union all select ((date_trunc('month',${today})+interval '1 month')::date + (least(c.billing_day, extract(day from date_trunc('month',${today})+interval '2 month - 1 day')::int)-1))) n where x>=${today}) as next_due
  from public.mmc_clients c`;

export async function listClients(db: Database): Promise<ClientRow[]> {
  return db.run(async (c) => (await c.query(clientSql + " order by lower(c.name)")).rows);
}
export async function clientDetail(db: Database, id: string) {
  return db.run(async (c) => {
    const client = (await c.query(clientSql + " where c.id=$1", [id])).rows[0] as ClientRow | undefined;
    if (!client) return null;
    const [dues, payments, logs, messages] = await Promise.all([
      c.query("select * from public.mmc_dues where client_id=$1 order by period desc limit 36", [id]),
      c.query("select p.*,coalesce((select string_agg(to_char(d.period,'Mon YYYY'),', ' order by d.period) from public.mmc_allocations a join public.mmc_dues d on d.id=a.due_id where a.payment_id=p.id),'') as periods from public.mmc_payments p where client_id=$1 order by paid_on desc,receipt_no desc limit 100", [id]),
      c.query("select l.*,p.full_name as actor_name from public.mmc_site_logs l left join public.profiles p on p.id=l.actor_id where l.client_id=$1 order by l.id desc limit 50", [id]),
      c.query("select * from public.mmc_messages where client_id=$1 order by created_at desc limit 50", [id]),
    ]);
    return {
      client,
      dues: dues.rows as MmcDue[],
      payments: payments.rows as (MmcPayment & { periods: string })[],
      logs: logs.rows as (MmcSiteLog & { actor_name: string | null })[],
      messages: messages.rows as MmcMessage[],
    };
  });
}
export async function mmcSettings(db: Database): Promise<MmcSettings> {
  return db.run(async (c) => (await c.query("select data from public.mmc_settings where id=1")).rows[0]?.data);
}
export async function recentPayments(db: Database, limit = 200) {
  return db.run(
    async (c) =>
      (
        await c.query(
          "select p.*,c.name as client_name from public.mmc_payments p join public.mmc_clients c on c.id=p.client_id order by p.paid_on desc,p.receipt_no desc limit $1",
          [limit],
        )
      ).rows as (MmcPayment & { client_name: string })[],
  );
}
export async function messageLog(db: Database, limit = 200) {
  return db.run(async (c) => (await c.query("select * from public.mmc_messages order by created_at desc limit $1", [limit])).rows as MmcMessage[]);
}
export async function siteLogs(db: Database, limit = 200) {
  return db.run(
    async (c) =>
      (await c.query("select l.*,p.full_name as actor_name from public.mmc_site_logs l left join public.profiles p on p.id=l.actor_id order by l.id desc limit $1", [limit]))
        .rows as (MmcSiteLog & { actor_name: string | null })[],
  );
}
export async function dashboardData(db: Database) {
  return db.run(async (c) => {
    const month = (
      await c.query(`select coalesce(sum(amount),0)::text expected,coalesce(sum(paid_amount),0)::text collected,coalesce(sum(amount-paid_amount),0)::text pending
        from public.mmc_dues where period=date_trunc('month',${today})::date`)
    ).rows[0] as { expected: string; collected: string; pending: string };
    const received = (
      await c.query(`select coalesce(sum(amount),0)::text v from public.mmc_payments where date_trunc('month',paid_on)=date_trunc('month',${today})`)
    ).rows[0].v as string;
    const chart = (
      await c.query(`select to_char(m,'Mon') as label,to_char(m,'YYYY-MM') as month,coalesce((select sum(p.amount) from public.mmc_payments p where date_trunc('month',p.paid_on)=m),0)::float as amount
        from generate_series(date_trunc('month',${today})-interval '11 months',date_trunc('month',${today}),interval '1 month') m order by m`)
    ).rows as { label: string; month: string; amount: number }[];
    // A client billed this month whose due is not yet generated still counts as expected.
    const expectedFull = (
      await c.query(`select coalesce(sum(c.mmc_amount),0)::text v from public.mmc_clients c where c.start_date<=(date_trunc('month',${today})+interval '1 month - 1 day')::date`)
    ).rows[0].v as string;
    return { month, received, chart, expectedFull };
  });
}

export async function pendingClaims(db: Database, clientId?: string) {
  return db.run(
    async (c) =>
      (
        await c.query(
          "select k.*,c.name as client_name from public.mmc_payment_claims k join public.mmc_clients c on c.id=k.client_id where k.status='pending' and ($1::uuid is null or k.client_id=$1) order by k.created_at",
          [clientId || null],
        )
      ).rows as (PaymentClaim & { client_name: string })[],
  );
}
