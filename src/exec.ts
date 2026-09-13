import { spawn } from "node:child_process";

export type ExecResult = { stdout: string; stderr: string; code: number };

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    let stdout = "", stderr = "";
    // Node's StringDecoder buffers a multi-byte UTF-8 sequence split across chunks instead of
    // decoding each chunk independently (which would turn the split character into U+FFFD).
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ stdout, stderr: stderr + err.message, code: err.code === "ENOENT" ? 127 : 1 });
    });
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.stdin.on("error", () => {});
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}
