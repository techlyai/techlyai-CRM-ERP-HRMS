import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  joiningDocuments,
  normalizeJoiningDocuments,
  formatBytes,
} from "../src/lib/joining";
import { validateFile, joiningLimitBytes, pdfHasEnd } from "../src/lib/files";
import { validateRecord } from "../src/lib/modules";
import { fileResponse } from "../src/lib/file-response";

test("joining checklist keeps known documents in canonical order", () => {
  assert.equal(joiningDocuments.length, 10);
  assert.deepEqual(
    normalizeJoiningDocuments(["Resume", "PAN card", "Resume", "Unknown"]),
    ["PAN card", "Resume"],
  );
  assert.deepEqual(normalizeJoiningDocuments("nope"), []);
});

test("employee records accept the joining checklist and reject unknown documents", () => {
  const base = { phone: "+919876543210", department: "Sales", joining_date: "2026-10-01" };
  const ok = validateRecord("employees", {
    ...base,
    joining_documents: ["Resume", "Aadhaar card"],
  });
  assert.deepEqual(ok.joining_documents, ["Aadhaar card", "Resume"]);
  assert.throws(
    () => validateRecord("employees", { ...base, joining_documents: ["Driving licence"] }),
    /joining checklist/,
  );
});

test("joining documents must be a PDF and have no default size cap", () => {
  const huge = 5 * 1024 * 1024 * 1024; // 5 GB
  const saved = process.env.MAX_JOINING_DOCUMENT_MB;
  delete process.env.MAX_JOINING_DOCUMENT_MB;
  try {
    assert.doesNotThrow(() => validateFile("joining.pdf", "application/pdf", huge, false, "joining"));
    assert.throws(() => validateFile("joining.docx", "application/pdf", 10, false, "joining"), /single PDF/);
    assert.throws(() => validateFile("joining.pdf", "image/png", 10, false, "joining"), /single PDF/);
    // Ordinary attachments keep their 20 MB limit.
    assert.throws(() => validateFile("big.pdf", "application/pdf", 21 * 1024 * 1024), /20 MB/);
    // An administrator can set a ceiling.
    process.env.MAX_JOINING_DOCUMENT_MB = "100";
    assert.equal(joiningLimitBytes(), 100 * 1024 * 1024);
    assert.throws(() => validateFile("joining.pdf", "application/pdf", 101 * 1024 * 1024, false, "joining"), /100 MB limit/);
  } finally {
    if (saved === undefined) delete process.env.MAX_JOINING_DOCUMENT_MB;
    else process.env.MAX_JOINING_DOCUMENT_MB = saved;
  }
});

test("PDF end marker detects truncated files", () => {
  assert.equal(pdfHasEnd(Buffer.from("...trailer\n%%EOF\n")), true);
  assert.equal(pdfHasEnd(Buffer.from("...stream data cut off")), false);
});

test("human-readable sizes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(48 * 1024 * 1024), "48 MB");
  assert.equal(formatBytes(3.2 * 1024 * 1024 * 1024), "3.2 GB");
});

async function body(res: Response) {
  return Buffer.from(await res.arrayBuffer());
}
test("chunked files stream whole and by range across chunk boundaries", async () => {
  const chunkSize = 4;
  const data = Buffer.from("%PDF-0123456789-%%EOF");
  const reads: number[] = [];
  const file = {
    name: "joining.pdf",
    mime: "application/pdf",
    size: data.length,
    chunkSize,
    readChunk: async (part: number) => {
      reads.push(part);
      return data.subarray(part * chunkSize, (part + 1) * chunkSize);
    },
  };
  const full = fileResponse(new NextRequest("https://app.test/api/files/x"), file);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("Content-Length"), String(data.length));
  assert.deepEqual(await body(full), data);

  reads.length = 0;
  const ranged = fileResponse(
    new NextRequest("https://app.test/api/files/x", { headers: { range: "bytes=6-13" } }),
    file,
  );
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("Content-Range"), `bytes 6-13/${data.length}`);
  assert.deepEqual(await body(ranged), data.subarray(6, 14));
  // Only the chunks covering the range are read.
  assert.deepEqual(reads, [1, 2, 3]);
});
