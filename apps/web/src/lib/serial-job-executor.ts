/**
 * Serializes async operations so they execute one at a time.
 *
 * Inspired by the AI SDK's SerialJobExecutor pattern. Each call to `run()`
 * enqueues a job that waits for the previous one to finish (whether it
 * succeeded or failed) before starting.
 *
 * This prevents race conditions when multiple async paths (streaming,
 * polling, user actions) need to mutate the same piece of state.
 */
export class SerialJobExecutor {
  private queue: Promise<void> = Promise.resolve();

  /**
   * Enqueue a job. It will run after all previously enqueued jobs finish.
   * The returned promise resolves/rejects with the job's own result.
   */
  run<T>(job: () => Promise<T>): Promise<T> {
    let resolve: (value: T) => void;
    let reject: (reason: unknown) => void;

    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // Chain onto the queue. Previous failures must not block subsequent jobs,
    // so we attach to both the resolved and rejected branch.
    this.queue = this.queue.then(
      () => job().then(resolve!, reject!),
      () => job().then(resolve!, reject!),
    );

    return result;
  }
}
