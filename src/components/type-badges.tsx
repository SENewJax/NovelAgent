import { CategoryDetection } from "@/scoring/types";

/**
 * 分类判定徽章组：男频/女频 + 一级分类 + 二级分类
 * 用于分析、续写、重写等页面头部统一展示
 */
export function TypeBadges({
  detection,
  className = "",
}: {
  detection?: CategoryDetection | null;
  className?: string;
}) {
  if (!detection) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span
        className={`text-xs px-2 py-0.5 rounded font-medium ${
          detection.gender === "male"
            ? "bg-blue-100 text-blue-700"
            : "bg-pink-100 text-pink-700"
        }`}
      >
        {detection.gender === "male" ? "男频" : "女频"}
      </span>
      {detection.primaryLabel && (
        <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">
          {detection.primaryLabel}
        </span>
      )}
      {detection.secondaryCategory && (
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
          {detection.secondaryCategory}
        </span>
      )}
    </div>
  );
}
