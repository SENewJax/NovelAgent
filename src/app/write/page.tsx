"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSSE, SSEEvent } from "@/hooks/use-sse";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface OutlineData {
  title: string;
  genre: string;
  gender?: "male" | "female";
  type?: string;
  track?: string;
  worldSetting: string;
  characters: { name: string; role: string; description: string }[];
  plotOutline: string;
  plotMode: string;
  tone: string;
  chapterPlan: { title: string; summary: string }[];
}

type Phase = "chat" | "generating" | "editing";

export default function WritePage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "你好！我是你的小说创作助手。\n\n我们来一起创作一部小说吧！你可以随意告诉我你想写什么类型的故事，比如主角是谁、什么背景、什么风格。\n\n不用一次说完，想到什么说什么就好~" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [outline, setOutline] = useState<OutlineData | null>(null);
  const [phase, setPhase] = useState<Phase>("chat");
  const [chapters, setChapters] = useState<{ title: string; content: string }[]>([]);
  const [activeChapter, setActiveChapter] = useState(0);
  const [refineInput, setRefineInput] = useState("");
  const [refining, setRefining] = useState(false);
  const [genProgress, setGenProgress] = useState("");
  // 性别/型/赛道 手动选择
  const [selectedGender, setSelectedGender] = useState<"male" | "female" | "">("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedTrack, setSelectedTrack] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const onSSEEvent = useCallback((event: SSEEvent) => {
    if (event.event === "progress" && event.data.message) {
      setGenProgress(event.data.message);
    }
  }, []);

  const onSSEComplete = useCallback((event: SSEEvent) => {
    if (event.event === "complete" && event.data?.chapters) {
      setChapters(event.data.chapters);
      setPhase("editing");
      setActiveChapter(0);
    }
  }, []);

  const sse = useSSE(onSSEEvent, onSSEComplete);

  // SSE 错误处理
  useEffect(() => {
    if (sse.error) {
      alert("生成失败: " + sse.error);
      setPhase("chat");
    }
  }, [sse.error]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 当 outline 更新时，自动同步性别/型/赛道
  useEffect(() => {
    if (outline) {
      if (outline.gender && !selectedGender) setSelectedGender(outline.gender);
      if (outline.type && !selectedType) setSelectedType(outline.type);
      if (outline.track && !selectedTrack) setSelectedTrack(outline.track);
    }
  }, [outline, selectedGender, selectedType, selectedTrack]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/write/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages([...newMessages, { role: "assistant", content: "出错了：" + data.error }]);
      } else {
        setMessages([...newMessages, { role: "assistant", content: data.reply }]);
        if (data.outline) setOutline(data.outline);
      }
    } catch (err: any) {
      setMessages([...newMessages, { role: "assistant", content: "网络错误：" + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    if (!outline || !outline.chapterPlan?.length) return;
    if (!selectedGender) {
      alert("请先选择性别方向（男频/女频）");
      return;
    }
    setPhase("generating");
    setGenProgress("正在生成章节...");

    // 将手动选择的性别/型/赛道合并到 outline 中
    const mergedOutline = {
      ...outline,
      gender: selectedGender || outline.gender,
      type: selectedType || outline.type,
      track: selectedTrack || outline.track,
    };

    sse.start("/api/write/generate", { outline: mergedOutline });
  };

  const handleRefine = async () => {
    if (!refineInput.trim() || refining) return;
    setRefining(true);

    try {
      const prevEnd = activeChapter > 0 ? chapters[activeChapter - 1]?.content?.slice(-300) : "";
      const res = await fetch("/api/write/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterContent: chapters[activeChapter].content,
          chapterTitle: chapters[activeChapter].title,
          feedback: refineInput,
          outline,
          prevChapterEnd: prevEnd,
        }),
      });
      const data = await res.json();

      if (data.error) {
        alert("修改失败: " + data.error);
      } else {
        const updated = [...chapters];
        updated[activeChapter] = { ...updated[activeChapter], content: data.content };
        setChapters(updated);
        setRefineInput("");
      }
    } catch (err: any) {
      alert("修改失败: " + err.message);
    } finally {
      setRefining(false);
    }
  };

  // === 渲染 ===

  if (phase === "generating") {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="text-5xl mb-4 animate-pulse">✍️</div>
        <h2 className="text-xl font-bold mb-2">AI 正在创作小说</h2>
        <p className="text-gray-500">{genProgress}</p>
        <p className="text-xs text-gray-400 mt-4">每章约2000-3000字，请耐心等待...</p>
      </div>
    );
  }

  if (phase === "editing") {
    return (
      <div className="h-[calc(100vh-8rem)] flex gap-4">
        {/* 左侧章节列表 */}
        <div className="w-48 shrink-0 space-y-2 overflow-y-auto">
          <h3 className="font-semibold text-sm text-gray-500 px-2">章节列表</h3>
          {chapters.map((ch, i) => (
            <button
              key={i}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                i === activeChapter
                  ? "bg-blue-600 text-white"
                  : "bg-white border hover:bg-gray-50"
              }`}
              onClick={() => setActiveChapter(i)}
            >
              第{i + 1}章 {ch.title}
            </button>
          ))}
          <button
            className="w-full px-3 py-2 text-sm text-gray-500 hover:text-blue-600"
            onClick={() => setPhase("chat")}
          >
            ← 返回对话
          </button>
        </div>

        {/* 中间章节内容 */}
        <div className="flex-1 flex flex-col bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-bold">第{activeChapter + 1}章 {chapters[activeChapter].title}</h3>
            <span className="text-xs text-gray-500">{chapters[activeChapter].content.length}字</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
              {chapters[activeChapter].content}
            </div>
          </div>
          {/* 微调输入 */}
          <div className="border-t p-3">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
                placeholder="输入修改要求，如：开头太慢热，加一个冲突..."
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRefine()}
              />
              <button
                className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700 disabled:bg-gray-300"
                onClick={handleRefine}
                disabled={refining || !refineInput.trim()}
              >
                {refining ? "修改中..." : "微调"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === 聊天阶段 ===
  const canGenerate = outline && outline.chapterPlan && outline.chapterPlan.length > 0 && selectedGender;

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-4">
      {/* 左侧聊天区 */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border overflow-hidden">
        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 px-4 py-2 rounded-2xl rounded-bl-sm text-sm text-gray-500">
                <span className="animate-pulse">正在思考...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 输入框 */}
        <div className="border-t p-3 flex gap-2">
          <input
            type="text"
            className="flex-1 px-4 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="告诉AI你想写什么样的小说..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button
            className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 disabled:bg-gray-300"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            发送
          </button>
        </div>
      </div>

      {/* 右侧设定面板 */}
      <div className="w-80 shrink-0 flex flex-col gap-4 overflow-y-auto">
        {/* 性别/型/赛道 选择器 */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-bold text-sm">🎯 赛道方向</h3>

          {/* 性别选择 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">性别方向（必选）</label>
            <div className="flex gap-2">
              <button
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedGender === "male"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                onClick={() => { setSelectedGender("male"); setSelectedType(""); setSelectedTrack(""); }}
              >
                男频
              </button>
              <button
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedGender === "female"
                    ? "bg-pink-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                onClick={() => { setSelectedGender("female"); setSelectedType(""); setSelectedTrack(""); }}
              >
                女频
              </button>
            </div>
          </div>

          {/* 型选择 */}
          {selectedGender && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">型</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm"
                value={selectedType}
                onChange={(e) => { setSelectedType(e.target.value); setSelectedTrack(""); }}
              >
                <option value="">-- 请选择型 --</option>
                {selectedGender === "male" ? (
                  <>
                    <option value="growth">成长型</option>
                    <option value="identity">身份型</option>
                    <option value="precognition">预知型</option>
                  </>
                ) : (
                  <>
                    <option value="strength_reversal">实力逆袭型</option>
                    <option value="identity_reversal">身份反转型</option>
                    <option value="emotional">情感关系型</option>
                  </>
                )}
              </select>
            </div>
          )}

          {/* 赛道选择 */}
          {selectedType && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">赛道</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm"
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
              >
                <option value="">-- 请选择赛道 --</option>
                {selectedGender === "male" && selectedType === "growth" && (
                  <>
                    <option value="counterattack">逆袭</option>
                    <option value="cultivation">修仙</option>
                    <option value="fantasy">玄幻</option>
                  </>
                )}
                {selectedGender === "male" && selectedType === "identity" && (
                  <>
                    <option value="war_god">战神</option>
                    <option value="son_in_law">赘婿</option>
                    <option value="ceo">霸总</option>
                  </>
                )}
                {selectedGender === "male" && selectedType === "precognition" && (
                  <>
                    <option value="rebirth">重生</option>
                    <option value="isekai_a">穿越(降维流)</option>
                    <option value="isekai_b">穿越(穿书流)</option>
                  </>
                )}
                {selectedGender === "female" && selectedType === "strength_reversal" && (
                  <>
                    <option value="workplace">职场</option>
                    <option value="scholar">学霸</option>
                    <option value="doctor">医生</option>
                  </>
                )}
                {selectedGender === "female" && selectedType === "identity_reversal" && (
                  <>
                    <option value="cultivation_isekai">穿越修仙</option>
                    <option value="true_heiress">真千金</option>
                    <option value="vest">马甲</option>
                  </>
                )}
                {selectedGender === "female" && selectedType === "emotional" && (
                  <>
                    <option value="angst_romance">虐文言情</option>
                  </>
                )}
              </select>
            </div>
          )}

          {/* 当前选择摘要 */}
          {selectedGender && selectedType && selectedTrack && (
            <div className="bg-green-50 rounded-lg p-2 text-xs text-green-700">
              ✓ {selectedGender === "male" ? "男频" : "女频"} / {selectedType} / {selectedTrack}
            </div>
          )}
        </div>

        {/* 结构化摘要 */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-bold text-sm flex items-center gap-2">
            📋 小说设定
            {outline && <span className="text-xs text-green-600 font-normal">已提取</span>}
          </h3>

          {outline ? (
            <div className="space-y-2 text-xs">
              <InfoRow label="标题" value={outline.title} />
              <InfoRow label="类型" value={outline.genre} />
              <InfoRow label="剧情模式" value={outline.plotMode} />
              <InfoRow label="文风" value={outline.tone} />

              {outline.worldSetting && outline.worldSetting !== "待定" && (
                <div>
                  <span className="text-gray-500">世界观：</span>
                  <p className="text-gray-700 mt-0.5">{outline.worldSetting}</p>
                </div>
              )}

              {outline.characters?.length > 0 && (
                <div>
                  <span className="text-gray-500">角色：</span>
                  <div className="mt-1 space-y-1">
                    {outline.characters.map((c, i) => (
                      <div key={i} className="bg-gray-50 rounded px-2 py-1">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-gray-500 ml-1">({c.role})</span>
                        {c.description && <p className="text-gray-600">{c.description}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {outline.plotOutline && outline.plotOutline !== "待定" && (
                <div>
                  <span className="text-gray-500">剧情大纲：</span>
                  <p className="text-gray-700 mt-0.5">{outline.plotOutline}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              和AI聊天后，设定信息会自动整理到这里
            </p>
          )}
        </div>

        {/* 章节规划 */}
        {outline?.chapterPlan && outline.chapterPlan.length > 0 && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-bold text-sm mb-2">📑 章节规划</h3>
            <div className="space-y-2">
              {outline.chapterPlan.map((ch, i) => (
                <div key={i} className="text-xs bg-gray-50 rounded p-2">
                  <span className="font-medium">第{i + 1}章 {ch.title}</span>
                  <p className="text-gray-500 mt-0.5">{ch.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 开始写作按钮 */}
        {canGenerate ? (
          <button
            className="w-full py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
            onClick={handleGenerate}
          >
            🚀 开始写小说（{outline!.chapterPlan.length}章）
          </button>
        ) : outline?.chapterPlan?.length ? (
          <div className="w-full py-3 bg-gray-200 text-gray-500 rounded-xl font-medium text-center text-sm">
            请先选择性别方向
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value || value === "待定") return null;
  return (
    <div>
      <span className="text-gray-500">{label}：</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}
