# Interactive charts

All existing and future application charts must use interactive Recharts components. Reuse `src/InteractiveCharts.tsx` for pies/donuts, categorical rankings and time trends instead of creating static SVG or CSS charts. Extend this module for new chart types.

- Preserve hover details, mobile tap feedback, keyboard access and category/series visibility buttons. Visibility controls affect charts only, never business totals or saved records.
- Show complete category names and exact formatted values in an accessible list or table alongside the chart. Long axis labels may be shortened, but never lose the full name in details.
- Use brand colors and theme variables, fit mobile containers, keep tooltip content within the viewport and respect reduced-motion preferences. Current charts disable animation.
- Money remains integer kobo; format as NGN at presentation time. Axis abbreviations must use the same unit as tooltips. Counts and quantities are not currency.
- Pie shares use the currently shown positive values only. List negative balances separately; never convert negative numbers to positive slices. Explain when categories are hidden and provide recovery when all are hidden.
- Apply page access before passing data to a chart. Customer rankings require both Jobs and Customers access. A chart must not reveal records through tooltips that its user cannot otherwise see.
- Dashboard modules load separately from checkout/login. Vite PWA precaches the chart bundle for offline use after app installation/update; do not load chart code or fonts from a CDN.

Run `npm test`, `npm run build` and the workflow browser checks. `scripts/check-dashboard.mjs` covers financial totals, ranking switches, slice/bar taps, hover selection, category and series toggles, keyboard tooltips, permissions, offline notices and mobile layout.
