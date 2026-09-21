import { spawn } from "node:child_process";

export type CommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export function runCommand(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      // npm is a .cmd shim on Windows; Git is an executable and must receive
      // its argument array directly (commit messages and format strings contain spaces/pipes).
      shell: process.platform === "win32" && command === "npm",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      resolve({
        command: [command, ...args].join(" "),
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
    child.on("error", (error) => {
      resolve({
        command: [command, ...args].join(" "),
        exitCode: 1,
        stdout,
        stderr: stderr + "\n" + error.message,
        durationMs: Date.now() - started,
      });
    });
  });
}
