const active = new Map<string, number>();
export function tryAcquire(key: string, limit = 2): boolean { const count = active.get(key) || 0; if (count >= limit) return false; active.set(key, count + 1); return true; }
export function release(key: string): void { const count = active.get(key) || 0; if (count <= 1) active.delete(key); else active.set(key, count - 1); }
