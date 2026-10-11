export function recentCorrectionJobs(ledger, query = '', days = 7, now = Date.now()) {
  const term = query.trim().toLowerCase().replace(/^#/, ''),
    cutoff = now - days * 86400000;
  const score = (job) => {
    const id = job.id.toLowerCase(),
      description = job.description.toLowerCase(),
      service = job.service.toLowerCase();
    return !term
      ? 0
      : id === term || id.slice(0, 8) === term
        ? 0
        : id.startsWith(term)
          ? 1
          : id.includes(term)
            ? 2
            : description.includes(term)
              ? 3
              : service.includes(term)
                ? 4
                : 5;
  };
  return ledger.jobs
    .filter((job) => Date.parse(job.createdAt) >= cutoff && score(job) < 5)
    .sort(
      (a, b) =>
        score(a) - score(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id),
    );
}
export function jobChoiceLabel(job) {
  return `${job.id.slice(0, 8).toUpperCase()} · ${job.description} · ${job.service}`;
}
