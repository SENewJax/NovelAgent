"use client";

import { useState, useEffect, useCallback } from "react";

// ── 2.0 配置包的类型（与后端 PackContents 对接）──

interface PackManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  formatVersion?: string;
  isDefault?: boolean;
}

interface DimensionSpec {
  key: string;
  label: string;
}

interface PrimaryCategoryNode {
  id: string;
  label: string;
  secondary: string[];
}

interface ChannelPipeline {
  weights: Record<string, number>;
  prompt: string;
}

interface PackPlatform {
  id: string;
  name: string;
  code: string;
  genders: string[];
  promptAppend: string;
  channels: Record<string, Record<string, ChannelPipeline>>;
}

interface PackCategory {
  id: string;
  platformId: string;
  gender: string;
  primaryCategory: string;
  secondaryCategory: string;
  inheritsWeights: boolean;
  params: Record<string, unknown>;
  pipelines: Record<string, ChannelPipeline>;
}

interface PackContents {
  manifest: PackManifest;
  dimensions: Record<string, DimensionSpec[]>;
  taxonomy: Record<string, PrimaryCategoryNode[]>;
  platforms: PackPlatform[];
  categories: PackCategory[];
  defaults: Record<string, Record<string, Record<string, Record<string, number>>>>;
}

const PIPELINES = ["scorer", "analyst", "reviewer", "writer", "type-detector"] as const;
const GENDERS = ["male", "female"] as const;
const GENDER_LABELS: Record<string, string> = { male: "男频", female: "女频" };
const PIPELINE_LABELS: Record<string, string> = {
  scorer: "综合评分",
  analyst: "内容分析",
  reviewer: "结果复核",
  writer: "写作生成",
  "type-detector": "类型识别",
};

