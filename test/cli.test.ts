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

async function withFakeBoard(body: (url: string) => Promise<void>, calls: string[] = []): Promise<void> {
  const services = [
    { id: "gerrit-tailnet-8899", name: "gerrit-tailnet", status: "running", ports: [8899], kind: "dev" },
    { id: "nexus-tailnet-8900", name: "nexus-tailnet", status: "stopped", ports: [8900], kind: "dev" },
  ];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const { pathname } = new URL(req.url);
      calls.push(`${req.method} ${pathname}`);
      if (pathname === "/api/services") {
        return Response.json({
          services,
          projects: [{ id: "tailnet", name: "Tailnet", memberIds: services.map((s) => s.id), on: 1, off: 1 }],
        });
      }
      if (pathname === "/api/projects/tailnet/start") return Response.json({ started: [{ id: "nexus-tailnet-8900", pid: 4242 }], errors: [] });
      if (pathname === "/api/projects/tailnet/stop") return Response.json({ stopped: ["gerrit-tailnet-8899"], errors: [] });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  try {
    await body(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
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

describe("devboard project", () => {
  test("is listed in help", async () => {
    const { code, out } = await runCli(["help"]);
    expect(code).toBe(0);
    expect(out).toMatch(/devboard project <cmd> <id>/);
  });

  test("ls prints every project with its on and off counts", async () => {
    await withFakeBoard(async (url) => {
      const { code, out } = await runCli(["project", "ls"], { DEVBOARD_URL: url });
      expect(code).toBe(0);
      expect(out).toMatch(/^tailnet {2}Tailnet {2}1 on {2}1 off$/m);
    });
  });

  test("status prints one line per member, running first word", async () => {
    await withFakeBoard(async (url) => {
      const { code, out } = await runCli(["project", "status", "tailnet"], { DEVBOARD_URL: url });
      expect(code).toBe(0);
      expect(out).toMatch(/^on {3}gerrit-tailnet-8899 {2}gerrit-tailnet$/m);
      expect(out).toMatch(/^off {2}nexus-tailnet-8900 {2}nexus-tailnet$/m);
    });
  });

  test("start posts to the project start route and reports each service", async () => {
    const calls: string[] = [];
    await withFakeBoard(async (url) => {
      const { code, out } = await runCli(["project", "start", "tailnet"], { DEVBOARD_URL: url });
      expect(code).toBe(0);
      expect(out).toMatch(/started nexus-tailnet-8900/);
    }, calls);
    expect(calls).toContain("POST /api/projects/tailnet/start");
  });

  test("restart stops before it starts", async () => {
    const calls: string[] = [];
    await withFakeBoard(async (url) => {
      const { code } = await runCli(["project", "restart", "tailnet"], { DEVBOARD_URL: url });
      expect(code).toBe(0);
    }, calls);
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
      "POST /api/projects/tailnet/stop",
      "POST /api/projects/tailnet/start",
    ]);
  });

  test("fails on an unknown project", async () => {
    await withFakeBoard(async (url) => {
      const { code, err } = await runCli(["project", "status", "nope"], { DEVBOARD_URL: url });
      expect(code).toBe(1);
      expect(err).toMatch(/no project nope/);
    });
  });
});
