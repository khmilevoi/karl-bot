import { inject, injectable } from 'inversify';

import { UserEntity } from '@/domain/entities/UserEntity';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { UserRepository } from '@/domain/repositories/UserRepository';

@injectable()
export class SQLiteUserRepository implements UserRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}
  async upsert(user: UserEntity): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `
        INSERT INTO users (id, username, first_name, last_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET username   = excluded.username,
                                      first_name = excluded.first_name,
                                      last_name  = excluded.last_name
      `,
      user.id,
      user.username ?? null,
      user.firstName ?? null,
      user.lastName ?? null
    );
  }

  async findById(id: number): Promise<UserEntity | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<{
      id: number;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
    }>(
      'SELECT id, username, first_name, last_name FROM users WHERE id = ?',
      id
    );
    return row
      ? new UserEntity(row.id, row.username, row.first_name, row.last_name)
      : undefined;
  }
}
