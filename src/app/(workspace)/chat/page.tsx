import { ChatWorkspace } from "@/components/chat/workspace";
import {
  canCreateGroups,
  canDirectMessage,
  isUuid,
  type ChatPolicy,
  type DirectoryPerson,
} from "@/components/chat/helpers";
import { context, serviceDB } from "@/lib/database";

export const metadata = { title: "Team chat" };
export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: { c?: string };
}) {
  const { db, profile } = await context();
  const [settings, people, projects] = await Promise.all([
    db.select<{ data: { chat?: Partial<ChatPolicy> } }>(
      "settings",
      "select=data&id=eq.1",
    ),
    // Chat can include colleagues outside the user's record-management scope.
    // Read only directory fields, then apply the same direct-message policy as SQL.
    serviceDB().select<DirectoryPerson & { manager_id: string | null }>(
      "profiles",
      "select=id,full_name,department,role,manager_id&active=eq.true&order=full_name.asc",
    ),
    db.select<{ id: string; title: string }>(
      "records",
      "select=id,title&module=eq.projects&order=title.asc&limit=200",
    ),
  ]);
  const policy: ChatPolicy = {
    group_creation: "managers",
    direct_messages: "everyone",
    edit_minutes: 15,
    admin_review: false,
    ...settings[0]?.data.chat,
  };
  const directory = people.filter((person) => person.id !== profile.id);
  const directDirectory = directory.filter((person) =>
    canDirectMessage(profile, person, policy.direct_messages),
  );
  const publicPerson = ({
    id,
    full_name,
    department,
    role,
  }: DirectoryPerson): DirectoryPerson => ({ id, full_name, department, role });

  return (
    <ChatWorkspace
      me={profile.id}
      meName={profile.full_name}
      isAdmin={profile.role === "super_admin"}
      canCreateGroups={canCreateGroups(profile.role, policy.group_creation)}
      directDirectory={directDirectory.map(publicPerson)}
      directory={directory.map(publicPerson)}
      projects={projects}
      initialConversation={isUuid(searchParams.c) ? searchParams.c : null}
    />
  );
}
