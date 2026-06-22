export function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "P2021") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return message.includes("does not exist in the current database") || message.includes("does not exist");
}

export function migrationRequiredResponseBody(tableName?: string) {
  return {
    error: tableName
      ? `Database migration required: missing table ${tableName}. Run prisma migrate deploy against the current database.`
      : "Database migration required. Run prisma migrate deploy against the current database.",
    command: "npm run db:deploy",
  };
}
