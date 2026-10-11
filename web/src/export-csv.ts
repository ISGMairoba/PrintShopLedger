import { sectionsToCsv } from './reports.mjs';
// widths and numeric are PDF layout hints (relative column widths, right-aligned columns); CSV ignores them.
export type ReportSection = {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  widths?: number[];
  numeric?: number[];
};

// The byte-order mark makes Excel read the file as UTF-8 (₦, accented names).
export function downloadCsv(fileName: string, titleLines: string[], sections: ReportSection[]) {
  const blob = new Blob(['\ufeff' + sectionsToCsv(titleLines, sections)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.csv') ? fileName : fileName + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
