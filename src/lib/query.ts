const tables = new Set([
  "profiles",
  "permission_grants",
  "records",
  "record_shares",
  "history",
  "questions",
  "attachments",
  "settings",
  "leave_policies",
  "leave_ledger",
  "stock_movements",
  "payments",
  "notification_preferences",
  "notifications",
  "push_subscriptions",
  "scheduler_runs",
  "client_credentials",
  "credential_audit",
]);
export function identifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw Error("Invalid database identifier");
  return '"' + value + '"';
}
function column(value: string) {
  const [name, key, ...rest] = value.split("->>");
  if (rest.length) throw Error("Invalid field");
  return (
    identifier(name) +
    (key === undefined ? "" : "->>'" + identifier(key).slice(1, -1) + "'")
  );
}
export function selectQuery(table: string, query = "select=*") {
  if (!tables.has(table)) throw Error("Unknown table");
  const params = new URLSearchParams(query);
  const fields = params.get("select") || "*";
  const selected =
    fields === "*" ? "*" : fields.split(",").map(column).join(",");
  const values: unknown[] = [];
  const conditions: string[] = [];
  const operators: Record<string, string> = {
    eq: "=",
    neq: "<>",
    gte: ">=",
    lte: "<=",
    gt: ">",
    lt: "<",
    ilike: "ilike",
  };
  for (const [field, value] of params) {
    if (["select", "order", "limit", "offset"].includes(field)) continue;
    const split = value.indexOf(".");
    const operator = value.slice(0, split);
    const raw = value.slice(split + 1);
    const name = column(field);
    if (operator === "is" && raw === "null") conditions.push(name + " is null");
    else if (operator === "in" && raw.startsWith("(") && raw.endsWith(")")) {
      const entries = raw.slice(1, -1).split(",");
      if (entries.length > 100) throw Error("Too many filter values");
      conditions.push(
        name +
          " in (" +
          entries
            .map((v) => {
              values.push(v);
              return "$" + values.length;
            })
            .join(",") +
          ")",
      );
    } else if (operators[operator]) {
      values.push(operator === "ilike" ? raw.replaceAll("*", "%") : raw);
      conditions.push(`${name} ${operators[operator]} $${values.length}`);
    } else throw Error("Unsupported filter");
  }
  const order = params
    .get("order")
    ?.split(",")
    .map((v) => {
      const [field, direction = "asc", ...extra] = v.split(".");
      if (extra.length || !["asc", "desc"].includes(direction))
        throw Error("Invalid sorting");
      return column(field) + " " + direction;
    })
    .join(",");
  const limit = Number(params.get("limit") || 1000);
  const offset = Number(params.get("offset") || 0);
  if (
    !Number.isInteger(limit) ||
    limit < 0 ||
    limit > 10000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw Error("Invalid pagination");
  values.push(limit, offset);
  return {
    text: `select ${selected} from public.${identifier(table)}${conditions.length ? " where " + conditions.join(" and ") : ""}${order ? " order by " + order : ""} limit $${values.length - 1} offset $${values.length}`,
    values,
  };
}
