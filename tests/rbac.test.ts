import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeCovers, roleLabel, type Scope } from "../src/lib/roles";
import { diffPermissions, defaultScope, type PermissionDefinition } from "../src/lib/permissions";
import { allowed, can } from "../src/lib/database";
import type { Profile } from "../src/lib/modules";

test("scope coverage mirrors the database rule", () => {
  const all: Scope[] = ["none", "self", "team", "department", "all"];
  for (const s of all) assert.equal(scopeCovers("all", s), true);
  for (const s of all) assert.equal(scopeCovers(s, "none"), true);
  assert.equal(scopeCovers("team", "self"), true);
  assert.equal(scopeCovers("department", "self"), true);
  assert.equal(scopeCovers("team", "department"), false);
  assert.equal(scopeCovers("department", "team"), false);
  assert.equal(scopeCovers("self", "team"), false);
  assert.equal(scopeCovers("none", "self"), false);
});

test("roles are labelled Super Admin, Admin and Employee", () => {
  assert.equal(roleLabel("super_admin"), "Super Admin");
  assert.equal(roleLabel("manager"), "Admin");
  assert.equal(roleLabel("employee"), "Employee");
});

const def = (module: string, action: string, scoped = true): PermissionDefinition => ({
  module, action, module_label: module, module_group: "G", label: action, description: "", scoped, sensitive: false, sort: 0,
});

test("confirmation summary lists grants, revocations and scope changes", () => {
  const defs = [def("leads", "view"), def("leads", "create"), def("leads", "delete"), def("chat", "view", false)];
  const changes = diffPermissions(
    defs,
    { "leads.view": "self", "leads.delete": "all", "chat.view": "all" },
    { "leads.view": "team", "leads.create": "self", "chat.view": "all" },
  );
  assert.deepEqual(
    changes.map((c) => `${c.def.module}.${c.def.action}:${c.kind}`),
    ["leads.view:changed", "leads.create:granted", "leads.delete:revoked"],
  );
});

test("ticking a box grants the narrowest scope first", () => {
  assert.equal(defaultScope(def("leads", "view"), "all"), "self");
  assert.equal(defaultScope(def("chat", "view", false), undefined), "all");
});

const person = (role: Profile["role"]): Profile => ({
  id: "u1", full_name: "U", phone: "+910000000000", role, department: "Sales", manager_id: null, active: true, must_change_password: false,
});
test("UI hints prefer individual overrides over role defaults", () => {
  const rows = [
    { user_id: null, role: "employee", module: "leads", action: "view", scope: "all" },
    { user_id: "u1", role: null, module: "leads", action: "view", scope: "none" },
    { user_id: "someone-else", role: null, module: "users", action: "view", scope: "all" },
  ];
  assert.equal(allowed(person("employee"), rows, "leads", "view"), false);
  // Another person's override never applies to this user.
  assert.equal(can(person("employee"), rows, "users", "view"), false);
  assert.equal(can(person("super_admin"), [], "settings", "email"), true);
  // Employees never reach other people's private HR records.
  assert.equal(
    allowed(person("employee"), [{ user_id: "u1", role: null, module: "employees", action: "view", scope: "all" }], "employees", "view", "u2"),
    false,
  );
});
