import { type Container } from 'inversify';

import {
  ACCESS_KEY_REPOSITORY_ID,
  type AccessKeyRepository,
} from '../domain/repositories/AccessKeyRepository';
import {
  CHAT_ACCESS_REPOSITORY_ID,
  type ChatAccessRepository,
} from '../domain/repositories/ChatAccessRepository';
import {
  CHAT_CONFIG_REPOSITORY_ID,
  type ChatConfigRepository,
} from '../domain/repositories/ChatConfigRepository';
import {
  CHAT_REPOSITORY_ID,
  type ChatRepository,
} from '../domain/repositories/ChatRepository';
import {
  CHAT_USER_REPOSITORY_ID,
  type ChatUserRepository,
} from '../domain/repositories/ChatUserRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '../domain/repositories/DbProvider';
import {
  MESSAGE_REPOSITORY_ID,
  type MessageRepository,
} from '../domain/repositories/MessageRepository';
import {
  SUMMARY_REPOSITORY_ID,
  type SummaryRepository,
} from '../domain/repositories/SummaryRepository';
import {
  USER_REPOSITORY_ID,
  type UserRepository,
} from '../domain/repositories/UserRepository';
import { SQLiteDbProviderImpl } from '../infrastructure/persistence/sqlite/DbProvider';
import { SQLiteAccessKeyRepository } from '../infrastructure/persistence/sqlite/SQLiteAccessKeyRepository';
import { SQLiteChatAccessRepository } from '../infrastructure/persistence/sqlite/SQLiteChatAccessRepository';
import { SQLiteChatConfigRepository } from '../infrastructure/persistence/sqlite/SQLiteChatConfigRepository';
import { SQLiteChatRepository } from '../infrastructure/persistence/sqlite/SQLiteChatRepository';
import { SQLiteChatUserRepository } from '../infrastructure/persistence/sqlite/SQLiteChatUserRepository';
import { SQLiteMessageRepository } from '../infrastructure/persistence/sqlite/SQLiteMessageRepository';
import { SQLiteSummaryRepository } from '../infrastructure/persistence/sqlite/SQLiteSummaryRepository';
import { SQLiteUserRepository } from '../infrastructure/persistence/sqlite/SQLiteUserRepository';
import {
  AI_ERROR_EVENT_REPOSITORY_ID,
  type AiErrorEventRepository,
} from '../domain/repositories/AiErrorEventRepository';
import {
  BEHAVIOR_EVENT_REPOSITORY_ID,
  type BehaviorEventRepository,
} from '../domain/repositories/BehaviorEventRepository';
import {
  PERSONALITY_STATE_REPOSITORY_ID,
  type PersonalityStateRepository,
} from '../domain/repositories/PersonalityStateRepository';
import {
  POLITICAL_STATE_REPOSITORY_ID,
  type PoliticalStateRepository,
} from '../domain/repositories/PoliticalStateRepository';
import {
  TRUTH_REPOSITORY_ID,
  type TruthRepository,
} from '../domain/repositories/TruthRepository';
import {
  USER_SOCIAL_PROFILE_REPOSITORY_ID,
  type UserSocialProfileRepository,
} from '../domain/repositories/UserSocialProfileRepository';
import {
  PERSONALITY_SIGNAL_REPOSITORY_ID,
  type PersonalitySignalRepository,
} from '../domain/repositories/PersonalitySignalRepository';
import {
  STATE_EVOLUTION_CURSOR_REPOSITORY_ID,
  type StateEvolutionCursorRepository,
} from '../domain/repositories/StateEvolutionCursorRepository';
import {
  USER_POLITICAL_PROFILE_REPOSITORY_ID,
  type UserPoliticalProfileRepository,
} from '../domain/repositories/UserPoliticalProfileRepository';
import { SQLiteAiErrorEventRepository } from '../infrastructure/persistence/sqlite/SQLiteAiErrorEventRepository';
import { SQLiteBehaviorEventRepository } from '../infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository';
import { SQLitePersonalitySignalRepository } from '../infrastructure/persistence/sqlite/SQLitePersonalitySignalRepository';
import { SQLitePersonalityStateRepository } from '../infrastructure/persistence/sqlite/SQLitePersonalityStateRepository';
import { SQLitePoliticalStateRepository } from '../infrastructure/persistence/sqlite/SQLitePoliticalStateRepository';
import { SQLiteStateEvolutionCursorRepository } from '../infrastructure/persistence/sqlite/SQLiteStateEvolutionCursorRepository';
import { SQLiteTruthRepository } from '../infrastructure/persistence/sqlite/SQLiteTruthRepository';
import { SQLiteUserPoliticalProfileRepository } from '../infrastructure/persistence/sqlite/SQLiteUserPoliticalProfileRepository';
import { SQLiteUserSocialProfileRepository } from '../infrastructure/persistence/sqlite/SQLiteUserSocialProfileRepository';
import {
  VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID,
  type VoiceTranscriptionJobRepository,
} from '../domain/repositories/VoiceTranscriptionJobRepository';
import { SQLiteVoiceTranscriptionJobRepository } from '../infrastructure/persistence/sqlite/SQLiteVoiceTranscriptionJobRepository';

