import { categoryLabel, formatPesos } from "../capture/format";
import type { Report } from "./build";

function shareText(share: number): string {
  return share === 0 ? "<1%" : `${share}%`;
}

/** The report as plain text under a title (design Decision 11). */
export function formatReport(title: string, report: Report): string {
  if (report.empty) return `📊 ${title} · no entries`;
  const noun = report.count === 1 ? "entry" : "entries";
  const out = [`📊 ${title}`, `${formatPesos(report.totalCentavos)} · ${report.count} ${noun}`];
  if (report.lines.length > 0) {
    out.push("");
    for (const line of report.lines) {
      out.push(`${categoryLabel(line.categoryId)} · ${formatPesos(line.totalCentavos)} · ${shareText(line.share)}`);
    }
  }
  if (report.notCounted.length > 0) {
    const parts = report.notCounted.map((row) => `${categoryLabel(row.categoryId)} ${formatPesos(row.totalCentavos)}`);
    out.push("", `Not counted: ${parts.join(", ")}`);
  }
  return out.join("\n");
}
