export const dynamic = "force-dynamic";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { serviceDB } from "@/lib/database";
import { processEmailQueue } from "@/lib/email";
import type { Notification, Preferences } from "@/lib/notification-types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization") || "";
  const expected = "Bearer " + secret;
  if (
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceDB();
  try {
    const count = await db.rpc<number>("scheduler_tick");
    // Reminder occurrences are scheduled in the database, so alerts fire even when no browser is open.
    const reminders = await db.rpc<number>("reminders_tick");
    const email = await processEmailQueue(20);
    let sent = 0;
    let failed = 0;
    if (
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
    ) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      const jobs = await db.rpc<
        {
          id: string;
          notification: Notification;
          preferences: Preferences;
          subscriptions: {
            id: string;
            endpoint: string;
            keys: { auth: string; p256dh: string };
          }[];
        }[]
      >("claim_push_jobs", { p_limit: 20 });
      for (const job of jobs) {
        try {
          const p = job.preferences;
          if (
            p.muted ||
            p.categories?.[job.notification.category]?.muted ||
            (p.snoozed_until && new Date(p.snoozed_until) > new Date())
          ) {
            await db.rpc("finish_push_job", {
              p_id: job.id,
              p_ok: true,
              p_error: "Muted by user",
            });
            continue;
          }
          const payload = JSON.stringify({
            id: job.notification.id,
            title: "Orbit · " + job.notification.category.replace(/-/g, " "),
            body: "You have a new update. Sign in to your workspace to view it.",
            url: job.notification.link || "/notifications",
          });
          if (!job.subscriptions.length) {
            await db.rpc("finish_push_job", {
              p_id: job.id,
              p_ok: true,
              p_error: "No subscribed devices",
            });
            continue;
          }
          let errors = 0;
          const results = await Promise.allSettled(
            job.subscriptions.map((s) =>
              webpush.sendNotification(
                { endpoint: s.endpoint, keys: s.keys },
                payload,
                { TTL: 86400, timeout: 10000 },
              ),
            ),
          );
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === "rejected") {
              const status = result.reason?.statusCode;
              if (status === 404 || status === 410) {
                await db.run(async (c) => {
                  await c.query(
                    "delete from public.push_subscriptions where id=$1",
                    [job.subscriptions[i].id],
                  );
                });
              } else errors++;
            }
          }
          await db.rpc("finish_push_job", {
            p_id: job.id,
            p_ok: errors === 0,
            p_error: errors ? "Push delivery failed; scheduled retry" : null,
          });
          if (errors) failed++;
          else sent++;
        } catch {
          failed++;
          await db.rpc("finish_push_job", {
            p_id: job.id,
            p_ok: false,
            p_error: "Push service unavailable",
          });
        }
      }
    }
    return NextResponse.json({
      ok: true,
      notifications: count,
      reminders,
      email,
      push_sent: sent,
      push_failed: failed,
    });
  } catch (e) {
    try {
      await db.run(async (c) => {
        await c.query(
          "insert into public.scheduler_runs(finished_at,error) values(now(),$1)",
          [e instanceof Error ? e.message : "Unknown scheduler failure"],
        );
      });
    } catch {}
    console.error(
      JSON.stringify({
        event: "scheduler_error",
        message: e instanceof Error ? e.message : "Unknown",
      }),
    );
    return NextResponse.json(
      { error: "Scheduler failed. Check server logs." },
      { status: 500 },
    );
  }
}
