import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const envFile = getArg("env-file", ".env.production");
const output = getArg("out", path.join(".backups", `live-chat-${timestamp()}.dump`));

await mkdir(path.dirname(output), { recursive: true });

const dockerArgs = [
  "compose",
  "--env-file",
  envFile,
  "exec",
  "-T",
  "postgres",
  "sh",
  "-lc",
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
];

const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });
const file = createWriteStream(output);
child.stdout.pipe(file);

child.on("error", (error) => {
  console.error(`Failed to start docker compose backup: ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  file.close();
  if (code !== 0) {
    console.error(`Backup failed with exit code ${code}`);
    process.exit(code ?? 1);
  }
  console.log(`Backup written to ${output}`);
});
