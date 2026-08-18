import { randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { backup, DatabaseSync } from "node:sqlite";

if (process.argv.length > 3) {
  throw new Error("Usage: node scripts/backup-db.mjs [destination.db]");
}

const sourcePath = resolve(process.env.DATABASE_PATH ?? "./data/atlas.db");
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const destinationPath = resolve(
  process.argv[2] ??
    join(dirname(sourcePath), "backups", `atlas-${timestamp}.db`),
);

if (sourcePath === destinationPath) {
  throw new Error("The backup destination must differ from DATABASE_PATH.");
}

const sourceStat = await stat(sourcePath).catch((error) => {
  if (error.code === "ENOENT") {
    throw new Error(`Database does not exist: ${sourcePath}`, {
      cause: error,
    });
  }
  throw error;
});

if (!sourceStat.isFile()) {
  throw new Error(`Database path is not a regular file: ${sourcePath}`);
}

await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });

try {
  await lstat(destinationPath);
  throw new Error(`Refusing to overwrite existing backup: ${destinationPath}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const temporaryPath = join(
  dirname(destinationPath),
  `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`,
);

const sourceDatabase = new DatabaseSync(sourcePath, { readOnly: true });

try {
  const pages = await backup(sourceDatabase, temporaryPath);
  await chmod(temporaryPath, 0o600);

  const backupDatabase = new DatabaseSync(temporaryPath, { readOnly: true });
  try {
    const check = backupDatabase.prepare("PRAGMA quick_check").get();
    if (Object.values(check)[0] !== "ok") {
      throw new Error("SQLite integrity check failed for the new backup.");
    }
  } finally {
    backupDatabase.close();
  }

  // A hard link publishes the completed backup atomically and fails if another
  // process created the requested destination in the meantime.
  await link(temporaryPath, destinationPath);
  await unlink(temporaryPath);

  console.log(`Backup created: ${destinationPath} (${pages} pages)`);
} catch (error) {
  await unlink(temporaryPath).catch((unlinkError) => {
    if (unlinkError.code !== "ENOENT") throw unlinkError;
  });
  throw error;
} finally {
  sourceDatabase.close();
}
