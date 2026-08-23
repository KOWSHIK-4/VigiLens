import { describe, it, expect } from "vitest";
import { buildPdfDocument } from "../src/utils/pdf";
import { toCsv, csvCell } from "../src/utils/csv";
import { sanitizeReportFilename } from "../src/services/report.service";

describe("buildPdfDocument", () => {
  it("emits a structurally valid single-page PDF", () => {
    const pdf = buildPdfDocument("Daily Report", ["Period: 2026-08-01 to 2026-08-22", "person: 3"]).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/Type /Catalog");
    expect(pdf).toContain("/Type /Pages /Count 1");
    expect(pdf).toContain("/BaseFont /Helvetica");
    const xrefOffset = Number(
      pdf.slice(pdf.lastIndexOf("startxref") + 10).split("\n")[0].trim(),
    );
    const xref = pdf.slice(xrefOffset, xrefOffset + 4);
    expect(xref).toBe("xref");
  });

  it("escapes parentheses and backslashes inside strings", () => {
    const pdf = buildPdfDocument("t", ["label (with) parens \\ slash"]).toString("latin1");
    expect(pdf).toContain("(label \\(with\\) parens \\\\ slash)");
  });

  it("replaces non-ASCII characters instead of emitting invalid bytes", () => {
    const pdf = buildPdfDocument("t\u00e9", ["caf\u00e9 \u2013 dash"]).toString("latin1");
    expect(pdf).not.toContain("\u2013");
    expect(Buffer.from(pdf, "latin1").length).toBeGreaterThan(0);
  });

  it("paginates beyond the per-page line limit with a correct page tree", () => {
    const lines = Array.from({ length: 120 }, (_, i) => `row ${i}`);
    const pdf = buildPdfDocument("Big", lines).toString("latin1");
    expect(pdf).toContain("/Count 3");
    expect((pdf.match(/\/Type \/Page[^s]/g) || []).length).toBe(3);
  });
});

describe("report CSV output", () => {
  it("quotes cells containing separators, quotes and newlines", () => {
    expect(csvCell('has "quote"')).toBe('"has ""quote"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("renders whole rows safely", () => {
    const csv = toCsv(["ID", "Label"], [["d1", 'person, "tall"']]);
    expect(csv).toBe('ID,Label\n"d1","person, ""tall"""');
  });

  it("neutralizes spreadsheet formula prefixes", () => {
    expect(csvCell("=cmd|'/c calc'")).toBe('"\'=cmd|\'/c calc\'"');
    expect(csvCell("@SUM(1)")).toBe('"\'@SUM(1)"');
    expect(csvCell("-2+3+cmd")).toBe('"\'-2+3+cmd"');
  });
});

describe("sanitizeReportFilename", () => {
  it("keeps word characters and collapses whitespace to underscores", () => {
    expect(sanitizeReportFilename("Weekly Site Report 42")).toBe("weekly_site_report_42");
  });

  it("strips path separators, control characters and CR/LF header smuggling", () => {
    expect(sanitizeReportFilename("../../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeReportFilename('evil"\r\nX-Injected: yes.pdf')).toBe("evilx-injected_yespdf");
  });

  it("falls back when nothing survives", () => {
    expect(sanitizeReportFilename("***")).toBe("report");
    expect(sanitizeReportFilename("   ")).toBe("report");
  });

  it("bounds the length", () => {
    expect(sanitizeReportFilename("x".repeat(500)).length).toBeLessThanOrEqual(80);
  });
});
