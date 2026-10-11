import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PieSectorDataItem } from 'recharts';

export type ChartRow = { id: string; name: string; value: number };
export const chartColor = (index: number) =>
  index === 0
    ? 'var(--brand-primary)'
    : index === 1
      ? 'var(--brand-accent)'
      : `hsl(${Math.round(index * 137.5) % 360} 65% 42%)`;
type Format = (value: number) => string;
const compact = (value: number) =>
  new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
function Toggle({
  name,
  visible,
  color,
  onClick,
}: {
  name: string;
  visible: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="chart-toggle"
      aria-label={`${visible ? 'Hide' : 'Show'} ${name}`}
      aria-pressed={visible}
      onClick={onClick}
    >
      <i style={{ background: color }} aria-hidden="true" />
      {name}
      <small>{visible ? 'Shown' : 'Hidden'}</small>
    </button>
  );
}
export function InteractivePie({
  rows,
  title,
  formatValue,
}: {
  rows: ChartRow[];
  title: string;
  formatValue: Format;
}) {
  const [hidden, setHidden] = useState<string[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [hovered, setHovered] = useState<string | null>(null);
  const positive = rows.filter((row) => row.value > 0),
    shown = positive.filter((row) => !hidden.includes(row.id)),
    total = shown.reduce((sum, row) => sum + row.value, 0);
  const active = shown.find((row) => row.id === (hovered ?? selected));
  const toggle = (id: string) => {
    setHidden((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
    setSelected(null);
    setHovered(null);
  };
  const shape = (props: PieSectorDataItem) => {
    const row = props.payload as ChartRow;
    const highlighted = row.id === (hovered ?? selected);
    return (
      <g
        role="button"
        tabIndex={0}
        data-center-x={props.cx}
        data-center-y={props.cy}
        data-mid-angle={props.midAngle}
        data-hit-radius={((props.innerRadius ?? 0) + (props.outerRadius ?? 0)) / 2}
        onClick={() => setSelected((previous) => (previous === row.id ? null : row.id))}
        onMouseEnter={() => setHovered(row.id)}
        onMouseLeave={() => setHovered(null)}
        aria-label={`Select ${row.name}: ${formatValue(row.value)}`}
        onFocus={() => setHovered(row.id)}
        onBlur={() => setHovered(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelected((previous) => (previous === row.id ? null : row.id));
          }
        }}
      >
        <Sector {...props} outerRadius={(props.outerRadius ?? 0) + (highlighted ? 6 : 0)} />
        {highlighted && (
          <Sector
            {...props}
            innerRadius={(props.outerRadius ?? 0) + 10}
            outerRadius={(props.outerRadius ?? 0) + 13}
          />
        )}
      </g>
    );
  };
  return (
    <div className="interactive-chart">
      <small>Hover or tap a slice for details. Use the category buttons to show or hide slices.</small>
      <div className="dashboard-pie" aria-label={title}>
        {total > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart accessibilityLayer>
              <Pie
                data={shown}
                dataKey="value"
                nameKey="name"
                innerRadius="52%"
                outerRadius="75%"
                shape={shape}
                isAnimationActive={false}
              >
                {shown.map((row) => (
                  <Cell
                    key={row.id}
                    fill={chartColor(positive.findIndex((item) => item.id === row.id))}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatValue(Number(value))}
                contentStyle={{
                  background: 'var(--surface)',
                  borderColor: 'var(--line)',
                  color: 'var(--ink)',
                  borderRadius: 8,
                }}
                itemStyle={{ color: 'var(--ink)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p>
            {positive.length
              ? 'All categories are hidden. Show a category below.'
              : 'No positive values to chart in this period.'}
          </p>
        )}
      </div>
      <div className="chart-selection" role="status">
        {active ? (
          <>
            <strong>{active.name}</strong>
            <span>
              {formatValue(active.value)} · {((active.value / total) * 100).toFixed(1)}% of shown categories
            </span>
          </>
        ) : (
          <>
            <strong>{formatValue(total)}</strong>
            <span>Total of shown categories</span>
          </>
        )}
      </div>
      {rows.map((row) => {
        const index = positive.findIndex((item) => item.id === row.id),
          visible = !hidden.includes(row.id);
        return (
          <div className="dashboard-row" key={row.id}>
            <span className="dashboard-slice-name">
              {row.value > 0 ? (
                <Toggle
                  name={row.name}
                  visible={visible}
                  color={chartColor(index)}
                  onClick={() => toggle(row.id)}
                />
              ) : (
                <>{row.name}</>
              )}
            </span>
            <span className="dashboard-slice-value">
              <strong>{formatValue(row.value)}</strong>
              <small>
                {row.value > 0
                  ? visible
                    ? `${((row.value / total) * 100).toFixed(1)}%`
                    : 'Hidden from chart'
                  : row.value < 0
                    ? 'Outside pie: negative balance'
                    : '0%'}
              </small>
            </span>
          </div>
        );
      })}
      {hidden.some((id) => positive.some((row) => row.id === id)) && (
        <small>Shares use only shown categories. Record totals have not changed.</small>
      )}
      {rows.some((row) => row.value < 0) && (
        <p className="dashboard-chart-note">
          Refunds exceed collections for some methods. Negative values appear in the list and are excluded
          from the pie; shares use positive balances only.
        </p>
      )}
    </div>
  );
}
export function InteractiveRanking({
  rows,
  title,
  formatValue,
  currency = false,
}: {
  rows: ChartRow[];
  title: string;
  formatValue: Format;
  currency?: boolean;
}) {
  const [hidden, setHidden] = useState<string[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const shown = rows.filter((row) => !hidden.includes(row.id)),
    active = shown.find((row) => row.id === selected);
  return (
    <div className="interactive-chart">
      <small>Hover or tap a bar for details. Use the category buttons to show or hide bars.</small>
      <div className="dashboard-chart" aria-label={title}>
        {shown.length ? (
          <ResponsiveContainer width="100%" height={Math.max(200, shown.length * 48 + 35)}>
            <BarChart
              data={shown}
              layout="vertical"
              margin={{ top: 10, right: 16, bottom: 5, left: 0 }}
              accessibilityLayer
            >
              <CartesianGrid stroke="var(--line)" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(value) =>
                  currency ? `₦${compact(Number(value) / 100)}` : compact(Number(value))
                }
                tick={{ fill: 'var(--subtle)', fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={95}
                tick={{ fill: 'var(--ink)', fontSize: 11 }}
                tickFormatter={(name) =>
                  String(name).length > 15 ? String(name).slice(0, 14) + '…' : String(name)
                }
                interval={0}
              />
              <Tooltip
                formatter={(value) => formatValue(Number(value))}
                cursor={{ fill: 'var(--line)', opacity: 0.35 }}
                contentStyle={{
                  background: 'var(--surface)',
                  borderColor: 'var(--line)',
                  color: 'var(--ink)',
                  borderRadius: 8,
                }}
                itemStyle={{ color: 'var(--ink)' }}
              />
              <Bar
                dataKey="value"
                name="Value"
                isAnimationActive={false}
                radius={[0, 5, 5, 0]}
                onClick={(_data, index) => setSelected(shown[index]?.id ?? null)}
              >
                {shown.map((row) => (
                  <Cell key={row.id} fill={chartColor(rows.findIndex((item) => item.id === row.id))} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p>
            {rows.length
              ? 'All categories are hidden. Show a category below.'
              : 'No recorded values for this metric in the selected period.'}
          </p>
        )}
      </div>
      <div className="chart-selection" role="status">
        {active ? (
          <>
            <strong>{active.name}</strong>
            <span>{formatValue(active.value)}</span>
          </>
        ) : (
          <span>Tap a bar to keep its value visible here.</span>
        )}
      </div>
      {rows.map((row) => (
        <div className="dashboard-row" key={row.id}>
          <Toggle
            name={row.name}
            visible={!hidden.includes(row.id)}
            color={chartColor(rows.findIndex((item) => item.id === row.id))}
            onClick={() => {
              setHidden((previous) =>
                previous.includes(row.id) ? previous.filter((id) => id !== row.id) : [...previous, row.id],
              );
              setSelected(null);
            }}
          />
          <strong>{formatValue(row.value)}</strong>
        </div>
      ))}
    </div>
  );
}
export function InteractiveTrend({
  rows,
  sales,
  payments,
  formatValue,
}: {
  rows: { date: string; sales: number; collected: number }[];
  sales: boolean;
  payments: boolean;
  formatValue: Format;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const series = [
    ...(sales ? [{ key: 'sales', name: 'Sales value', color: chartColor(0) }] : []),
    ...(payments ? [{ key: 'collected', name: 'Net collected', color: chartColor(1) }] : []),
  ];
  const shown = series.filter((item) => !hidden.includes(item.key));
  return (
    <>
      <small>
        Hover or tap a date to see amounts. Use the buttons to show or hide a series. Arrow keys also move
        between dates.
      </small>
      <div className="dashboard-legend">
        {series.map((item) => (
          <Toggle
            key={item.key}
            name={item.name}
            visible={!hidden.includes(item.key)}
            color={item.color}
            onClick={() =>
              setHidden((previous) =>
                previous.includes(item.key)
                  ? previous.filter((key) => key !== item.key)
                  : [...previous, item.key],
              )
            }
          />
        ))}
      </div>
      <div className="dashboard-chart" aria-label="Sales value and net money collected by date">
        {shown.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows} accessibilityLayer margin={{ top: 10, right: 10, bottom: 10, left: 5 }}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(date) => String(date).slice(5)}
                minTickGap={25}
                tick={{ fill: 'var(--subtle)', fontSize: 11 }}
              />
              <YAxis
                width={62}
                tickFormatter={(value) => `₦${compact(Number(value) / 100)}`}
                tick={{ fill: 'var(--subtle)', fontSize: 11 }}
              />
              <ReferenceLine y={0} stroke="var(--subtle)" />
              <Tooltip
                trigger="hover"
                formatter={(value) => formatValue(Number(value))}
                contentStyle={{
                  background: 'var(--surface)',
                  borderColor: 'var(--line)',
                  color: 'var(--ink)',
                  borderRadius: 8,
                }}
                itemStyle={{ color: 'var(--ink)' }}
              />
              {shown.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.name}
                  fill={item.color}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p>All series are hidden. Show a series above.</p>
        )}
      </div>
      <details>
        <summary>View exact trend amounts</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                {sales && <th>Sales value</th>}
                {payments && <th>Net collected</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  {sales && <td>{formatValue(row.sales)}</td>}
                  {payments && <td>{formatValue(row.collected)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
