export interface TelegramMessageLinkInput {
  chatId: number;
  chatUsername: string | null;
  telegramMessageId: number | null;
}

export function buildTelegramMessageUrl(
  input: TelegramMessageLinkInput
): string | null {
  if (input.telegramMessageId == null) return null;
  if (input.chatUsername != null && input.chatUsername.trim() !== '') {
    return `https://t.me/${input.chatUsername}/${input.telegramMessageId}`;
  }
  const text = String(input.chatId);
  if (text.startsWith('-100')) {
    return `https://t.me/c/${text.slice(4)}/${input.telegramMessageId}`;
  }
  return null;
}
