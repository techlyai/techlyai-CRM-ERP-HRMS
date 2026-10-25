import { z } from "zod";
import { normalizePhone } from "./domain";
import { joiningDocuments, normalizeJoiningDocuments } from "./joining";

export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "datetime"
    | "select"
    | "email"
    | "url"
    | "user"
    | "json";
  required?: boolean;
  options?: string[];
  min?: number;
};
export type Module = {
  key: string;
  title: string;
  singular: string;
  description: string;
  group: string;
  icon: string;
  statuses: string[];
  workflow?: boolean;
  fields: Field[];
};
const text = (key: string, label: string, required = false): Field => ({
  key,
  label,
  required,
});
const date = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "date",
  required,
});
const amount = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "number",
  required,
  min: 0,
});
const notes = (key = "notes", label = "Notes"): Field => ({
  key,
  label,
  type: "textarea",
});
const select = (
  key: string,
  label: string,
  options: string[],
  required = false,
): Field => ({ key, label, type: "select", options, required });
const user = (key: string, label: string): Field => ({
  key,
  label,
  type: "user",
});
const frequencies = ["Monthly", "Quarterly", "Half-Yearly", "Yearly", "Custom"];
const renewalFields: Field[] = [
  text("client", "Client / company", true),
  text("provider", "Service provider"),
  date("purchase_date", "Purchase date"),
  date("start_date", "Start date"),
  date("expiry_date", "Expiration date", true),
  amount("amount", "Renewal amount", true),
  amount("tax_percent", "Tax %"),
  select("frequency", "Billing frequency", frequencies, true),
  amount("custom_days", "Custom cycle days"),
  text("contact", "Contact person"),
  text("phone", "Contact phone"),
  { key: "email", label: "Email", type: "email" },
  notes("contract", "Contract details"),
  notes(),
];
export const modules: Module[] = [
  {
    key: "clients",
    title: "Clients",
    singular: "Client",
    description: "Every relationship, in one place.",
    group: "Business",
    icon: "Building2",
    statuses: ["Active", "On Hold", "Inactive"],
    fields: [
      text("contact", "Contact person", true),
      text("phone", "Phone", true),
      { key: "email", label: "Email", type: "email" },
      text("gst", "GST number"),
      notes("address", "Address"),
      notes(),
    ],
  },
  {
    key: "leads",
    title: "CRM & leads",
    singular: "Lead",
    description: "Turn conversations into lasting partnerships.",
    group: "Business",
    icon: "Target",
    statuses: [
      "New Lead",
      "Contacted",
      "Interested",
      "Meeting Scheduled",
      "Proposal Sent",
      "Negotiation",
      "Won",
      "Lost",
      "Follow-Up Required",
    ],
    fields: [
      text("company", "Company"),
      text("contact", "Contact person", true),
      text("phone", "Phone", true),
      { key: "email", label: "Email", type: "email" },
      text("source", "Lead source"),
      text("interest", "Product / service"),
      notes("requirement", "Business requirement"),
      date("follow_up_date", "Next follow-up"),
      amount("amount", "Expected deal value"),
      notes("address", "Address"),
      notes("next_action", "Next action"),
      notes(),
    ],
  },
  {
    key: "renewals",
    title: "Renewals",
    singular: "Renewal",
    description: "Stay ahead of every subscription and client renewal.",
    group: "Business",
    icon: "RefreshCw",
    statuses: [
      "Active",
      "Upcoming",
      "Renewed",
      "Expired",
      "Cancelled",
      "On Hold",
    ],
    fields: renewalFields,
  },
  {
    key: "projects",
    title: "Projects",
    singular: "Project",
    description: "Keep your people, priorities, and delivery connected.",
    group: "Work",
    icon: "FolderKanban",
    statuses: ["Planning", "Active", "On Hold", "Completed", "Cancelled"],
    fields: [
      text("client", "Client"),
      notes("description", "Description"),
      date("start_date", "Start date"),
      date("due_date", "Target completion", true),
      select("priority", "Priority", ["Low", "Medium", "High", "Urgent"]),
      amount("budget", "Budget"),
      { key: "team", label: "Team member UUIDs (JSON array)", type: "json" },
      notes("deliverables", "Deliverables"),
      notes("milestones", "Milestones"),
      notes("dependencies", "Dependencies"),
      notes("risks", "Risks and blockers"),
      { key: "link", label: "Project link", type: "url" },
    ],
  },
  {
    key: "tasks",
    title: "Tasks",
    singular: "Task",
    description: "A clear next step for everyone.",
    group: "Work",
    icon: "CheckSquare",
    statuses: ["To Do", "In Progress", "Blocked", "In Review", "Completed"],
    fields: [
      text("project_id", "Project UUID"),
      date("due_date", "Deadline", true),
      select("priority", "Priority", ["Low", "Medium", "High", "Urgent"]),
      notes("description", "Description"),
      notes("dependencies", "Dependencies"),
      amount("hours", "Time spent (hours)"),
      notes("blockers", "Blockers"),
    ],
  },
  {
    key: "eod",
    title: "Daily reports",
    singular: "EOD report",
    description: "Make progress visible. Get feedback in context.",
    group: "Work",
    icon: "FileText",
    statuses: [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
    ],
    workflow: true,
    fields: [
      date("report_date", "Report date", true),
      text("department", "Department"),
      text("project_id", "Project UUID"),
      notes("completed", "Tasks completed *"),
      notes("in_progress", "Work in progress"),
      notes("pending", "Pending tasks and reasons"),
      notes("blockers", "Challenges / blockers"),
      notes("next_plan", "Next working day plan"),
      notes("leads", "Leads contacted / acquired"),
      notes("meetings", "Meetings and follow-ups"),
      amount("hours", "Time spent (hours)"),
      {
        key: "sheet_url",
        label: "Google Sheets link (access is not granted by sharing a link)",
        type: "url",
      },
      notes("comments", "Additional comments"),
    ],
  },
  {
    key: "employees",
    title: "People & HRIS",
    singular: "Employee record",
    description: "Support every stage of your people’s journey.",
    group: "People",
    icon: "Users",
    statuses: [
      "Active",
      "Probation",
      "Confirmed",
      "Notice Period",
      "Resigned",
      "Relieved",
      "Inactive",
    ],
    fields: [
      text("employee_id", "Employee ID (generated automatically when blank)"),
      text("phone", "Phone", true),
      { key: "email", label: "Email", type: "email" },
      text("department", "Department", true),
      text("designation", "Designation"),
      user("manager_id", "Reporting manager"),
      date("joining_date", "Joining date", true),
      select("employment_type", "Employment type", [
        "Full Time",
        "Part Time",
        "Contract",
        "Intern",
      ]),
      text("emergency_contact", "Emergency contact"),
      notes("address", "Address"),
      date("probation_end", "Probation end"),
      date("notice_end", "Notice period end"),
      notes("appraisal", "Appraisal / transfer history"),
      {
        key: "joining_documents",
        label: "Documents included in the joining PDF",
        type: "json",
      },
      notes("checklist", "Joining notes"),
      notes(),
    ],
  },
  {
    key: "payroll",
    title: "Salary & payroll",
    singular: "Payroll record",
    description: "Restricted payroll records for authorized people.",
    group: "People",
    icon: "Wallet",
    statuses: [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
      "Paid",
    ],
    workflow: true,
    fields: [
      text("period", "Payroll period", true),
      amount("salary", "Base salary", true),
      amount("allowances", "Allowances"),
      amount("deductions", "Deductions"),
      text("bank_reference", "Bank / payroll reference"),
      notes(),
    ],
  },
  {
    key: "onboarding",
    title: "Onboarding",
    singular: "Candidate",
    description: "From first conversation to first day.",
    group: "People",
    icon: "UserPlus",
    statuses: [
      "Applied",
      "Interview Scheduled",
      "Interview Attended",
      "Selected",
      "Offer Released",
      "Documents Pending",
      "Joined",
      "Rejected",
      "On Hold",
    ],
    fields: [
      text("phone", "Phone", true),
      { key: "email", label: "Email", type: "email" },
      text("department", "Department"),
      text("designation", "Designation"),
      date("interview_date", "Interview date"),
      notes("interview_result", "Interview results"),
      date("joining_date", "Expected joining date"),
      notes("checklist", "Onboarding checklist"),
      notes(),
    ],
  },
  {
    key: "attendance",
    title: "Attendance",
    singular: "Attendance",
    description: "Your working day, accurately recorded.",
    group: "People",
    icon: "Clock3",
    statuses: [
      "Present",
      "Late",
      "Half-Day",
      "Absent",
      "Leave",
      "Holiday",
      "Work From Home",
    ],
    fields: [],
  },
  {
    key: "corrections",
    title: "Attendance corrections",
    singular: "Correction request",
    description: "Resolve missed and incorrect attendance with approval.",
    group: "People",
    icon: "CalendarClock",
    statuses: [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
    ],
    workflow: true,
    fields: [
      text("attendance_id", "Attendance record UUID", true),
      {
        key: "clock_in",
        label: "Corrected clock-in (your device time)",
        type: "datetime",
        required: true,
      },
      {
        key: "clock_out",
        label: "Corrected clock-out (your device time)",
        type: "datetime",
      },
      notes("reason", "Reason *"),
    ],
  },
  {
    key: "leave",
    title: "Leave management",
    singular: "Leave request",
    description: "Plan time away with clarity and balance.",
    group: "People",
    icon: "CalendarDays",
    statuses: [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
      "Cancellation Requested",
      "Cancelled",
    ],
    workflow: true,
    fields: [
      select(
        "leave_type",
        "Leave type",
        [
          "Casual Leave",
          "Sick Leave",
          "Earned Leave",
          "Optional Leave",
          "Unpaid Leave",
          "Compensatory Off",
        ],
        true,
      ),
      date("start_date", "From date", true),
      date("end_date", "To date", true),
      select("duration", "Duration", ["Full Day", "Half Day"], true),
      notes("reason", "Reason *"),
    ],
  },
  {
    key: "software",
    title: "Software & licences",
    singular: "Software licence",
    description: "Know what you own, use, and need to renew.",
    group: "Operations",
    icon: "Laptop",
    statuses: [
      "Active",
      "Upcoming",
      "Renewed",
      "Expired",
      "Cancelled",
      "On Hold",
    ],
    fields: [
      ...renewalFields,
      amount("quantity", "Licence quantity"),
      text(
        "licence_reference",
        "Licence reference (store secrets in a dedicated vault)",
      ),
      text("department", "Assigned department"),
    ],
  },
  {
    key: "inventory",
    title: "Inventory",
    singular: "Stock item",
    description: "Every item accounted for. Every movement recorded.",
    group: "Operations",
    icon: "Package",
    statuses: ["Active", "Discontinued"],
    fields: [
      text("sku", "SKU / asset ID", true),
      select(
        "category",
        "Category",
        [
          "Computers",
          "Accessories",
          "Phones",
          "Furniture",
          "Electrical",
          "T-shirts",
          "Bags",
          "Helmets",
          "Bottles",
          "Stationery",
          "Networking",
          "Other",
        ],
        true,
      ),
      text("size", "Size"),
      text("colour", "Colour"),
      text("model", "Model / variation"),
      text("location", "Storage location"),
      amount("unit_cost", "Unit cost"),
      amount("minimum_stock", "Minimum stock"),
      text("condition", "Condition"),
      date("warranty_end", "Warranty end"),
      notes(),
    ],
  },
  {
    key: "assets",
    title: "Assets & maintenance",
    singular: "Asset",
    description: "Keep your office running at its best.",
    group: "Operations",
    icon: "Wrench",
    statuses: ["Active", "Damaged", "In Repair", "Retired"],
    fields: [
      text("asset_id", "Asset ID", true),
      text("location", "Location"),
      date("purchase_date", "Purchase date"),
      amount("purchase_value", "Purchase value"),
      date("last_service_date", "Last service date"),
      date("next_service_date", "Next service date"),
      date("warranty_end", "Warranty end"),
      notes("warranty", "Warranty details"),
      notes(),
    ],
  },
  {
    key: "maintenance",
    title: "Maintenance history",
    singular: "Service record",
    description: "The complete service history of every asset.",
    group: "Operations",
    icon: "Settings2",
    statuses: [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
    ],
    workflow: true,
    fields: [
      text("asset_id", "Asset record UUID", true),
      date("service_date", "Service date", true),
      text("service_type", "Service type"),
      text("provider", "Service provider", true),
      text("phone", "Provider phone"),
      amount("amount", "Service cost", true),
      date("next_service_date", "Next service date"),
      notes("description", "Service description *"),
      notes(),
    ],
  },
  {
    key: "vendors",
    title: "Vendors",
    singular: "Vendor",
    description: "Trusted partners and purchase relationships.",
    group: "Finance",
    icon: "Truck",
    statuses: ["Active", "Inactive"],
    fields: [
      text("contact", "Contact person"),
      text("phone", "Phone", true),
      { key: "email", label: "Email", type: "email" },
      notes("address", "Address"),
      text("gst", "GST number"),
      notes(),
    ],
  },
  {
    key: "purchases",
    title: "Purchases",
    singular: "Purchase request",
    description: "From approval to delivery, without loose ends.",
    group: "Finance",
    icon: "ShoppingBag",
    statuses: [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
      "Received",
      "Cancelled",
    ],
    workflow: true,
    fields: [
      text("vendor", "Vendor", true),
      text("invoice_number", "Invoice number"),
      date("purchase_date", "Purchase date"),
      date("due_date", "Payment due date"),
      amount("amount", "Total including tax", true),
      amount("gst", "GST amount"),
      {
        key: "lines",
        label: 'Stock lines: [{"item_id":"UUID","quantity":1,"unit_cost":100}]',
        type: "json",
        required: true,
      },
      notes("purpose", "Business purpose *"),
      notes("quotation", "Quotation details"),
      text("project_id", "Project UUID"),
      notes(),
    ],
  },
  {
    key: "expenses",
    title: "Expenses & claims",
    singular: "Expense",
    description: "A clear picture of company spending.",
    group: "Finance",
    icon: "IndianRupee",
    statuses: [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
      "Pending Payment",
      "Paid",
    ],
    workflow: true,
    fields: [
      date("expense_date", "Expense date", true),
      select(
        "category",
        "Category",
        [
          "Rent",
          "Salaries",
          "Internet",
          "Telephone",
          "Electricity",
          "Software",
          "Hardware",
          "Office Supplies",
          "Maintenance",
          "Travel",
          "Marketing",
          "Reimbursement",
          "Miscellaneous",
        ],
        true,
      ),
      amount("amount", "Amount", true),
      text("vendor", "Vendor / recipient"),
      text("project_id", "Project UUID"),
      text("payment_method", "Payment method"),
      select("recurrence", "Expense recurrence", [
        "One-time",
        "Monthly",
        "Quarterly",
        "Half-Yearly",
        "Yearly",
      ]),
      notes("purpose", "Business purpose *"),
      notes("description", "Description"),
    ],
  },
  {
    key: "credit",
    title: "Credit & dues",
    singular: "Credit record",
    description: "Know what’s due and when it needs attention.",
    group: "Finance",
    icon: "CreditCard",
    statuses: ["Open", "Partially Paid", "Paid", "Cancelled"],
    fields: [
      text("vendor", "Vendor / creditor", true),
      amount("amount", "Original amount", true),
      date("credit_date", "Credit date", true),
      date("due_date", "Payment due date", true),
      date("reminder_date", "Next reminder date"),
      text("invoice_number", "Invoice number"),
      text("purchase_id", "Purchase UUID"),
      notes(),
    ],
  },
];
export const moduleMap = Object.fromEntries(
  modules.map((m) => [m.key, m]),
) as Record<string, Module>;
export const moduleKeys = modules.map((m) => m.key);
export const actions = [
  "view",
  "create",
  "edit",
  "upload",
  "approve",
  "export",
  "delete",
] as const;
export type PermissionAction = (typeof actions)[number];
export type Profile = {
  id: string;
  full_name: string;
  phone: string;
  role: "super_admin" | "manager" | "employee";
  department: string | null;
  manager_id: string | null;
  active: boolean;
  must_change_password: boolean;
};
export type BusinessRecord = {
  id: string;
  module: string;
  title: string;
  status: string;
  owner_id: string;
  created_by: string;
  data: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
};
export function validateRecord(module: string, input: unknown) {
  const m = moduleMap[module];
  if (!m || module === "attendance") throw Error("Invalid editable module");
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of m.fields) {
    let schema: z.ZodTypeAny;
    if (f.type === "number")
      schema = z.coerce
        .number()
        .finite()
        .min(f.min ?? 0)
        .max(1e12);
    else if (f.type === "json")
      schema = z.union([z.array(z.unknown()), z.record(z.unknown())]);
    else if (f.type === "select")
      schema = z
        .string()
        .refine((s) => f.options!.includes(s), "Choose a valid option");
    else if (f.type === "date")
      schema = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(
          (s) =>
            !isNaN(Date.parse(s)) &&
            new Date(s).toISOString().slice(0, 10) === s,
          "Invalid date",
        );
    else if (f.type === "datetime")
      schema = z.string().datetime({ offset: true });
    else if (f.type === "user") schema = z.string().uuid();
    else if (f.type === "email") schema = z.string().email().max(254);
    else if (f.type === "url")
      schema = z
        .string()
        .url()
        .max(2048)
        .refine((s) => s.startsWith("https://"), "Use an HTTPS link");
    else
      schema = z
        .string()
        .trim()
        .max(f.type === "textarea" ? 20000 : 1000);
    if (f.required) {
      if (["text", undefined].includes(f.type))
        schema = z.string().trim().min(1).max(1000);
    } else
      schema = z.preprocess(
        (v) => (v === "" || v === null ? undefined : v),
        schema.optional(),
      );
    shape[f.key] = schema;
  }
  const data = z.object(shape).strict().parse(input);
  if (module === "employees") {
    // Blank on create: save_record generates the ID server-side. On edit a
    // blank keeps the current ID (Admins only); a value must be a plain code.
    const employeeId = String(data.employee_id ?? "").trim();
    if (!employeeId) delete data.employee_id;
    else if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,39}$/.test(employeeId))
      throw Error(
        "Employee ID may use letters, numbers, / _ . or - (up to 40 characters)",
      );
    else data.employee_id = employeeId;
    // Only the known joining documents, in canonical order.
    if (data.joining_documents !== undefined) {
      const list = Array.isArray(data.joining_documents)
        ? data.joining_documents.map(String)
        : [];
      if (list.some((d) => !(joiningDocuments as readonly string[]).includes(d)))
        throw Error("Choose documents from the joining checklist");
      data.joining_documents = normalizeJoiningDocuments(list);
    }
  }
  if (module === "eod" && !String(data.completed ?? "").trim())
    throw Error("Tasks completed is required");
  for (const field of ["reason", "purpose"])
    if (
      m.fields.some((f) => f.key === field) &&
      !String(data[field] ?? "").trim()
    )
      throw Error(`${field} is required`);
  if (
    data.start_date &&
    data.end_date &&
    String(data.end_date) < String(data.start_date)
  )
    throw Error("End date must be on or after start date");
  if (
    data.sheet_url &&
    !/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(
      String(data.sheet_url),
    )
  )
    throw Error("Use a Google Sheets document URL");
  if (data.team)
    data.team = z.array(z.string().uuid()).max(100).parse(data.team);
  if (module === "purchases")
    data.lines = z
      .array(
        z
          .object({
            item_id: z.string().uuid(),
            quantity: z.number().int().positive(),
            unit_cost: z.number().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .parse(data.lines);
  if (
    module === "payroll" &&
    Number(data.deductions || 0) >
      Number(data.salary || 0) + Number(data.allowances || 0)
  )
    throw Error("Payroll deductions cannot exceed salary plus allowances");
  if (
    data.frequency === "Custom" &&
    (!Number.isInteger(data.custom_days) ||
      Number(data.custom_days) < 1 ||
      Number(data.custom_days) > 3660)
  )
    throw Error("Enter a custom cycle of 1 to 3660 whole days");
  if (data.minimum_stock !== undefined && !Number.isInteger(data.minimum_stock))
    throw Error("Minimum stock must be a whole number");
  if (
    module === "software" &&
    data.quantity !== undefined &&
    !Number.isInteger(data.quantity)
  )
    throw Error("Licence quantity must be a whole number");
  if (data.tax_percent !== undefined && Number(data.tax_percent) > 100)
    throw Error("Tax percentage cannot exceed 100");
  if (module === "purchases") {
    const lines = data.lines as {
      item_id: string;
      quantity: number;
      unit_cost: number;
    }[];
    if (new Set(lines.map((l) => l.item_id)).size !== lines.length)
      throw Error("Add each stock item once");
    const total =
      Math.round(
        (lines.reduce((n, l) => n + l.quantity * l.unit_cost, 0) +
          Number(data.gst || 0)) *
          100,
      ) / 100;
    if (Math.abs(total - Number(data.amount)) > 0.00001)
      throw Error("Purchase amount must equal item totals plus GST");
  }
  for (const key of [
    "amount",
    "salary",
    "allowances",
    "deductions",
    "unit_cost",
    "gst",
    "budget",
    "purchase_value",
  ]) {
    const v = data[key];
    if (typeof v === "number" && Number(v.toFixed(2)) !== v)
      throw Error(
        `${key.replaceAll("_", " ")} supports at most two decimal places`,
      );
  }
  if (
    module === "purchases" &&
    (data.lines as { unit_cost: number }[]).some(
      (l) => Number(l.unit_cost.toFixed(2)) !== l.unit_cost,
    )
  )
    throw Error("Unit costs support at most two decimal places");
  if (data.phone) data.phone = normalizePhone(String(data.phone));
  return data;
}
