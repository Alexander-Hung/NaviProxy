import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const schemaPath = new URL('./schema.sql', import.meta.url);

export function createDatabase() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));

  return db;
}

export type NaviDatabase = ReturnType<typeof createDatabase>;
