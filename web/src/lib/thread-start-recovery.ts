/// Start requests reuse their request id, so a lost response can be retried
/// without creating another thread or sending the opening message twice.
export async function recoverThreadStartRequest<T>(request: () => Promise<T>, active: () => boolean, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<T | undefined> {
  for (let attempt = 0; active(); attempt++) {
    try { return await request(); }
    catch (error) {
      const status = (error as {status?: number})?.status;
      if (attempt >= 3 || !status || ![500, 502, 503, 504].includes(status)) throw error;
      await wait(400 * 2 ** attempt);
    }
  }
  return undefined;
}
