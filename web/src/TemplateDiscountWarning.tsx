import { templateDiscountImpact } from './pricing-templates.mjs';
import { currency } from './receipts.mjs';
export default function TemplateDiscountWarning({ jobs, allowed }: { jobs: any[]; allowed: boolean }) {
  if (!allowed) return null;
  const warnings = jobs.map(templateDiscountImpact).filter((w): w is NonNullable<typeof w> => w !== null);
  return (
    <>
      {warnings.map((w, i) => (
        <p className="notice notice-warning" role="status" key={i}>
          <strong>{w.name}: item discount limit exceeded.</strong> Estimated expenses {currency(w.cost)} ·
          Discounted price {currency(w.amount)} · {w.profit < 0 ? 'Loss' : 'Remaining profit'}{' '}
          {currency(Math.abs(w.profit))}.{w.profit < 0 ? ' This price is below estimated expenses.' : ''} You
          may proceed within your own discount allowance.
        </p>
      ))}
    </>
  );
}
