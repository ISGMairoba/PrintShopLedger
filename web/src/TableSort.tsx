import { useState } from 'react';
import { sortRows } from './table-sort.mjs';
type Value = string | number | boolean | null | undefined;
type SortState = { key: string; direction: 'asc' | 'desc'; toggle: (key: string) => void };
export function useTableSort<T>(initialKey: string, initialDirection: 'asc' | 'desc' = 'asc') {
  const [key,setKey]=useState(initialKey);
  const [direction,setDirection]=useState<'asc' | 'desc'>(initialDirection);
  function toggle(next: string) { setKey(next); setDirection(next===key && direction==='asc' ? 'desc' : 'asc'); }
  return { key,direction,toggle, sortRows: (rows: T[], selectors: Record<string,(row:T)=>Value>): T[] =>
    selectors[key] ? sortRows(rows,selectors[key],direction) : [...rows] };
}
export function SortHeader({ column, label, sort }: { column: string; label: string; sort: SortState }) {
  const active=sort.key===column;
  return <th scope="col" aria-sort={active ? sort.direction==='asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" className="sort-button" onClick={()=>sort.toggle(column)} title={`Sort by ${label}`}>
      {label}<span aria-hidden="true">{active ? sort.direction==='asc' ? ' ↑' : ' ↓' : ' ↕'}</span>
    </button>
  </th>;
}