const jsonHeaders = { "Content-Type": "application/json" };

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败: ${path}`);
  return data;
}

/** 滑块编辑一块权重，实时把总和拉回 100。 */
function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  if (sum <= 0) return weights;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) out[k] = Math.round((v / sum) * 100);
  // 修正舍入差
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  const diff = 100 - total;
  if (diff !== 0 && Object.keys(out).length > 0) {
    const first = Object.keys(out)[0];
    out[first] = (out[first] || 0) + diff;
  }
  return out;
}

export default function SettingsPage() {
  // ── AI 设置 ──
  const [form, setForm] = useState({ baseUrl: "", model: "", apiKey: "", scoreModel: "" });
  const [lockedKeys, setLockedKeys] = useState<string[]>([]);
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  // ── 配置包管理 ──
  const [packs, setPacks] = useState<PackManifest[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [previousPackId, setPreviousPackId] = useState<string | null>(null);
  const [contents, setContents] = useState<PackContents | null>(null);
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"platforms" | "categories" | "taxonomy">("platforms");
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedGender, setSelectedGender] = useState<string>("male");
  const [selectedPipeline, setSelectedPipeline] = useState<string>("scorer");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const [packMessage, setPackMessage] = useState("");
  const [importingPack, setImportingPack] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [showNewPackForm, setShowNewPackForm] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 加载 AI 配置
  useEffect(() => {
    api("/api/config")
      .then((data) => {
        setForm({
          baseUrl: data.ai?.baseUrl || "",
          model: data.ai?.model || "",
          apiKey: data.ai?.apiKey || "",
          scoreModel: data.ai?.scoreModel || "",
        });
        setLockedKeys(data.lockedKeys || []);
        setConfigured(!!data.configured);
      })
      .catch(() => {});
  }, []);

  // 保存 AI 配置
  const handleSaveAiConfig = async () => {
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      const data = await api("/api/config", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(form),
      });
      setSaveMessage(data.message || "配置已保存");
      setTimeout(() => setSaveMessage(""), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const loadPacks = useCallback(async () => {
    try {
      const [packData, activeData] = await Promise.all([
        api("/api/config-packs"),
        api("/api/config-packs/active"),
      ]);
      setPacks(packData.packs || []);
      setActivePackId(activeData.activePackId || null);
      setPreviousPackId(activeData.previousPackId || null);
    } catch {
      // 配置包系统未初始化
    }
  }, []);

  useEffect(() => { loadPacks(); }, [loadPacks]);

  // 打开包详情
  const openPack = async (packId: string) => {
    setEditingPackId(packId);
    setContents(null);
    setLoadingContents(true);
    setActiveTab("platforms");
    try {
      const data = await api(`/api/config-packs/${packId}`);
      setContents(data.contents || null);
      setSelectedPlatform(data.contents?.platforms?.[0]?.id || null);
      setSelectedCategory(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingContents(false);
    }
  };

  const closeEdit = () => {
    if (dirty && !confirm("有未保存的修改，确定关闭？")) return;
    setEditingPackId(null);
    setContents(null);
    setDirty(false);
  };

  const saveContents = async () => {
    if (!editingPackId || !contents) return;
    setSaving(true);
    setError("");
    try {
      const data = await api(`/api/config-packs/${editingPackId}`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ contents }),
      });
      setContents(data.contents || contents);
      setDirty(false);
      setPackMessage("已保存");
      setTimeout(() => setPackMessage(""), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── 平台编辑辅助 ──
  const touchPlatform = (fn: (p: PackPlatform) => PackPlatform) => {
    if (!contents) return;
    setContents({
      ...contents,
      platforms: contents.platforms.map((p) => (p.id === selectedPlatform ? fn(p) : p)),
    });
    setDirty(true);
  };

  const setChannelUnit = (
    platform: PackPlatform,
    gender: string,
    pipeline: string,
    patch: Partial<ChannelPipeline>,
    weights?: Record<string, number>,
  ) => {
    const channels = { ...platform.channels };
    const genderCh = { ...(channels[gender] || {}) };
    const unit = { ...(genderCh[pipeline] || { weights: {}, prompt: "" }) };
    genderCh[pipeline] = { ...unit, ...patch, ...(weights ? { weights } : {}) };
    channels[gender] = genderCh;
    return { ...platform, channels };
  };

  const editPlatformWeights = (weights: Record<string, number>) => {
    const p = contents?.platforms.find((x) => x.id === selectedPlatform);
    if (!p) return;
    touchPlatform((orig) => setChannelUnit(orig, selectedGender, selectedPipeline, {}, normalizeWeights(weights)));
  };

  const editPlatformPrompt = (prompt: string) => {
    const p = contents?.platforms.find((x) => x.id === selectedPlatform);
    if (!p) return;
    touchPlatform((orig) => setChannelUnit(orig, selectedGender, selectedPipeline, { prompt }));
  };

  // ── 分类编辑辅助 ──
  const touchCategory = (fn: (c: PackCategory) => PackCategory) => {
    if (!contents) return;
    setContents({
      ...contents,
      categories: contents.categories.map((c) => (c.id === selectedCategory ? fn(c) : c)),
    });
    setDirty(true);
  };
  const editCategoryWeights = (weights: Record<string, number>) => {
    if (!contents || !selectedCategory) return;
    touchCategory((c) => ({
      ...c,
      pipelines: {
        ...c.pipelines,
        [selectedPipeline]: {
          weights: normalizeWeights(weights),
          prompt: c.pipelines[selectedPipeline]?.prompt ?? "",
        },
      },
    }));
  };
  const editCategoryPrompt = (prompt: string) => {
    if (!contents || !selectedCategory) return;
    touchCategory((c) => ({
      ...c,
      pipelines: {
        ...c.pipelines,
        [selectedPipeline]: { weights: c.pipelines[selectedPipeline]?.weights ?? {}, prompt },
      },
    }));
  };

  // ── 词表编辑辅助 ──
  const editTaxonomy = (gender: string, nodes: PrimaryCategoryNode[]) => {
    if (!contents) return;
    setContents({ ...contents, taxonomy: { ...contents.taxonomy, [gender]: nodes } });
    setDirty(true);
  };

  // ── 操作 ──
  const handleSwitchPack = async (packId: string) => {
    try {
      await api("/api/config-packs/active", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ packId }),
      });
      setPreviousPackId(activePackId);
      setActivePackId(packId);
      setPackMessage("配置包已激活");
      setTimeout(() => setPackMessage(""), 2000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRollbackPack = async () => {
    try {
      const data = await api("/api/config-packs/active", { method: "POST" });
      setPreviousPackId(activePackId);
      setActivePackId(data.activePackId);
      setPackMessage(`已回退到 ${data.activePackId}`);
      setTimeout(() => setPackMessage(""), 2000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleImportPack = async (file: File) => {
    setImportingPack(true);
    setPackMessage("");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const data = await api("/api/config-packs/import", { method: "POST", body });
      setPackMessage(`已安装 ${data.contents?.manifest?.name || "配置包"}，确认后可手动激活`);
      await loadPacks();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImportingPack(false);
    }
  };

  const handleCreatePack = async () => {
    if (!newPackName.trim()) return;
    const id = newPackName.trim().replace(/\s+/g, "-").toLowerCase() + "-" + Date.now().toString(36);
    try {
      await api("/api/config-packs", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          manifest: { id, name: newPackName.trim(), description: "", version: "1.0.0" },
          copyFrom: activePackId || undefined,
        }),
      });
      setNewPackName("");
      setShowNewPackForm(false);
      await loadPacks();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeletePack = async (packId: string) => {
    if (!confirm(`确认删除配置包 "${packId}"？`)) return;
    try {
      await api(`/api/config-packs/${packId}`, { method: "DELETE" });
      if (editingPackId === packId) setEditingPackId(null);
      await loadPacks();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── 渲染辅助 ──
  const currentPlatform = contents?.platforms.find((p) => p.id === selectedPlatform);
  const currentUnit = currentPlatform?.channels?.[selectedGender]?.[selectedPipeline];
  const currentCategory = contents?.categories.find((c) => c.id === selectedCategory);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* AI 设置 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h1 className="text-xl font-bold mb-1">AI 设置</h1>
        <p className="text-sm text-gray-500 mb-6">配置 AI 服务的连接参数，保存后即可使用分析/改写/续写功能</p>
        <div className={`mb-4 p-3 rounded-lg text-sm ${configured ? "bg-green-50 text-green-700 border border-green-200" : "bg-yellow-50 text-yellow-700 border border-yellow-200"}`}>
          {configured ? "✓ AI 服务已配置，可以正常使用" : "⚠ 未配置 AI 服务"}
        </div>
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          配置保存在仓库根的共享文件 <code className="bg-blue-100 px-1 rounded">novel-studio.env</code> 中，
          novel-analyzer 与 novel-data-studio 两方共用。修改后需<b>重启两个服务</b>才生效。
        </div>
        {/* 提示信息 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}
        {saveMessage && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{saveMessage}</div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API 地址</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              placeholder="https://api.openai.com/v1"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">主模型</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              placeholder="gpt-4o"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              placeholder="sk-..."
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              打分模型 <span className="text-gray-400">（可选，留空则同主模型）</span>
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              placeholder="gpt-4o-mini"
              value={form.scoreModel}
              onChange={(e) => setForm({ ...form, scoreModel: e.target.value })}
            />
          </div>
          <button
            className={`w-full py-2.5 rounded-lg text-white font-medium transition-colors ${saving ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
            disabled={saving}
            onClick={handleSaveAiConfig}
          >
            {saving ? "保存中..." : "💾 保存配置"}
          </button>
        </div>
      </div>

      {/* 配置包管理 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold mb-1">配置包管理</h2>
        <p className="text-sm text-gray-500 mb-4">
          配置包由 novel-data-studio 定义维度、词表与权重，analyzer 只消费。ZIP 包安装后需手动激活。
        </p>

        {/* 激活区 */}
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
          <span className="text-sm text-blue-700 font-medium">当前激活:</span>
          <select className="flex-1 px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" value={activePackId || ""} onChange={(e) => e.target.value && handleSwitchPack(e.target.value)}>
            <option value="">未选择（使用内置默认值）</option>
            {packs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <label className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer ${importingPack ? "bg-gray-200 text-gray-400" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
            {importingPack ? "导入中..." : "导入配置包 ZIP"}
            <input type="file" accept=".zip,application/zip" className="hidden" disabled={importingPack} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportPack(f); e.currentTarget.value = ""; }} />
          </label>
          <button className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200" disabled={!previousPackId} onClick={handleRollbackPack}>回退上一配置包</button>
          <button className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200" onClick={() => setShowNewPackForm(!showNewPackForm)}>新建包</button>
          {packMessage && <span className="text-sm text-green-700">{packMessage}</span>}
        </div>

        {showNewPackForm && (
          <div className="mb-4 p-3 border border-gray-200 rounded-lg flex gap-2">
            <input className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" placeholder="新配置包名称" value={newPackName} onChange={(e) => setNewPackName(e.target.value)} />
            <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm" onClick={handleCreatePack}>创建</button>
          </div>
        )}

        {/* 包列表 */}
        {packs.length === 0 ? (
          <p className="text-sm text-gray-400">暂无配置包</p>
        ) : (
          <div className="flex flex-wrap gap-2 mb-4">
            {packs.map((p) => (
              <button key={p.id} className={`px-3 py-1.5 rounded-lg text-sm border ${editingPackId === p.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:border-blue-300"}`} onClick={() => (editingPackId === p.id ? closeEdit() : openPack(p.id))}>
                {p.name}
                <span className="text-[10px] opacity-70 ml-1">{p.id}</span>
              </button>
            ))}
          </div>
        )}

        {/* 编辑区 */}
        {editingPackId && (
          <div className="border-t border-gray-200 pt-4">
            {loadingContents ? (
              <p className="text-sm text-gray-400">加载内容中...</p>
            ) : contents ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">编辑: {contents.manifest.name}</h3>
                  <div className="flex gap-2">
                    <button className={`px-3 py-1.5 rounded-lg text-sm ${dirty ? "bg-green-600 text-white hover:bg-green-700" : "bg-gray-100 text-gray-500"}`} onClick={saveContents} disabled={!dirty || saving}>
                      {saving ? "保存中..." : "保存修改"}
                    </button>
                    <button className="text-xs text-gray-500 hover:underline" onClick={closeEdit}>关闭</button>
                  </div>
                </div>

                {/* Tab 切换 */}
                <div className="flex gap-1 mb-3">
                  {(["platforms", "categories", "taxonomy"] as const).map((tab) => (
                    <button key={tab} className={`text-xs px-3 py-1.5 rounded ${activeTab === tab ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`} onClick={() => setActiveTab(tab)}>
                      {tab === "platforms" ? "平台基准" : tab === "categories" ? "分类覆盖" : "分类词表"}
                    </button>
                  ))}
                </div>

                {/* 平台基准 */}
                {activeTab === "platforms" && (
                  <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4">
                    <div className="space-y-1">
                      {contents.platforms.map((p) => (
                        <button key={p.id} className={`w-full text-left text-xs px-2 py-1.5 rounded ${selectedPlatform === p.id ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-600"}`} onClick={() => setSelectedPlatform(p.id)}>
                          {p.name}
                          <span className="block text-[10px] text-gray-400">{p.genders.map((g) => GENDER_LABELS[g] || g).join("、")}</span>
                        </button>
                      ))}
                      {contents.platforms.length === 0 && <p className="text-xs text-gray-400">暂无平台，导入 studio 的包后才有</p>}
                    </div>
                    {currentPlatform ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs"><span className="text-gray-500 block mb-0.5">平台名称</span><input className="w-full px-2 py-1 border rounded text-xs" value={currentPlatform.name} onChange={(e) => touchPlatform((p) => ({ ...p, name: e.target.value }))} /></label>
                          <label className="text-xs"><span className="text-gray-500 block mb-0.5">平台代码</span><input className="w-full px-2 py-1 border rounded text-xs" value={currentPlatform.code} onChange={(e) => touchPlatform((p) => ({ ...p, code: e.target.value }))} /></label>
                        </div>
                        <label className="text-xs"><span className="text-gray-500 block mb-0.5">通用追加提示词</span><textarea className="w-full px-2 py-1 border rounded text-xs h-16" value={currentPlatform.promptAppend} onChange={(e) => touchPlatform((p) => ({ ...p, promptAppend: e.target.value }))} /></label>
                        <div className="flex gap-2 items-center">
                          {GENDERS.map((g) => <button key={g} className={`text-xs px-2 py-1 rounded ${selectedGender === g ? "bg-blue-600 text-white" : "bg-gray-100"}`} onClick={() => setSelectedGender(g)}>{GENDER_LABELS[g]}</button>)}
                          <select className="text-xs px-2 py-1 border rounded" value={selectedPipeline} onChange={(e) => setSelectedPipeline(e.target.value)}>
                            {PIPELINES.map((p) => <option key={p} value={p}>{PIPELINE_LABELS[p]}</option>)}
                          </select>
                        </div>
                        {currentUnit ? (
                          <div className="space-y-2">
                            <div className="text-xs text-gray-500">权重（总和 100%）</div>
                            <div className="space-y-1">
                              {(contents.dimensions[selectedPipeline] || []).map((d) => {
                                const w = currentUnit.weights[d.key] ?? 0;
                                return (
                                  <div key={d.key} className="flex items-center gap-2 text-xs">
                                    <span className="w-20 text-gray-600">{d.label}</span>
                                    <input type="range" min={0} max={100} value={Math.round(w)} className="flex-1" onChange={(e) => editPlatformWeights({ ...currentUnit.weights, [d.key]: Number(e.target.value) })} />
                                    <span className="w-10 text-right font-mono">{Math.round(w)}%</span>
                                  </div>
                                );
                              })}
                            </div>
                            <label className="text-xs"><span className="text-gray-500 block mb-0.5">默认提示词</span><textarea className="w-full px-2 py-1 border rounded text-xs h-24 font-mono" value={currentUnit.prompt} onChange={(e) => editPlatformPrompt(e.target.value)} /></label>
                          </div>
                        ) : <p className="text-xs text-gray-400">该「频道 × pipeline」无配置</p>}
                      </div>
                    ) : <p className="text-xs text-gray-400">选择一个平台开始配置</p>}
                  </div>
                )}

                {/* 分类覆盖 */}
                {activeTab === "categories" && (
                  <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4">
                    <div className="space-y-1">
                      {contents.categories.map((c) => (
                        <button key={c.id} className={`w-full text-left text-xs px-2 py-1.5 rounded ${selectedCategory === c.id ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-600"}`} onClick={() => setSelectedCategory(c.id)}>
                          <span className="font-medium">{c.primaryCategory}</span> / {c.secondaryCategory}
                          <span className="block text-[10px] text-gray-400">{GENDER_LABELS[c.gender]} · {contents.platforms.find((p) => p.id === c.platformId)?.name || c.platformId}</span>
                        </button>
                      ))}
                      {contents.categories.length === 0 && <p className="text-xs text-gray-400">暂无分类覆盖</p>}
                    </div>
                    {currentCategory ? (
                      <div className="space-y-3">
                        <div className="text-xs text-gray-500">分类: {currentCategory.primaryCategory} / {currentCategory.secondaryCategory} · {GENDER_LABELS[currentCategory.gender]}</div>
                        <label className="text-xs flex items-center gap-2">
                          <input type="checkbox" checked={!currentCategory.inheritsWeights} onChange={(e) => touchCategory((c) => ({ ...c, inheritsWeights: !e.target.checked }))} />
                          <span>自定义权重（不勾选则继承平台基准）</span>
                        </label>
                        <div className="flex gap-2 items-center">
                          <select className="text-xs px-2 py-1 border rounded" value={selectedPipeline} onChange={(e) => setSelectedPipeline(e.target.value)}>
                            {PIPELINES.map((p) => <option key={p} value={p}>{PIPELINE_LABELS[p]}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          {(contents.dimensions[selectedPipeline] || []).map((d) => {
                            const w = currentCategory.pipelines[selectedPipeline]?.weights?.[d.key] ?? 0;
                            return (
                              <div key={d.key} className="flex items-center gap-2 text-xs">
                                <span className="w-20 text-gray-600">{d.label}</span>
                                <input type="range" min={0} max={100} value={Math.round(w)} className="flex-1" onChange={(e) => editCategoryWeights({ ...(currentCategory.pipelines[selectedPipeline]?.weights || {}), [d.key]: Number(e.target.value) })} />
                                <span className="w-10 text-right font-mono">{Math.round(w)}%</span>
                              </div>
                            );
                          })}
                        </div>
                        <label className="text-xs"><span className="text-gray-500 block mb-0.5">分类覆盖提示词</span><textarea className="w-full px-2 py-1 border rounded text-xs h-24 font-mono" value={currentCategory.pipelines[selectedPipeline]?.prompt ?? ""} onChange={(e) => editCategoryPrompt(e.target.value)} /></label>
                      </div>
                    ) : <p className="text-xs text-gray-400">选择一个分类开始编辑</p>}
                  </div>
                )}

                {/* 分类词表 */}
                {activeTab === "taxonomy" && (
                  <div className="space-y-4">
                    {GENDERS.map((gender) => (
                      <div key={gender}>
                        <div className="text-xs font-medium text-gray-700 mb-2">{GENDER_LABELS[gender]} 一级分类</div>
                        <div className="space-y-1">
                          {(contents.taxonomy[gender] || []).map((node, idx) => (
                            <div key={node.id} className="flex items-start gap-2 text-xs">
                              <span className="px-2 py-1 bg-gray-100 rounded">{node.label}</span>
                              <span className="text-gray-400">{node.id}</span>
                              <input className="flex-1 px-2 py-1 border rounded" value={node.secondary.join("、")} onChange={(e) => {
                                const nodes = [...(contents.taxonomy[gender] || [])];
                                nodes[idx] = { ...node, secondary: e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) };
                                editTaxonomy(gender, nodes);
                              }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {(!contents.taxonomy.male?.length && !contents.taxonomy.female?.length) && <p className="text-xs text-gray-400">词表为空</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400">无法加载配置包内容</p>
            )}
          </div>
        )}

        {/* 删除当前编辑包 */}
        {editingPackId && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <button className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50" onClick={() => handleDeletePack(editingPackId)}>删除当前配置包</button>
          </div>
        )}
      </div>
    </div>
  );
}
