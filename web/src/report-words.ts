import { renameTerms, stageName } from './terms.mjs';
import type { ReportSection } from './export-csv';

/**
 * Report headings, and the cells the app writes (summary items, transaction types, stages), in the
 * business's words. Records people typed stay exactly as saved.
 */
export function nameSections(
  sections: ReportSection[],
  terms: Parameters<typeof renameTerms>[1],
): ReportSection[] {
  const w = (text: string) => renameTerms(text, terms);
  return sections.map((section) => {
    const written = section.columns.flatMap((c, i) =>
      ['Item', 'Figure', 'Notes', 'Type'].includes(c) ? [i] : [],
    );
    const stage = section.columns.indexOf('Stage');
    return {
      ...section,
      title: w(section.title),
      columns: section.columns.map(w),
      rows: section.rows.map((row) =>
        row.map((cell, i) =>
          typeof cell !== 'string'
            ? cell
            : i === stage
              ? stageName(cell, terms)
              : written.includes(i)
                ? w(cell)
                : cell,
        ),
      ),
    };
  });
}
