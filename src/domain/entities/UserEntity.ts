export class UserEntity {
  constructor(
    public readonly id: number,
    public username?: string | null,
    public firstName?: string | null,
    public lastName?: string | null
  ) {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error('Invalid user id');
    }
  }
}
