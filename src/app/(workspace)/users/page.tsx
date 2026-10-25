import { context, grants, can } from "@/lib/database";
import { type Profile } from "@/lib/modules";
import { Users } from "@/components/users";
import { LeaveGrant } from "@/components/leave-grant";
export const metadata = { title: "Users & access" };
export default async function UserPage() {
  const { db, profile } = await context();
  const permissions = await grants(db);
  if (!can(profile, permissions, "users", "view"))
    return <p className="error">You do not have permission to view users.</p>;
  // Row level security limits the list to the people this user may see.
  const [people, policies] = await Promise.all([
    db.select<Profile & { email: string | null; employee_id: string | null; phone: string }>(
      "profiles",
      "select=*&order=full_name.asc",
    ),
    db.select<{ type: string }>("leave_policies", "select=type"),
  ]);
  return (
    <>
      <Users
        people={people}
        me={{ id: profile.id, role: profile.role }}
        abilities={{
          create: can(profile, permissions, "users", "create"),
          edit: can(profile, permissions, "users", "edit"),
          permissions: can(profile, permissions, "users", "permissions"),
        }}
      />
      {can(profile, permissions, "leave", "approve") && (
        <LeaveGrant people={people} types={policies.map((p) => p.type)} />
      )}
    </>
  );
}
