/**
 * 有界并发执行器
 *
 * 将一批任务按指定并发数同时执行，每个任务完成后立即取下一个。
 * 用于分析流水线中的逐章打分，将 O(n) 串行变为 O(n/c) 并行。
 */

export interface ConcurrencyResult {
  succeeded: number;
  failed: { index: number; error: Error }[];
}

/**
 * 有界并发执行
 *
 * @param items 待处理的项目数组
 * @param concurrency 最大并发数
 * @param fn 处理函数（接收 item 和原始 index）
 * @returns { succeeded, failed } 成功/失败统计
 */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, originalIndex: number) => Promise<void>
): Promise<ConcurrencyResult> {
  let nextIndex = 0;
  let succeeded = 0;
  const failures: { index: number; error: Error }[] = [];

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      try {
        await fn(items[currentIndex], currentIndex);
        succeeded++;
      } catch (err: any) {
        failures.push({ index: currentIndex, error: err });
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return { succeeded, failed: failures };
}
