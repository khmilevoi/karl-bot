import { inject, injectable } from 'inversify';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

import type { EnvService } from '@/application/interfaces/env/EnvService';
import { ENV_SERVICE_ID } from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  type DbProvider,
  type SqlDatabase,
} from '@/domain/repositories/DbProvider';
import { parseDatabaseUrl } from '@/utils/database';

export type SQLiteDbProvider = DbProvider;

@injectable()
export class SQLiteDbProviderImpl implements DbProvider {
  private db: Promise<SqlDatabase>;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) envService: EnvService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('SQLiteDbProviderImpl');
    const filename = parseDatabaseUrl(envService.env.DATABASE_URL);
    this.logger.info({ filename }, 'Opening SQLite database');
    this.db = open({ filename, driver: sqlite3.Database })
      .then(async (db) => {
        await db.run('PRAGMA journal_mode = WAL');
        await db.run('PRAGMA busy_timeout = 5000');
        return db;
      })
      .catch((error) => {
        this.logger.error(
          { filename, error },
          'Failed to open SQLite database'
        );
        throw error;
      }) as Promise<SqlDatabase>;
  }

  get(): Promise<SqlDatabase> {
    return this.db;
  }

  async listTables(): Promise<string[]> {
    try {
      const db = await this.db;
      const rows = await db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      const tables = rows.map((r) => r.name);
      this.logger.info({ count: tables.length }, 'Enumerated database tables');
      return tables;
    } catch (error) {
      this.logger.error({ error }, 'Failed to list database tables');
      throw error;
    }
  }
}
