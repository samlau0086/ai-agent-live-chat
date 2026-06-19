import { createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const envFile = getArg("env-file", ".env.production");
const file = getArg("file");
const confirmed = process.argv.includes("--yes");

if (!file) {
  console.error("Usage: npm run db:restore -- --file .backups/live-chat.dump --yes");
  process.exit(1);
}

if (!confirmed) {
  console.error("Restore is destructive. Re-run with --yes after confirming the target database is correct.");
  process.exit(1);
}

if (!existsSync(file)) {
  console.error(`Restore file not found: ${file}`);
  process.exit(1);
}

const dockerArgs = [
  "compose",
  "--env-file",
  envFile,
  "exec",
  "-T",
  "postgres",
  "sh",
  "-lc",
  'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
];

const child = spawn("docker", dockerArgs, { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
createReadStream(file).pipe(child.stdin);

child.on("error", (error) => {
  console.error(`Failed to start docker compose restore: ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  if (code !== 0) {
    console.error(`Restore failed with exit code ${code}`);
    process.exit(code ?? 1);
  }
  console.log(`Restore completed from ${file}`);
});
