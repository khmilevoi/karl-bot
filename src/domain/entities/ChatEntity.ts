export class ChatEntity {
  private _title: string | null;
  private _username: string | null;

  constructor(
    public readonly chatId: number,
    title?: string | null,
    username?: string | null
  ) {
    if (!Number.isInteger(chatId)) {
      throw new Error('Invalid chat id');
    }
    this._title = title ?? null;
    this._username = username ?? null;
  }

  get title(): string | null {
    return this._title;
  }

  get username(): string | null {
    return this._username;
  }

  rename(title?: string | null): void {
    this._title = title ?? null;
  }

  setUsername(username?: string | null): void {
    this._username = username ?? null;
  }
}
