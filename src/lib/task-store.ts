import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface PersistedTask { id: string; kind: string; status: TaskStatus; progress: unknown[]; result?: unknown; error?: string; createdAt: string; updatedAt: string; cancelRequested?: boolean; }
const dir = path.join(process.cwd(), ".novel", "tasks");
const file = (id: string) => path.join(dir, `${id}.json`);
export async function createTask(kind: string): Promise<PersistedTask> { await fs.mkdir(dir, { recursive: true }); const now = new Date().toISOString(); const task = { id: randomUUID(), kind, status: "queued" as const, progress: [], createdAt: now, updatedAt: now }; await fs.writeFile(file(task.id), JSON.stringify(task), "utf8"); return task; }
export async function loadTask(id: string): Promise<PersistedTask | null> { try { return JSON.parse(await fs.readFile(file(id), "utf8")); } catch { return null; } }
export async function updateTask(id: string, patch: Partial<PersistedTask>): Promise<PersistedTask | null> { const task = await loadTask(id); if (!task) return null; const next = { ...task, ...patch, updatedAt: new Date().toISOString() }; const tmp = file(id) + ".tmp"; await fs.writeFile(tmp, JSON.stringify(next), "utf8"); await fs.rename(tmp, file(id)); return next; }
export async function appendTaskProgress(id: string, event: unknown): Promise<void> { const task = await loadTask(id); if (task) await updateTask(id, { progress: [...task.progress.slice(-199), event], status: "running" }); }
export async function requestTaskCancel(id: string): Promise<PersistedTask | null> { return updateTask(id, { cancelRequested: true }); }
