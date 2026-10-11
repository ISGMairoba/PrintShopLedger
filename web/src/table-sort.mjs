export function sortRows(rows, valueFor, direction = 'asc') {
  return rows
    .map((row, index) => ({ row, index, value: valueFor(row) }))
    .sort((a, b) => {
      if (a.value == null && b.value == null) return a.index - b.index;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      let compared;
      if (typeof a.value === 'number' && typeof b.value === 'number') compared = a.value - b.value;
      else if (typeof a.value === 'boolean' && typeof b.value === 'boolean')
        compared = Number(a.value) - Number(b.value);
      else
        compared = String(a.value).localeCompare(String(b.value), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      return (direction === 'desc' ? -compared : compared) || a.index - b.index;
    })
    .map((item) => item.row);
}
