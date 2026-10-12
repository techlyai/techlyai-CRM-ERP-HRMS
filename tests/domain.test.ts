import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone,
  nextRenewal,
  localDate,
  csvCell,
  parseCSV,
} from "../src/lib/domain";
import { validateRecord } from "../src/lib/modules";
import { validMagic, validateFile } from "../src/lib/files";
import { xlsx, parseXlsx, reportFile } from "../src/lib/reports";
test("phone aliases normalize domestic and international formatting consistently", () => {
  assert.equal(normalizePhone("98765 43210", "91"), "+919876543210");
  assert.equal(normalizePhone("+91 (98765) 43210"), "+919876543210");
  assert.throws(() => normalizePhone("9<script>"));
  assert.throws(() => normalizePhone("123"));
});
test("renewal cycles clamp month-end dates and leap years", () => {
  assert.equal(nextRenewal("2026-01-31", "Monthly"), "2026-02-28");
  assert.equal(nextRenewal("2024-02-29", "Yearly"), "2025-02-28");
  assert.equal(nextRenewal("2026-11-30", "Quarterly"), "2027-02-28");
  assert.equal(nextRenewal("2026-10-12", "Custom", 7), "2026-10-19");
  assert.throws(() => nextRenewal("2026-10-12", "Custom"));
});
test("company day is evaluated in India rather than the server timezone", () => {
  assert.equal(
    localDate(new Date("2026-10-11T19:00:00Z"), "Asia/Kolkata"),
    "2026-10-12",
  );
});
test("CSV round-trips multiline quoted contact data and neutralizes spreadsheet formulas", () => {
  const data =
    'title,contact,phone\r\n"Company, Ltd","A ""quoted""\nname",9876543210\r\n';
  const rows = parseCSV(data);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'A "quoted"\nname');
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.throws(() => parseCSV('"unclosed'));
});
test("record validation rejects private computed fields and invalid dates", () => {
  assert.throws(() =>
    validateRecord("credit", {
      vendor: "Test",
      amount: -2,
      credit_date: "2026-10-12",
      due_date: "2026-10-14",
    }),
  );
  assert.throws(() =>
    validateRecord("leads", {
      contact: "A",
      phone: "9999999999",
      paid_amount: 10,
    }),
  );
  assert.throws(() =>
    validateRecord("eod", { report_date: "2026-02-31", completed: "Done" }),
  );
  assert.throws(() =>
    validateRecord("leave", {
      leave_type: "Casual Leave",
      start_date: "2026-10-15",
      end_date: "2026-10-14",
      duration: "Full Day",
      reason: "Personal",
    }),
  );
  assert.throws(() =>
    validateRecord("eod", {
      report_date: "2026-10-12",
      completed: "Done",
      sheet_url: "https://evil.test/",
    }),
  );
  assert.throws(() =>
    validateRecord("inventory", {
      sku: "TS-L",
      category: "T-shirts",
      minimum_stock: 1.5,
    }),
  );
  assert.throws(() =>
    validateRecord("renewals", {
      client: "Techly",
      expiry_date: "2026-11-30",
      amount: 100,
      frequency: "Custom",
    }),
  );
});
test("file extensions and contents must both match the approved formats", () => {
  validateFile("evidence.pdf", "application/pdf", 1000);
  assert.throws(() => validateFile("evidence.html", "application/pdf", 1000));
  assert.throws(() =>
    validateFile("song.mp3", "audio/mpeg", 6 * 1024 * 1024, true),
  );
  assert.equal(validMagic(Buffer.from("%PDF-1.7"), "application/pdf"), true);
  assert.equal(validMagic(Buffer.from("<script>"), "application/pdf"), false);
});
test("Excel exports preserve Unicode, multiline values, and treat formula-like data as text", () => {
  const rows = [
    ["Title", "Notes"],
    ["टेकली", "=SUM(A1:A9)\nline two"],
  ];
  assert.deepEqual(parseXlsx(xlsx(rows)), rows);
});
test("PDF and Word exports are actual portable file formats", async () => {
  const pdf = await reportFile(
    "Test report",
    [
      ["Title", "Status"],
      ["Report 1", "Approved"],
    ],
    "pdf",
  );
  assert.equal(Buffer.from(pdf.bytes).subarray(0, 5).toString(), "%PDF-");
  const word = await reportFile(
    "Test report",
    [
      ["Title", "Status"],
      ["Report 1", "Approved"],
    ],
    "docx",
  );
  assert.equal(Buffer.from(word.bytes).subarray(0, 2).toString(), "PK");
});
