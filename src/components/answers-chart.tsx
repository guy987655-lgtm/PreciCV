"use client";

import { MonthBucket } from "@/lib/answer-stats";

/**
 * Dependency-free SVG bar chart for the My Card page (PRD v2 Topic 10):
 * X = months, Y = cumulative unique questions answered up to that month.
 * Colors ride on currentColor + design tokens so it themes with the app.
 */
export function AnswersChart({ data }: { data: MonthBucket[] }) {
  if (data.length === 0) return null;

  const W = 560;
  const H = 190;
  const PAD = { top: 18, right: 10, bottom: 24, left: 30 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(...data.map((d) => d.cumulative), 1);
  const step = plotW / data.length;
  const barW = Math.min(44, step * 0.6);
  // Thin label density when many months would collide.
  const labelEvery = Math.ceil(data.length / 12);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Unique questions answered per month (cumulative)"
    >
      {/* baseline + top gridline with the max value */}
      <line
        x1={PAD.left}
        y1={PAD.top + plotH}
        x2={W - PAD.right}
        y2={PAD.top + plotH}
        className="stroke-border"
        strokeWidth={1}
      />
      <line
        x1={PAD.left}
        y1={PAD.top}
        x2={W - PAD.right}
        y2={PAD.top}
        className="stroke-border"
        strokeWidth={1}
        strokeDasharray="3 4"
      />
      <text
        x={PAD.left - 6}
        y={PAD.top + 4}
        textAnchor="end"
        className="fill-ink-faint"
        fontSize={10}
      >
        {max}
      </text>
      <text
        x={PAD.left - 6}
        y={PAD.top + plotH + 4}
        textAnchor="end"
        className="fill-ink-faint"
        fontSize={10}
      >
        0
      </text>

      {data.map((d, i) => {
        const h = (d.cumulative / max) * plotH;
        const x = PAD.left + i * step + (step - barW) / 2;
        const y = PAD.top + plotH - h;
        return (
          <g key={d.key}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.cumulative > 0 ? 2 : 0)}
              rx={4}
              className="fill-accent"
            >
              <title>{`${d.label}: ${d.cumulative} unique question${
                d.cumulative === 1 ? "" : "s"
              } answered`}</title>
            </rect>
            {d.cumulative > 0 && (
              <text
                x={x + barW / 2}
                y={y - 5}
                textAnchor="middle"
                className="fill-ink-soft"
                fontSize={10.5}
                fontWeight={700}
              >
                {d.cumulative}
              </text>
            )}
            {i % labelEvery === 0 && (
              <text
                x={PAD.left + i * step + step / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-ink-faint"
                fontSize={10}
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
