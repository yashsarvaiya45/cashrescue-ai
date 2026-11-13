import { useEffect, useRef } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CalendarDays, ChartNoAxesCombined } from 'lucide-react';
import { formatChartAxis, formatDate, formatPaise } from '../format.js';
import { Badge, Panel, SectionIcon } from './ui.jsx';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { date, baseline, simulation } = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{formatDate(date, true)}</strong>
      <div><span>Baseline</span><b>{formatPaise(baseline)}</b></div>
      {simulation !== undefined && <div><span>With rescue</span><b>{formatPaise(simulation)}</b></div>}
    </div>
  );
}

export default function ForecastChart({ baseline, scenario, active }) {
  const heading = useRef(null);
  useEffect(() => {
    if (active) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);
  const data = baseline.days.map((day, index) => ({
    date: day.date,
    baseline: day.closingBalancePaise,
    simulation: scenario?.forecast.days[index].closingBalancePaise,
  }));
  const low = Math.min(0, baseline.minimumCashBalancePaise, scenario?.forecast.minimumCashBalancePaise ?? 0);
  const high = Math.max(0, ...data.map(({ baseline: close, simulation }) => Math.max(close, simulation ?? close)));
  const ticks = [0, 5, 10, 15, 20, 25, 29].map((index) => data[index].date);
  const date = baseline.firstNegativeBalanceDate;
  return (
    <Panel id="forecast" tabIndex={-1} aria-labelledby="forecast-title" className="forecast-panel">
      <div className="panel-heading flex-wrap">
        <div className="flex min-w-0 items-center gap-3">
          <SectionIcon icon={ChartNoAxesCombined} tone="blue" />
          <div>
            <h2 id="forecast-title" ref={heading} tabIndex={-1}>Cash-flow forecast</h2>
            <p>30 daily closing balances · Deterministic calculation</p>
          </div>
        </div>
        <Badge><CalendarDays size={14} aria-hidden="true" /> {formatDate(baseline.forecastStartDate)} – {formatDate(baseline.forecastEndDate)}</Badge>
      </div>
      <div className="chart-legend" aria-label="Chart legend">
        <span><i className="legend-baseline" />Baseline</span>
        {scenario && <span><i className="legend-rescue" />With rescue</span>}
        <span><i className="legend-threshold" />₹0 threshold</span>
      </div>
      <p className="sr-only">{date ? `Baseline first closes below zero on ${formatDate(date, true)}. ` : 'Baseline stays at or above zero. '}
        {scenario && `The simulated maximum shortfall is ${formatPaise(scenario.forecast.maximumShortfallPaise)}.`}</p>
      <div className="chart-frame">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={data} accessibilityLayer margin={{ top: 12, right: 12, left: 0, bottom: 1 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis dataKey="date" ticks={ticks} interval="preserveStartEnd" minTickGap={16} tickFormatter={formatDate}
              tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={10} />
            <YAxis width={61} domain={[low, high === low ? 100 : high]} tickFormatter={formatChartAxis} axisLine={false}
              tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickMargin={8} />
            <Tooltip content={<ChartTooltip />} isAnimationActive={false} />
            <ReferenceLine y={0} stroke="var(--risk)" strokeDasharray="2 5" strokeWidth={1.5} />
            {date && <ReferenceLine x={date} stroke="var(--risk)" strokeOpacity={0.45} strokeDasharray="4 5" />}
            <Area dataKey="baseline" name="Baseline" type="stepAfter" baseValue={0} stroke="var(--chart-baseline)"
              fill="var(--chart-baseline)" fillOpacity={0.08} strokeWidth={2.5} isAnimationActive={false} />
            {scenario && <Line dataKey="simulation" name="With rescue" type="stepAfter" stroke="var(--chart-rescue)"
              strokeWidth={2.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-data">
        <summary>View daily balances</summary>
        <div className="overflow-x-auto">
          <table>
            <caption className="sr-only">All 30 daily closing balances</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Baseline</th>{scenario && <th scope="col">With rescue</th>}</tr></thead>
            <tbody>{data.map((day) => (
              <tr key={day.date}>
                <th scope="row"><time dateTime={day.date}>{formatDate(day.date, true)}</time></th><td>{formatPaise(day.baseline)}</td>
                {scenario && <td>{formatPaise(day.simulation)}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </Panel>
  );
}
