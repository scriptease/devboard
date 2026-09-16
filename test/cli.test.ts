import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, "bin/devboard.ts");

async function runCli(args: string[], env?: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

describe("devboard down", () => {
  test("is listed in help", async () => {
    const { code, out } = await runCli(["help"]);
    expect(code).toBe(0);
    expect(out).toMatch(/devboard down/);
  });

  test("is a no-op when the board is off", async () => {
    const port = 43999;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/services`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return; // something really listens here; do not kill it
    } catch {}
    const { code, out } = await runCli(["down"], { DEVBOARD_URL: `http://127.0.0.1:${port}` });
    expect(code).toBe(0);
    expect(out).toMatch(/board is off/);
  });
});

describe("devboard doctor", () => {
  test("exits 0 and reports bun, lsof, and ps", async () => {
    const { code, out } = await runCli(["doctor"]);
    expect(code).toBe(0);
    expect(out).toMatch(/^ok {2}bun \S+ meets /m);
    expect(out).toMatch(/^ok {2}lsof on PATH /m);
    expect(out).toMatch(/^ok {2}ps on PATH /m);
    expect(out).toMatch(/4242 (free|held by pid )/);
  });
});