export const register = (container: Container): void => {
  container
    .bind<DbProvider>(DB_PROVIDER_ID)
    .to(SQLiteDbProviderImpl)
    .inSingletonScope();
  container
    .bind<ChatRepository>(CHAT_REPOSITORY_ID)
    .to(SQLiteChatRepository)
    .inSingletonScope();
  container
    .bind<ChatUserRepository>(CHAT_USER_REPOSITORY_ID)
    .to(SQLiteChatUserRepository)
    .inSingletonScope();
  container
    .bind<UserRepository>(USER_REPOSITORY_ID)
    .to(SQLiteUserRepository)
    .inSingletonScope();
  container
    .bind<MessageRepository>(MESSAGE_REPOSITORY_ID)
    .to(SQLiteMessageRepository)
    .inSingletonScope();
  container
    .bind<SummaryRepository>(SUMMARY_REPOSITORY_ID)
    .to(SQLiteSummaryRepository)
    .inSingletonScope();
  container
    .bind<AccessKeyRepository>(ACCESS_KEY_REPOSITORY_ID)
    .to(SQLiteAccessKeyRepository)
    .inSingletonScope();
  container
    .bind<ChatAccessRepository>(CHAT_ACCESS_REPOSITORY_ID)
    .to(SQLiteChatAccessRepository)
    .inSingletonScope();
  container
    .bind<ChatConfigRepository>(CHAT_CONFIG_REPOSITORY_ID)
    .to(SQLiteChatConfigRepository)
    .inSingletonScope();
  container
    .bind<PersonalityStateRepository>(PERSONALITY_STATE_REPOSITORY_ID)
    .to(SQLitePersonalityStateRepository)
    .inSingletonScope();
  container
    .bind<PoliticalStateRepository>(POLITICAL_STATE_REPOSITORY_ID)
    .to(SQLitePoliticalStateRepository)
    .inSingletonScope();
  container
    .bind<UserSocialProfileRepository>(USER_SOCIAL_PROFILE_REPOSITORY_ID)
    .to(SQLiteUserSocialProfileRepository)
    .inSingletonScope();
  container
    .bind<TruthRepository>(TRUTH_REPOSITORY_ID)
    .to(SQLiteTruthRepository)
    .inSingletonScope();
  container
    .bind<BehaviorEventRepository>(BEHAVIOR_EVENT_REPOSITORY_ID)
    .to(SQLiteBehaviorEventRepository)
    .inSingletonScope();
  container
    .bind<AiErrorEventRepository>(AI_ERROR_EVENT_REPOSITORY_ID)
    .to(SQLiteAiErrorEventRepository)
    .inSingletonScope();
  container
    .bind<PersonalitySignalRepository>(PERSONALITY_SIGNAL_REPOSITORY_ID)
    .to(SQLitePersonalitySignalRepository)
    .inSingletonScope();
  container
    .bind<StateEvolutionCursorRepository>(STATE_EVOLUTION_CURSOR_REPOSITORY_ID)
    .to(SQLiteStateEvolutionCursorRepository)
    .inSingletonScope();
  container
    .bind<UserPoliticalProfileRepository>(USER_POLITICAL_PROFILE_REPOSITORY_ID)
    .to(SQLiteUserPoliticalProfileRepository)
    .inSingletonScope();
  container
    .bind<VoiceTranscriptionJobRepository>(
      VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID
    )
    .to(SQLiteVoiceTranscriptionJobRepository)
    .inSingletonScope();
};
