"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface ProjectItem {
  id: string;
  name: string;
  createdAt: string;
  totalScore?: number;
  gender?: "male" | "female";
  novelType?: string;
  track?: string;
  typeDetection?: {
    gender: string;
    type: string;
    typeLabel: string;
    track: string;
    trackLabel: string;
    confidence: number;
  };
}

interface ConfigPackPlatform {
  id: string;
  name: string;
  code: string;
  genders: string[];
}

export default function HomePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [platformId, setPlatformId] = useState<string>("");
  const [platforms, setPlatforms] = useState<ConfigPackPlatform[]>([]);
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch("/api/upload")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
    // 加载激活配置包的平台列表
    fetch("/api/config-packs/active/platforms")
      .then((r) => r.json())
      .then((data) => {
        const list: ConfigPackPlatform[] = data.platforms || [];
        setPlatforms(list);
        if (list.length > 0 && !platformId) {
          setPlatformId(list[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    if (!platformId) {
      alert("请先导入配置包并选择目标平台");
      return;
    }
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("platformId", platformId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.error) {
        alert(data.error);
      } else {
        // 上传成功，跳转到分析
        router.push(`/analysis/${data.id}`);
      }
    } catch (err: any) {
      alert("上传失败: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith(".txt")) {
      setFile(droppedFile);
    }
  };

  return (
    <div className="space-y-8">
      {/* 上传区域 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold mb-6">上传小说</h1>

        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
            dragOver
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("file-input")?.click()}
        >
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-600">
            {file ? (
              <span className="text-blue-600 font-medium">{file.name}</span>
            ) : (
              "拖拽上传 .txt 小说文件，或点击选择"
            )}
          </p>
          <input
            id="file-input"
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        {/* 平台选择 */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            目标平台
          </label>
          {platforms.length === 0 ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              ⚠️ 未检测到配置包平台，请先在设置中导入配置包
            </p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                    platformId === p.id
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:border-blue-300"
                  }`}
                  onClick={() => setPlatformId(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 开始分析按钮 */}
        <button
          className={`mt-6 w-full py-3 rounded-lg text-white font-medium transition-colors ${
            file && platformId && !uploading
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-gray-300 cursor-not-allowed"
          }`}
          disabled={!file || !platformId || uploading}
          onClick={handleUpload}
        >
          {uploading ? "上传中..." : "开始分析"}
        </button>
      </div>

      {/* 历史记录 */}
      {projects.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-lg font-semibold mb-4">历史分析</h2>
          <div className="space-y-3">
            {projects.map((p) => (
              <a
                key={p.id}
                href={`/analysis/${p.id}`}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">📖</span>
                  <div>
                    <div className="font-medium text-gray-900">{p.name}</div>
                    <div className="text-sm text-gray-500 flex items-center gap-2 flex-wrap mt-0.5">
                      <span>{new Date(p.createdAt).toLocaleDateString("zh-CN")}</span>
                      {p.typeDetection && (
                        <>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            p.typeDetection.gender === "male"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-pink-100 text-pink-700"
                          }`}>
                            {p.typeDetection.gender === "male" ? "男频" : "女频"}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            {p.typeDetection.typeLabel}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            {p.typeDetection.trackLabel}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {p.totalScore && (
                  <div className="text-right">
                    <div className="text-lg font-bold text-blue-600">
                      {p.totalScore}
                    </div>
                    <div className="text-xs text-gray-500">总分</div>
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
