interface ScoreBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export function ScoreBadge({ score, size = "md" }: ScoreBadgeProps) {
  const level =
    score >= 9
      ? "excellent"
      : score >= 7
      ? "good"
      : score >= 5
      ? "average"
      : score >= 3
      ? "weak"
      : "poor";

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1",
    lg: "text-lg px-3 py-1.5",
  };

  const colorClasses = {
    excellent: "bg-emerald-100 text-emerald-700",
    good: "bg-blue-100 text-blue-700",
    average: "bg-yellow-100 text-yellow-700",
    weak: "bg-orange-100 text-orange-700",
    poor: "bg-red-100 text-red-700",
  };

  return (
    <span
      className={`inline-block rounded-full font-bold ${sizeClasses[size]} ${colorClasses[level]}`}
    >
      {score.toFixed(1)}
    </span>
  );
}
