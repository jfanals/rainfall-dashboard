import { useMemo, useState } from 'react';
import type { DailyRainfall } from '../types';
import { longDate, shortDate } from '../lib/dates';

const WIDTH = 760;
const HEIGHT = 320;
const PAD = { top: 28, right: 24, bottom: 56, left: 52 };

type RainfallChartProps = {
  data: DailyRainfall[];
};

export function RainfallChart({ data }: RainfallChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const innerWidth = WIDTH - PAD.left - PAD.right;
    const innerHeight = HEIGHT - PAD.top - PAD.bottom;
    const maxRainfall = Math.max(1, ...data.map((day) => day.rainfall));
    const roundedMax = Math.ceil(maxRainfall / 5) * 5 || 5;
    const barGap = data.length > 45 ? 2 : 5;
    const slot = innerWidth / Math.max(data.length, 1);
    const barWidth = Math.max(2, Math.min(28, slot - barGap));

    const bars = data.map((day, index) => {
      const height = (day.rainfall / roundedMax) * innerHeight;
      const x = PAD.left + index * slot + (slot - barWidth) / 2;
      const y = PAD.top + innerHeight - height;
      return { day, index, x, y, width: barWidth, height };
    });

    const ticks = Array.from({ length: 5 }, (_, index) => {
      const value = (roundedMax / 4) * index;
      const y = PAD.top + innerHeight - (value / roundedMax) * innerHeight;
      return { value, y };
    });

    return { bars, ticks, innerHeight, innerWidth, roundedMax };
  }, [data]);

  const hovered = hoveredIndex === null ? data[data.length - 1] : data[hoveredIndex];

  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel__heading panel__heading--compact">
        <div>
          <p className="eyebrow">Daily totals</p>
          <h2 id="chart-title">Rainfall trend</h2>
        </div>
        {hovered ? (
          <div className="chart-readout">
            <strong>{hovered.rainfall.toFixed(2)} mm</strong>
            <span>{longDate(hovered.date)}{hovered.isPartial ? ' · today so far' : ''}</span>
          </div>
        ) : null}
      </div>

      <div className="chart-shell">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Bar chart of daily rainfall totals">
          <defs>
            <linearGradient id="rainBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
          </defs>

          {chart.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={tick.y} y2={tick.y} className="chart-grid" />
              <text x={PAD.left - 10} y={tick.y + 4} textAnchor="end" className="chart-axis">
                {tick.value.toFixed(0)}
              </text>
            </g>
          ))}

          <text x={18} y={PAD.top + chart.innerHeight / 2} transform={`rotate(-90 18 ${PAD.top + chart.innerHeight / 2})`} className="chart-axis chart-axis--label">
            mm rain
          </text>

          {chart.bars.map((bar) => {
            const isHovered = bar.index === hoveredIndex;
            return (
              <g key={bar.day.date} onMouseEnter={() => setHoveredIndex(bar.index)} onMouseLeave={() => setHoveredIndex(null)}>
                <rect
                  x={bar.x}
                  y={PAD.top}
                  width={bar.width}
                  height={chart.innerHeight}
                  fill="transparent"
                />
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={Math.max(bar.height, bar.day.rainfall > 0 ? 2 : 0)}
                  rx="5"
                  className={`chart-bar ${isHovered ? 'chart-bar--hovered' : ''} ${bar.day.readings === 0 ? 'chart-bar--missing' : ''}`}
                >
                  <title>{`${longDate(bar.day.date)}: ${bar.day.rainfall.toFixed(2)} mm`}</title>
                </rect>
              </g>
            );
          })}

          {chart.bars.map((bar, index) => {
            const shouldShow = data.length <= 14 || index % Math.ceil(data.length / 8) === 0 || index === data.length - 1;
            if (!shouldShow) return null;
            return (
              <text key={bar.day.date} x={bar.x + bar.width / 2} y={HEIGHT - 24} textAnchor="middle" className="chart-axis">
                {shortDate(bar.day.date)}
              </text>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
