import { SortHeader } from './TableSort';

type Sort = { key: string; direction: 'asc' | 'desc'; toggle: (key: string) => void };
type Audited = {
  createdByLabel?: string | null;
  createdAt?: string | null;
  modifiedByLabel?: string | null;
  modifiedAt?: string | null;
};

// Audit view: who created and who last changed a record, each with its time, in two columns.
// These return plain fragments (not components) so ResponsiveTable sees each cell on phones.
export function auditHeaders(sort: Sort) {
  return (
    <>
      <SortHeader label="Created" column="createdAt" sort={sort} className="audit-heading" />
      <SortHeader label="Modified" column="modifiedAt" sort={sort} className="audit-heading" />
    </>
  );
}
export function auditCells(record: Audited, format: (value: string) => string) {
  const at = (value?: string | null) => (value ? format(value) : '');
  return (
    <>
      <td className="audit-cell">
        <span>{record.createdByLabel || '—'}</span>
        <small>{at(record.createdAt)}</small>
      </td>
      <td className="audit-cell">
        <span>{record.modifiedByLabel || '—'}</span>
        <small>{at(record.modifiedAt)}</small>
      </td>
    </>
  );
}
