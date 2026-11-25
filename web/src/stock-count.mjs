// Stock counts (Stock → Count; owner, 26 Nov, plans/stock-count-and-stage-ratio.md) and materials
// reserved by jobs that take them in production. The server applies the same rules
// (public.apply_stock_count_event, private.material_reserved); keep them in step.
// * A count is saved as it is typed (count.saved), then an Admin finishes it (count.finished):
//   each counted material is set to what was counted plus what moved since that row was counted,
//   so selling during a count makes no false shortage. Big differences (flagPercent, flagValue)
//   need production.stockCount.approveRank to finish.
// * Shelves: where each material is kept (count.shelf_set), to count shelf by shelf.
import { defaultStockCount } from './production-materials.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;
const NO_SHELF = '';

/** Where a material is kept ('' when not set). */
export const shelfOf = (ledger, materialId) =>
  (ledger.materialShelves ?? []).find((s) => s.id === materialId)?.shelf ?? NO_SHELF;
/** Every shelf in use, A to Z. */
export const shelves = (ledger) =>
  [...new Set((ledger.materialShelves ?? []).map((s) => s.shelf).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

/**
 * The materials a count covers: all active ones, those on chosen shelves (with '' for "No shelf"),
 * or picked ones; in shelf order, then by name.
 * @param {{ kind: 'all' | 'shelf' | 'picked', shelves?: string[], materialIds?: string[] }} scope
 */
export function countMaterials(ledger, scope) {
  const active = ledger.materials.filter((m) => !m.archived);
  const chosen =
    scope.kind === 'shelf'
      ? active.filter((m) => (scope.shelves ?? []).includes(shelfOf(ledger, m.id)))
      : scope.kind === 'picked'
        ? active.filter((m) => (scope.materialIds ?? []).includes(m.id))
        : active;
  return chosen.sort(
    (a, b) =>
      (shelfOf(ledger, a.id) || '￿').localeCompare(shelfOf(ledger, b.id) || '￿') ||
      a.name.localeCompare(b.name),
  );
}

/** Stock of a material at a time: now, less every change recorded after it. */
export function stockAsOf(ledger, materialId, at) {
  const now = ledger.materials.find((m) => m.id === materialId)?.available ?? 0;
  const moved = (ledger.materialHistory ?? [])
    .filter((h) => h.materialId === materialId && Date.parse(h.changedAt) > Date.parse(at))
    .reduce((sum, h) => sum + (h.afterAvailable - (h.beforeAvailable ?? 0)), 0);
  return r3(now - moved);
}

/**
 * What finishing a count would do, line by line: expected (stock when the row was counted), counted,
 * difference, value (at the cost price, when set), the quantity it sets now, and whether it is big.
 */
export function countReview(ledger, count, settings = defaultStockCount()) {
  const lines = count.lines.map((line) => {
    const material = ledger.materials.find((m) => m.id === line.materialId);
    if (line.counted === null || line.counted === undefined || !material)
      return { ...line, material, uncounted: true };
    const expected = stockAsOf(ledger, line.materialId, line.countedAt);
    const now = material.available;
    const difference = r3(line.counted - expected);
    const value = typeof material.costPrice === 'number' ? Math.round(difference * material.costPrice) : null;
    const big =
      difference !== 0 &&
      (expected === 0 ||
        Math.abs(difference) * 100 > Math.abs(expected) * settings.flagPercent ||
        (value !== null && Math.abs(value) > settings.flagValue));
    return { ...line, material, expected, difference, value, setTo: r3(line.counted + (now - expected)), big };
  });
  const counted = lines.filter((l) => !l.uncounted);
  return {
    lines,
    counted: counted.length,
    uncounted: lines.length - counted.length,
    differences: counted.filter((l) => l.difference !== 0).length,
    value: counted.reduce((sum, l) => sum + (l.value ?? 0), 0),
    big: counted.some((l) => l.big),
  };
}

/** Whether this rank may finish a count (with big differences, the setting's rank). */
export const canFinish = (review, level, settings = defaultStockCount()) =>
  level >= 2 && (!review.big || level >= settings.approveRank);

const audit = (event) => {
  const d = event.data;
  if (!event.id || !d?.modifiedBy || !d.modifiedAt || Number.isNaN(Date.parse(d.modifiedAt)))
    throw Error('Count identity and audit information are required.');
  return d;
};
const validName = (name) => {
  const text = String(name ?? '').trim();
  if (!text || text.length > 80 || /[\x00-\x1f\x7f]/.test(text))
    throw Error('Give the count a name up to 80 characters.');
  return text;
};
export function validCountLines(ledger, lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2000)
    throw Error('Choose 1 to 2,000 materials to count.');
  const seen = new Set();
  return lines.map((l) => {
    if (!ledger.materials.some((m) => m.id === l.materialId) || seen.has(l.materialId))
      throw Error('Invalid count line.');
    seen.add(l.materialId);
    const out = { materialId: l.materialId, counted: l.counted ?? null };
    if (out.counted !== null) {
      if (typeof out.counted !== 'number' || !(out.counted >= 0) || out.counted > 1e12 || r3(out.counted) !== out.counted)
        throw Error('Enter each count from 0, with up to three decimal places.');
      if (!l.countedAt || Number.isNaN(Date.parse(l.countedAt))) throw Error('Invalid count time.');
      out.countedAt = l.countedAt;
      if (l.countedBy) Object.assign(out, { countedBy: l.countedBy, countedByLabel: l.countedByLabel ?? '' });
    }
    const note = String(l.note ?? '').trim();
    if (note.length > 200) throw Error('Keep each note to 200 characters.');
    if (note) out.note = note;
    return out;
  });
}

/** Apply a count change to this device's copy (the server decides again when it syncs). */
export function applyStockCountEvent(ledger, event) {
  const d = audit(event);
  const counts = ledger.stockCounts ?? [];
  if (event.kind === 'count.shelf_set') {
    const shelf = String(d.shelf ?? '').trim();
    if (shelf.length > 80 || /[\x00-\x1f\x7f]/.test(shelf)) throw Error('Enter the shelf or area in up to 80 characters.');
    const list = (ledger.materialShelves ?? []).filter((s) => s.id !== d.id);
    return {
      ...ledger,
      materialShelves: [...list, { id: d.id, shelf, modifiedBy: d.modifiedBy, modifiedAt: d.modifiedAt }],
    };
  }
  const existing = counts.find((c) => c.id === d.id);
  if (existing && (d.baseVersion ?? -1) !== existing.version)
    throw Error('This count changed on another device. Reopen it to see the latest.');
  if (existing && existing.status !== 'open') throw Error(`This count is already ${existing.status}.`);
  const who = { modifiedBy: d.modifiedBy, modifiedByLabel: d.modifiedByLabel ?? '', modifiedAt: d.modifiedAt };
  const put = (next) => ({
    ...ledger,
    stockCounts: existing ? counts.map((c) => (c.id === next.id ? next : c)) : [...counts, next],
  });
  if (event.kind === 'count.saved') {
    if (!existing && (d.baseVersion ?? 0) !== 0) throw Error('This count was not found.');
    const base = existing ?? {
      id: d.id,
      status: 'open',
      version: 0,
      createdBy: d.modifiedBy,
      createdByLabel: d.modifiedByLabel ?? '',
      createdAt: d.modifiedAt,
    };
    return put({
      ...base,
      name: validName(d.name),
      scope: d.scope ?? { kind: 'all' },
      lines: validCountLines(ledger, d.lines),
      version: base.version + 1,
      ...who,
    });
  }
  if (!existing) throw Error('This count was not found.');
  if (event.kind === 'count.cancelled')
    return put({
      ...existing,
      status: 'cancelled',
      version: existing.version + 1,
      cancelledBy: d.modifiedBy,
      cancelledByLabel: d.modifiedByLabel ?? '',
      cancelledAt: d.modifiedAt,
    });
  if (event.kind !== 'count.finished') throw Error('Unknown stock count change.');
  const review = countReview(ledger, existing, d.settings ?? defaultStockCount());
  let materials = ledger.materials;
  const history = [...(ledger.materialHistory ?? [])];
  const lines = review.lines.map(({ material, uncounted, big: _b, ...line }) => {
    if (uncounted || !material) return line;
    const stockEventId = d.stockIds?.[material.id];
    if (line.setTo !== material.available) {
      if (!stockEventId) throw Error('Invalid stock change ID.');
      const next = {
        ...material,
        available: line.setTo,
        version: material.version + 1,
        modifiedBy: d.modifiedBy,
        modifiedByLabel: d.modifiedByLabel ?? '',
        modifiedAt: d.modifiedAt,
        lastEventId: stockEventId,
      };
      materials = materials.map((m) => (m.id === material.id ? next : m));
      history.push({
        id: stockEventId,
        materialId: material.id,
        materialName: material.name,
        measurementUnit: material.measurementUnit,
        action: 'material.stock_set',
        beforeAvailable: material.available,
        afterAvailable: line.setTo,
        reason: `Stock count: ${existing.name}`,
        changedBy: d.modifiedBy,
        changedByLabel: d.modifiedByLabel ?? '',
        changedAt: d.modifiedAt,
        detailsComplete: false,
      });
    }
    return {
      ...line,
      ...(line.setTo !== material.available ? { stockEventId } : {}),
      ...(line.value === null ? {} : { unitCost: material.costPrice }),
    };
  });
  return {
    ...put({
      ...existing,
      status: 'finished',
      lines,
      flagged: review.big,
      version: existing.version + 1,
      finishedBy: d.modifiedBy,
      finishedByLabel: d.modifiedByLabel ?? '',
      finishedAt: d.modifiedAt,
    }),
    materials,
    materialHistory: history,
  };
}

/**
 * What open jobs that take their materials in production have reserved of a material: their
 * planned amount until their materials check is confirmed (private.material_reserved).
 */
export function reservedStock(ledger, materialId, exceptJobId = null) {
  let total = 0;
  for (const job of ledger.jobs ?? []) {
    if (job.materialsAt !== 'production' || job.productionStatus === 'Cancelled' || job.id === exceptJobId) continue;
    if (job.materialCheck?.status === 'confirmed') continue;
    if (job.materialId === materialId) total += job.materialNeeded ?? 0;
    for (const s of job.templateSnapshot?.stock ?? []) if (s.materialId === materialId) total += s.quantity;
  }
  return r3(total);
}

/** Every material's reserved amount, in one pass over the jobs: { materialId: amount } (only > 0). */
export function reservedMap(ledger) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const job of ledger.jobs ?? []) {
    if (job.materialsAt !== 'production' || job.productionStatus === 'Cancelled') continue;
    if (job.materialCheck?.status === 'confirmed') continue;
    if (job.materialId && job.materialNeeded) out[job.materialId] = r3((out[job.materialId] ?? 0) + job.materialNeeded);
    for (const s of job.templateSnapshot?.stock ?? []) out[s.materialId] = r3((out[s.materialId] ?? 0) + s.quantity);
  }
  return out;
}

