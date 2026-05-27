import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const python = existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3";

const commands = [
  {
    name: "backend",
    command: python,
    args: ["-m", "uvicorn", "backend.app.main:app", "--reload", "--port", "8000"],
  },
  {
    name: "frontend",
    command: "npm",
    args: ["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1"],
  },
];

const children = commands.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown();
    }
  });
  return child;
});

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
