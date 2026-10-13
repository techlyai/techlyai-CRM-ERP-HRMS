import { notFound } from "next/navigation";
import { z } from "zod";
import { context, grants, allowed, referencesFor } from "@/lib/database";
import { moduleMap, type BusinessRecord, type Profile } from "@/lib/modules";
import { RecordDetails, type Question } from "@/components/record-details";
import { type Reference } from "@/components/record-form";
import { type Attachment } from "@/components/attachments";
import { ProjectActivity } from "@/components/project-activity";
export default async function Detail({
  params,
}: {
  params: { module: string; id: string };
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
  const related =
    params.module === "projects"
      ? await db.select<BusinessRecord>(
          "records",
          "select=*&module=in.(tasks,eod,expenses)&status=neq.Archived&data->>project_id=eq." +
            r.id +
            "&order=updated_at.desc&limit=500",
        )
      : [];
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
      />
      {params.module === "projects" && (
        <ProjectActivity
          records={related}
          budget={Number(r.data.budget || 0)}
        />
      )}
    </>
  );
}
