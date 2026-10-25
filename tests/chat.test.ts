import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canCreateGroups,
  canDirectMessage,
  type ChatPolicy,
  type DirectoryPerson,
  type ProfileRole,
} from "../src/components/chat/helpers";

type Person = DirectoryPerson & { manager_id: string | null };
const employee = (id: string, overrides: Partial<Person> = {}): Person => ({
  id,
  full_name: id,
  role: "employee",
  department: "Sales",
  manager_id: "sales-manager",
  ...overrides,
});

test("direct-message pickers exclude yourself under every role and policy", () => {
  for (const role of ["employee", "manager", "super_admin"] as const) {
    const me = employee("me", { role });
    for (const policy of ["everyone", "team"] as const)
      assert.equal(
        canDirectMessage(me, me, policy),
        false,
        `${role}: ${policy}`,
      );
  }
});

test("everyone policy allows employees in unrelated departments and management teams", () => {
  const me = employee("me");
  const colleague = employee("colleague", {
    department: "Engineering",
    manager_id: "engineering-manager",
  });
  assert.equal(canDirectMessage(me, colleague, "everyone"), true);
  assert.equal(canDirectMessage(me, colleague, "team"), false);
});

test("team policy accepts either a shared manager or a shared department", () => {
  const me = employee("me");
  assert.equal(
    canDirectMessage(
      me,
      employee("same-manager", { department: "Support" }),
      "team",
    ),
    true,
  );
  assert.equal(
    canDirectMessage(
      me,
      employee("same-department", { manager_id: "another-manager" }),
      "team",
    ),
    true,
  );
  assert.equal(
    canDirectMessage(
      me,
      employee("unrelated", {
        department: "Support",
        manager_id: "another-manager",
      }),
      "team",
    ),
    false,
  );
});

test("team policy matches SQL null handling for managers and departments", () => {
  // SQL uses '=' for manager IDs, but 'is not distinct from' for departments.
  const me = employee("me", { manager_id: null });
  assert.equal(
    canDirectMessage(
      me,
      employee("unassigned-manager", {
        manager_id: null,
        department: "Support",
      }),
      "team",
    ),
    false,
    "two missing manager IDs must not make unrelated employees teammates",
  );
  assert.equal(
    canDirectMessage(
      { ...me, department: null },
      employee("unassigned-department", {
        manager_id: "another-manager",
        department: null,
      }),
      "team",
    ),
    true,
    "two unassigned departments are equivalent under the database policy",
  );
  assert.equal(
    canDirectMessage(
      { ...me, department: null },
      employee("assigned-department", { manager_id: null }),
      "team",
    ),
    false,
  );
});

test("team restrictions still allow employees to reach managers and Super Admins", () => {
  const me = employee("me");
  for (const role of ["manager", "super_admin"] as const) {
    const leader = employee(role, {
      role,
      department: "Operations",
      manager_id: null,
    });
    assert.equal(canDirectMessage(me, leader, "team"), true);
    assert.equal(canDirectMessage(leader, me, "team"), true);
  }
});

test("group creation respects the configured role matrix", () => {
  const roles: ProfileRole[] = ["employee", "manager", "super_admin"];
  const expectations: [ChatPolicy["group_creation"], boolean[]][] = [
    ["admins", [false, false, true]],
    ["managers", [false, true, true]],
    ["everyone", [true, true, true]],
  ];
  for (const [policy, expected] of expectations)
    roles.forEach((role, index) =>
      assert.equal(
        canCreateGroups(role, policy),
        expected[index],
        `${policy}: ${role}`,
      ),
    );
});
