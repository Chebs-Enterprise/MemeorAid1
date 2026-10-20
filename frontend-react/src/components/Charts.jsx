/**
 * Lightweight SVG charts for the analytics dashboard.
 *
 * Written by hand rather than pulling in a charting library so the visual
 * language matches the rest of MemorAid and the bundle stays small. Both
 * components render meaningful text alternatives for screen readers.
 */

/** Vertical bar chart — forgetting frequency by memory category. */
export function BarChart({ data, height = 240 }) {
  const rows = (data || []).filter((d) => d.total > 0);
  if (!rows.length) {
    return <p className="chart-empty">No recall attempts recorded yet.</p>;
  }

  const max = Math.max(...rows.map((d) => d.total), 1);
  const barWidth = 100 / rows.length;

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Bar chart of forgetting frequency by category"
      style={{ width: '100%', height }}
    >
      {rows.map((d, i) => {
        const forgottenH = (d.forgotten / max) * (height - 50);
        const passedH = (d.passed / max) * (height - 50);
        const x = i * barWidth + barWidth * 0.18;
        const w = barWidth * 0.64;
        const baseY = height - 26;
        return (
          <g key={d.category}>
            <rect
              x={x}
              y={baseY - passedH}
              width={w}
              height={Math.max(passedH, 0)}
              fill="var(--chart-pass)"
              rx="1"
            />
            <rect
              x={x}
              y={baseY - passedH - forgottenH}
              width={w}
              height={Math.max(forgottenH, 0)}
              fill="var(--chart-forget)"
              rx="1"
              opacity="0.7"
            />
            <text
              x={x + w / 2}
              y={height - 8}
              fontSize="4"
              fill="var(--chart-axis)"
              textAnchor="middle"
            >
              {d.category.length > 10 ? `${d.category.slice(0, 9)}…` : d.category}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Line chart — recall accuracy over the last eight weeks. */
export function LineChart({ data, height = 240 }) {
  const points = (data || []).filter((d) => d.accuracy !== null);
  if (points.length < 2) {
    return (
      <p className="chart-empty">
        Accuracy trends will appear once you have completed a few weekly sessions.
      </p>
    );
  }

  const w = 100;
  const h = height;
  const pad = 14;
  const stepX = (w - pad * 2) / (data.length - 1);

  const coords = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = d.accuracy === null ? null : h - pad - (d.accuracy / 100) * (h - pad * 2);
    return { x, y, d };
  });

  const path = coords
    .filter((c) => c.y !== null)
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Line chart of recall accuracy over the last eight weeks"
      style={{ width: '100%', height }}
    >
      {[0, 50, 100].map((pct) => {
        const y = h - pad - (pct / 100) * (h - pad * 2);
        return (
          <line
            key={pct}
            x1={pad}
            x2={w - pad}
            y1={y}
            y2={y}
            stroke="var(--chart-grid)"
            strokeWidth="0.5"
            strokeDasharray="2 2"
          />
        );
      })}
      <path d={path} fill="none" stroke="var(--chart-pass)" strokeWidth="1.4" strokeLinejoin="round" />
      {coords.map(
        (c, i) =>
          c.y !== null && (
            <circle key={i} cx={c.x} cy={c.y} r="1.8" fill="var(--bg-dark-card)" stroke="var(--chart-pass)" strokeWidth="1" />
          ),
      )}
    </svg>
  );
}

/** Shared legend for the bar chart. */
export function ChartLegend() {
  return (
    <div className="chart-legend">
      <span>
        <span className="swatch" style={{ background: 'var(--chart-pass)' }} />
        Recalled
      </span>
      <span>
        <span className="swatch" style={{ background: 'var(--chart-forget)', opacity: 0.7 }} />
        Forgotten
      </span>
    </div>
  );
}
