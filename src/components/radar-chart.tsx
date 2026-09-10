"use client";

import { DimensionScores, DimensionLabelMap } from "@/scoring/types";

interface RadarChartProps {
  scores: DimensionScores;
  /** 维度显示名表。可配置后不再有全局常量，按 key 查表并回退 key 本身。 */
  labels?: DimensionLabelMap;
  size?: number;
}

export function RadarChart({ scores, labels = {}, size = 280 }: RadarChartProps) {
  const keys = Object.keys(scores) as (keyof DimensionScores)[];
  const center = size / 2;
  const maxRadius = size / 2 - 40;
  const angleStep = (2 * Math.PI) / keys.length;

  // 生成多边形点
  const getPoint = (index: number, value: number) => {
    const angle = angleStep * index - Math.PI / 2;
    const radius = (value / 10) * maxRadius;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  };

  // 数据多边形路径
  const dataPoints = keys.map((key, i) => getPoint(i, scores[key].score));
  const dataPath = dataPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ") + " Z";

  // 网格环（2, 4, 6, 8, 10）
  const gridLevels = [2, 4, 6, 8, 10];

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 网格 */}
        {gridLevels.map((level) => {
          const points = keys
            .map((_, i) => {
              const p = getPoint(i, level);
              return `${p.x},${p.y}`;
            })
            .join(" ");
          return (
            <polygon
              key={level}
              points={points}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="1"
            />
          );
        })}

        {/* 轴线 */}
        {keys.map((_, i) => {
          const endPoint = getPoint(i, 10);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={endPoint.x}
              y2={endPoint.y}
              stroke="#e5e7eb"
              strokeWidth="1"
            />
          );
        })}

        {/* 数据多边形 */}
        <polygon
          points={dataPoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="rgba(59, 130, 246, 0.15)"
          stroke="#3b82f6"
          strokeWidth="2"
        />

        {/* 数据点 */}
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#3b82f6" />
        ))}

        {/* 标签 */}
        {keys.map((key, i) => {
          const angle = angleStep * i - Math.PI / 2;
          const labelRadius = maxRadius + 25;
          const x = center + labelRadius * Math.cos(angle);
          const y = center + labelRadius * Math.sin(angle);
          const score = scores[key].score;

          return (
            <text
              key={key}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-xs fill-gray-600"
            >
              <tspan x={x} dy="-0.5em">{labels[key] || key}</tspan>
              <tspan
                x={x}
                dy="1.2em"
                className={`text-xs font-bold ${
                  score >= 8 ? "fill-blue-600" : score >= 6 ? "fill-yellow-600" : "fill-red-600"
                }`}
              >
                {score}
              </tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}
