import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { jsPDF } from "jspdf";
import { csvCell } from "./domain";
const xml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
function column(n: number) {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function xlsx(rows: string[][]) {
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${rows[0]?.length || 1}" width="28" customWidth="1"/></cols><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((v, n) => `<c r="${column(n)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orbit report" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}
export function parseXlsx(bytes: Uint8Array) {
  if (bytes.length > 4 * 1024 * 1024) throw Error("Import limit is 4 MB.");
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (total > 30 * 1024 * 1024)
        throw Error("Expanded workbook is too large");
      return /^xl\/(sharedStrings\.xml|worksheets\/sheet1\.xml)$/.test(
        file.name,
      );
    },
  });
  const decode = (s: string) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  const strings = files["xl/sharedStrings.xml"]
    ? Array.from(
        strFromU8(files["xl/sharedStrings.xml"]).matchAll(
          /<si\b[^>]*>([\s\S]*?)<\/si>/g,
        ),
      ).map((m) =>
        Array.from(m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
          .map((x) => decode(x[1]))
          .join(""),
      )
    : [];
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet)
    throw Error("Use a standard XLSX workbook with a first worksheet");
  const rows: string[][] = [];
  for (const row of strFromU8(sheet).matchAll(
    /<row\b[^>]*>([\s\S]*?)<\/row>/g,
  )) {
    const out: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cell[1].match(/\br="([A-Z]+)\d+"/)?.[1];
      let n = 0;
      if (reference)
        for (const c of reference) n = n * 26 + c.charCodeAt(0) - 64;
      n--;
      if (n < 0 || n > 100) throw Error("Unexpected spreadsheet columns");
      const value =
        cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ||
        Array.from(cell[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
          .map((m) => m[1])
          .join("");
      out[n] = /\bt="s"/.test(cell[1])
        ? strings[Number(value)] || ""
        : decode(value);
    }
    if (out.some(Boolean))
      rows.push(Array.from({ length: out.length }, (_, i) => out[i] || ""));
  }
  return rows;
}
export async function reportFile(
  title: string,
  rows: string[][],
  format: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (format === "csv")
    return {
      bytes: strToU8(
        "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
      ),
      mime: "text/csv; charset=utf-8",
    };
  if (format === "xlsx")
    return {
      bytes: xlsx(rows),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  if (format === "docx") {
    const children = [
      new Paragraph({ text: "Orbit · " + title, heading: HeadingLevel.TITLE }),
      new Paragraph({
        text: "A Techly project · Generated " + new Date().toISOString(),
        spacing: { after: 300 },
      }),
    ];
    for (const row of rows.slice(1)) {
      children.push(
        new Paragraph({ text: row[0], heading: HeadingLevel.HEADING_2 }),
      );
      rows[0].forEach((header, i) => {
        if (row[i])
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: header + ": ", bold: true }),
                new TextRun(row[i]),
              ],
              spacing: { after: 100 },
            }),
          );
      });
    }
    const doc = new Document({ sections: [{ children }] });
    return {
      bytes: new Uint8Array(await Packer.toBuffer(doc)),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  if (format === "pdf") {
    const doc = new jsPDF({ format: "a4", unit: "mm" });
    let y = 20;
    let page = 1;
    const plain = (s: string) =>
      s
        .replaceAll("₹", "INR ")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2013\u2014]/g, "-");
    if (
      rows.some((row) =>
        row.some((cell) =>
          /[^\u0000-\u00ff\u20b9\u2018-\u201d\u2013\u2014]/.test(cell),
        ),
      )
    )
      throw Error(
        "This PDF font cannot represent some characters. Use Print → Save as PDF for full Unicode, or export Word / Excel.",
      );
    function newPage() {
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Orbit · A Techly project · ${page}`, 15, 287);
      doc.addPage();
      page++;
      y = 20;
    }
    doc.setFontSize(20);
    doc.setTextColor(85, 45, 170);
    doc.text(plain(title), 15, y);
    y += 10;
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("Generated " + new Date().toISOString().slice(0, 10), 15, y);
    y += 12;
    for (const row of rows.slice(1)) {
      if (y > 260) newPage();
      doc.setFontSize(12);
      doc.setTextColor(30);
      doc.text(plain(row[0] || "Record"), 15, y);
      y += 8;
      rows[0].forEach((header, i) => {
        if (!row[i]) return;
        doc.setFontSize(9);
        doc.setTextColor(80);
        const lines = doc.splitTextToSize(
          plain(header + ": " + row[i]),
          178,
        ) as string[];
        for (const line of lines) {
          if (y > 275) newPage();
          doc.text(line, 15, y);
          y += 4.5;
        }
        y += 1;
      });
      y += 7;
    }
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Orbit · A Techly project · ${page}`, 15, 287);
    return {
      bytes: new Uint8Array(doc.output("arraybuffer")),
      mime: "application/pdf",
    };
  }
  throw Error("Choose CSV, XLSX, PDF, or DOCX");
}
