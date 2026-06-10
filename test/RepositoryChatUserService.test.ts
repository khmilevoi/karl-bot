import { describe, expect, it, vi } from 'vitest';

import { RepositoryChatUserService } from '../src/application/use-cases/chat/RepositoryChatUserService';

describe('RepositoryChatUserService', () => {
  it('links users, lists ids and loads full users', async () => {
    const chatUsers = {
      link: vi.fn(async () => {}),
      listByChat: vi.fn(async () => [1, 2]),
    };
    const users = {
      findById: vi.fn().mockImplementation(async (id: number) =>
        id === 1
          ? {
              id: 1,
              username: 'u1',
              firstName: 'F1',
              lastName: 'L1',
            }
          : {
              id: 2,
              username: 'u2',
              firstName: 'F2',
              lastName: 'L2',
            }
      ),
    };
    const service = new RepositoryChatUserService(
      chatUsers as any,
      users as any
    );

    await service.link(123, 1);
    expect(chatUsers.link).toHaveBeenCalledWith(123, 1);

    const ids = await service.listUserIds(123);
    expect(ids).toEqual([1, 2]);

    const loaded = await service.listUsers(123);
    expect(loaded).toEqual([
      {
        id: 1,
        username: 'u1',
        firstName: 'F1',
        lastName: 'L1',
      },
      {
        id: 2,
        username: 'u2',
        firstName: 'F2',
        lastName: 'L2',
      },
    ]);
  });
});
