import { notFound } from "next/navigation";
import { z } from "zod";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { context, grants, allowed, can, referencesFor } from "@/lib/database";
import { roleLabel } from "@/lib/roles";
import { moduleMap, type BusinessRecord, type Profile } from "@/lib/modules";
import { RecordDetails, type Question } from "@/components/record-details";
import { type Reference } from "@/components/record-form";
import { type Attachment } from "@/components/attachments";
import { ProjectActivity } from "@/components/project-activity";
import { AttendanceLocationDetails } from "@/components/attendance-overview";
import { CredentialsPanel } from "@/components/credentials/credentials-panel";
import type { Credential } from "@/lib/credentials";
import { vaultConfigured } from "@/lib/vault";
export default async function Detail({
  params,
  searchParams,
}: {
  params: { module: string; id: string };
  searchParams?: { tab?: string };
}) {
  if (
    !moduleMap[params.module] ||
    !z.string().uuid().safeParse(params.id).success
  )
    notFound();
  const { db, profile } = await context();
  const records = await db.select<BusinessRecord>(
    "records",
    `select=*&id=eq.${params.id}&module=eq.${params.module}`,
  );
  if (!records.length) notFound();
  const r = records[0];
  const [
    permissions,
    people,
    references,
    files,
    questions,
    history,
    payments,
    movements,
  ] = await Promise.all([
    grants(db),
    db.select<Profile>("profiles"),
    referencesFor(db, params.module),
    db.select<Attachment>("attachments", "select=*&record_id=eq." + r.id),
    db.select<Question>(
      "questions",
      "select=*&record_id=eq." + r.id + "&order=created_at.asc",
    ),
    db.select<{
      id: number;
      action: string;
      actor_id: string;
      created_at: string;
      snapshot: Record<string, unknown>;
    }>(
      "history",
      "select=*&record_id=eq." + r.id + "&order=created_at.desc&limit=200",
    ),
    db.select<{
      id: string;
      amount: number;
      reference: string;
      method: string;
      created_at: string;
    }>("payments", "select=*&record_id=eq." + r.id + "&order=created_at.desc"),
    db.select<{
      id: string;
      kind: string;
      quantity: number;
      note: string;
      created_at: string;
    }>(
      "stock_movements",
      "select=*&item_id=eq." + r.id + "&order=created_at.desc",
    ),
  ]);
  if (r.module === "purchases") {
    const catalog = await db.rpc<Reference[]>("purchase_catalog");
    for (const item of catalog)
      if (!references.some((reference) => reference.id === item.id))
        references.push(item);
  }
  const related =
    params.module === "projects"
      ? await db.select<BusinessRecord>(
          "records",
          "select=*&module=in.(tasks,eod,expenses)&status=neq.Archived&data->>project_id=eq." +
            r.id +
            "&order=updated_at.desc&limit=500",
        )
      : [];
  // Credentials are offered on client records to people granted credential access.
  const canManageCredentials =
    params.module === "clients" &&
    allowed(profile, permissions, "credentials", "view", r.owner_id);
  let credentialsTab: React.ReactNode;
  if (canManageCredentials) {
    if (!vaultConfigured())
      credentialsTab = (
        <p className="notice">
          Credential storage is not configured on this server. An administrator
          must set CREDENTIALS_ENCRYPTION_KEY before credentials can be saved.
        </p>
      );
    else {
      const [credentials, projects] = await Promise.all([
        db.select<Credential>(
          "client_credentials",
          "select=*&client_id=eq." +
            r.id +
            "&order=service_name.asc&limit=1000",
        ),
        db.select<{ id: string; title: string }>(
          "records",
          "select=id,title&module=eq.projects&status=neq.Archived&order=title.asc&limit=500",
        ),
      ]);
      credentialsTab = (
        <CredentialsPanel
          client={{ id: r.id, title: r.title, status: r.status }}
          credentials={credentials}
          people={people.map((p) => ({ id: p.id, full_name: p.full_name }))}
          projects={projects}
          canHistory={allowed(profile, permissions, "credentials", "history", r.owner_id)}
          canEdit={allowed(profile, permissions, "credentials", "edit", r.owner_id)}
          canReveal={allowed(profile, permissions, "credentials", "reveal", r.owner_id)}
          isAdmin={profile.role === "super_admin"}
        />
      );
    }
  }
  return (
    <>
      <RecordDetails
        record={r}
        profile={profile}
        people={people}
        references={references}
        files={files}
        questions={questions}
        history={history}
        payments={payments}
        movements={movements}
        canEdit={allowed(profile, permissions, r.module, "edit", r.owner_id)}
        canApprove={allowed(
          profile,
          permissions,
          r.module,
          "approve",
          r.owner_id,
        )}
        canUpload={allowed(
          profile,
          permissions,
          r.module,
          "upload",
          r.owner_id,
        )}
        credentials={credentialsTab}
        initialTab={searchParams?.tab}
      />
      {params.module === "attendance" && r.data.clock_in ? (
        <section className="panel mt-6 p-5" aria-labelledby="attendance-location">
          <h2 id="attendance-location" className="section-title">Check-in and check-out locations</h2>
          <AttendanceLocationDetails
            data={r.data}
            original={(r.data.original as Record<string, unknown>) || null}
            timezone={
              (await db.select<{ data: { timezone?: string } }>("settings", "select=data&id=eq.1"))[0]?.data.timezone ||
              "Asia/Kolkata"
            }
          />
        </section>
      ) : null}
      {params.module === "projects" && (
        <ProjectActivity
          records={related}
          budget={Number(r.data.budget || 0)}
        />
      )}
      {params.module === "employees" &&
        can(profile, permissions, "users", "permissions") &&
        (() => {
          const person = people.find((p) => p.id === r.owner_id);
          if (!person) return null;
          const editable =
            person.role !== "super_admin" &&
            (profile.role === "super_admin" || person.id !== profile.id);
          return (
            <section className="panel mt-6 flex flex-wrap items-center gap-4 p-5">
              <div className="icon-tile h-10 w-10 rounded-xl">
                <KeyRound size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="section-title">Access & permissions</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {person.full_name} · {roleLabel(person.role)}
                  {person.role === "super_admin"
                    ? " · Full access"
                    : " · Choose which pages and actions this person can use."}
                </p>
              </div>
              {editable && (
                <Link
                  href={`/settings/roles?user=${person.id}`}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  <KeyRound size={14} /> Manage permissions
                </Link>
              )}
            </section>
          );
        })()}
    </>
  );
}