/**
 * Whether the count reminder is due (setting off by default): weekly, from month-end, or every N
 * days since the last finished count (or since the first material, with none).
 */
export function countReminderDue(ledger, settings, now = new Date()) {
  const s = settings ?? defaultStockCount();
  if (s.reminder === 'off') return false;
  const finished = (ledger.stockCounts ?? [])
    .filter((c) => c.status === 'finished' && c.finishedAt)
    .map((c) => Date.parse(c.finishedAt));
  const last = finished.length ? Math.max(...finished) : null;
  if (s.reminder === 'monthEnd') {
    // The latest month-end: today if it is the last day of the month, else the last day of last month.
    // Due from then until a count is finished.
    const y = now.getFullYear();
    const m = now.getMonth();
    const isLast = now.getDate() === new Date(y, m + 1, 0).getDate();
    const monthEnd = isLast ? new Date(y, m, now.getDate()) : new Date(y, m, 0);
    return !last || last < monthEnd.getTime();
  }
  const days = s.reminder === 'weekly' ? 7 : s.reminderDays;
  const since = last ?? Math.min(...(ledger.materials ?? []).map((m) => Date.parse(m.createdAt)).filter(Number.isFinite));
  if (!Number.isFinite(since)) return false;
  return now.getTime() - since >= days * 86400000;
}
