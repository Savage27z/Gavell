import { Bot } from "grammy";

export interface TelegramGateway {
  banChatMember(chatId: number, userId: number): Promise<void>;
  unbanChatMember(chatId: number, userId: number): Promise<void>;
  muteChatMember(chatId: number, userId: number, untilUnix: number): Promise<void>;
  unmuteChatMember(chatId: number, userId: number): Promise<void>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
}

export class GrammyGateway implements TelegramGateway {
  constructor(private bot: Bot) {}

  async banChatMember(chatId: number, userId: number) {
    await this.bot.api.banChatMember(chatId, userId);
  }

  async unbanChatMember(chatId: number, userId: number) {
    await this.bot.api.unbanChatMember(chatId, userId, { only_if_banned: true });
  }

  async muteChatMember(chatId: number, userId: number, untilUnix: number) {
    await this.bot.api.restrictChatMember(chatId, userId, { can_send_messages: false }, { until_date: untilUnix });
  }

  async unmuteChatMember(chatId: number, userId: number) {
    await this.bot.api.restrictChatMember(chatId, userId, {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    });
  }

  async deleteMessage(chatId: number, messageId: number) {
    await this.bot.api.deleteMessage(chatId, messageId);
  }
}
