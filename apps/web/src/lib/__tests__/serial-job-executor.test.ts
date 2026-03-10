import { describe, expect, it } from "vitest";

import { SerialJobExecutor } from "@/lib/serial-job-executor";

describe("SerialJobExecutor", () => {
  it("executes jobs sequentially", async () => {
    const executor = new SerialJobExecutor();
    const order: number[] = [];

    const delay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    // Enqueue three jobs with decreasing delays.
    // Without serialisation they would finish in reverse order.
    const p1 = executor.run(async () => {
      await delay(30);
      order.push(1);
    });
    const p2 = executor.run(async () => {
      await delay(10);
      order.push(2);
    });
    const p3 = executor.run(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("does not block the queue when a job throws", async () => {
    const executor = new SerialJobExecutor();

    const failing = executor.run(async () => {
      throw new Error("boom");
    });
    const succeeding = executor.run(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(succeeding).resolves.toBe("ok");
  });

  it("returns the job result", async () => {
    const executor = new SerialJobExecutor();
    const result = await executor.run(async () => 42);
    expect(result).toBe(42);
  });

  it("runs jobs in order even when enqueued asynchronously", async () => {
    const executor = new SerialJobExecutor();
    const order: string[] = [];

    const delay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    const p1 = executor.run(async () => {
      await delay(20);
      order.push("a");
    });

    // Wait a bit, then enqueue more
    await delay(5);

    const p2 = executor.run(async () => {
      order.push("b");
    });
    const p3 = executor.run(async () => {
      order.push("c");
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("handles multiple sequential failures gracefully", async () => {
    const executor = new SerialJobExecutor();

    const f1 = executor.run(async () => {
      throw new Error("first");
    });
    const f2 = executor.run(async () => {
      throw new Error("second");
    });
    const ok = executor.run(async () => "recovered");

    await expect(f1).rejects.toThrow("first");
    await expect(f2).rejects.toThrow("second");
    await expect(ok).resolves.toBe("recovered");
  });
});
