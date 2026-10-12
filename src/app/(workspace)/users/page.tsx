import { context } from "@/lib/database";
import { type Profile } from "@/lib/modules";
import { Users } from "@/components/users";
import { LeaveGrant } from "@/components/leave-grant";
export default async function UserPage() {
  const { db, profile } = await context();
  if (profile.role !== "super_admin")
    return <p className="error">This page is restricted to Super Admins.</p>;
  const [people, permissions, policies] = await Promise.all([
    db.select<Profile>("profiles", "select=*&order=full_name.asc"),
    db.select<{
      id: string;
      user_id: string | null;
      role: string | null;
      module: string;
      action: string;
      scope: string;
    }>("permission_grants"),
    db.select<{ type: string }>("leave_policies", "select=type"),
  ]);
  return (
    <>
      <Users people={people} permissions={permissions} />
      <LeaveGrant people={people} types={policies.map((p) => p.type)} />
    </>
  );
}
