import type { Container } from 'inversify';

import {
  ADMIN_SERVICE_ID,
  type AdminService,
} from '../application/interfaces/admin/AdminService';
import {
  AI_SERVICE_ID,
  type AIService,
} from '../application/interfaces/ai/AIService';
import {
  CHAT_APPROVAL_SERVICE_ID,
  type ChatApprovalService,
} from '../application/interfaces/chat/ChatApprovalService';
import {
  CHAT_CONFIG_SERVICE_ID,
  type ChatConfigService,
} from '../application/interfaces/chat/ChatConfigService';
import {
  CHAT_INFO_SERVICE_ID,
  type ChatInfoService,
} from '../application/interfaces/chat/ChatInfoService';
import {
  CHAT_MEMORY_MANAGER_ID,
  type ChatMemoryManager as ChatMemoryManagerInterface,
} from '../application/interfaces/chat/ChatMemoryManager';
import {
  CHAT_MESSENGER_ID,
  type ChatMessenger,
} from '../application/interfaces/chat/ChatMessenger';
import {
  CHAT_RESET_SERVICE_ID,
  type ChatResetService,
} from '../application/interfaces/chat/ChatResetService';
import {
  CHAT_RESPONDER_ID,
  type ChatResponder,
} from '../application/interfaces/chat/ChatResponder';
import {
  CHAT_USER_SERVICE_ID,
  type ChatUserService,
} from '../application/interfaces/chat/ChatUserService';
import {
  DIALOGUE_MANAGER_ID,
  type DialogueManager,
} from '../application/interfaces/chat/DialogueManager';
import {
  HISTORY_SUMMARIZER_ID,
  type HistorySummarizer,
} from '../application/interfaces/chat/HistorySummarizer';
import {
  TRIGGER_PIPELINE_ID,
  type TriggerPipeline,
} from '../application/interfaces/chat/TriggerPipeline';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '../application/interfaces/env/EnvService';
import {
  INTEREST_CHECKER_ID,
  type InterestChecker,
} from '../application/interfaces/interest/InterestChecker';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '../application/interfaces/logging/LoggerFactory';
import {
  INTEREST_MESSAGE_STORE_ID,
  type InterestMessageStore,
} from '../application/interfaces/messages/InterestMessageStore';
import {
  MESSAGE_CONTEXT_EXTRACTOR_ID,
  type MessageContextExtractor,
} from '../application/interfaces/messages/MessageContextExtractor';
import {
  MESSAGE_SERVICE_ID,
  type MessageService,
} from '../application/interfaces/messages/MessageService';
import {
  PROMPT_TEMPLATE_SERVICE_ID,
  type PromptTemplateService,
} from '../application/interfaces/prompts/PromptTemplateService';
import {
  TOPIC_OF_DAY_SCHEDULER_ID,
  type TopicOfDayScheduler,
} from '../application/interfaces/scheduler/TopicOfDayScheduler';
import {
  SUMMARY_SERVICE_ID,
  type SummaryService,
} from '../application/interfaces/summaries/SummaryService';
import {
  PROMPT_BUILDER_FACTORY_ID,
  PromptBuilder,
  type PromptBuilderFactory,
} from '../application/prompts/PromptBuilder';
import {
  PROMPT_DIRECTOR_ID,
  PromptDirector,
} from '../application/prompts/PromptDirector';
import { AdminServiceImpl } from '../application/use-cases/admin/AdminServiceImpl';
import { ChatMemoryManager as ChatMemoryManagerImpl } from '../application/use-cases/chat/ChatMemory';
import { DefaultChatApprovalService } from '../application/use-cases/chat/DefaultChatApprovalService';
import { DefaultChatResetService } from '../application/use-cases/chat/DefaultChatResetService';
import { DefaultChatResponder } from '../application/use-cases/chat/DefaultChatResponder';
import { DefaultDialogueManager } from '../application/use-cases/chat/DefaultDialogueManager';
import { DefaultHistorySummarizer } from '../application/use-cases/chat/DefaultHistorySummarizer';
import { DefaultTriggerPipeline } from '../application/use-cases/chat/DefaultTriggerPipeline';
import { RepositoryChatConfigService } from '../application/use-cases/chat/RepositoryChatConfigService';
import { RepositoryChatInfoService } from '../application/use-cases/chat/RepositoryChatInfoService';
import { RepositoryChatUserService } from '../application/use-cases/chat/RepositoryChatUserService';
import { DefaultInterestChecker } from '../application/use-cases/interest/DefaultInterestChecker';
import { DefaultMessageContextExtractor } from '../application/use-cases/messages/DefaultMessageContextExtractor';
import { InMemoryInterestMessageStore } from '../application/use-cases/messages/InMemoryInterestMessageStore';
import { RepositoryMessageService } from '../application/use-cases/messages/RepositoryMessageService';
import { TopicOfDaySchedulerImpl } from '../application/use-cases/scheduler/TopicOfDayScheduler';
import { RepositorySummaryService } from '../application/use-cases/summaries/RepositorySummaryService';
import { DefaultEnvService } from '../infrastructure/config/DefaultEnvService';
import { TestEnvService } from '../infrastructure/config/TestEnvService';
import { ChatGPTService } from '../infrastructure/external/ChatGPTService';
import { FilePromptTemplateService } from '../infrastructure/external/FilePromptTemplateService';
import { PinoLoggerFactory } from '../infrastructure/logging/PinoLoggerFactory';
import { TelegramMessenger } from '../view/telegram/TelegramMessenger';

export const register = (container: Container): void => {
  const EnvServiceImpl =
    process.env.NODE_ENV === 'test' ? TestEnvService : DefaultEnvService;

  container
    .bind<EnvService>(ENV_SERVICE_ID)
    .to(EnvServiceImpl)
    .inSingletonScope();

  container
    .bind<LoggerFactory>(LOGGER_FACTORY_ID)
    .to(PinoLoggerFactory)
    .inSingletonScope();

  container
    .bind<PromptTemplateService>(PROMPT_TEMPLATE_SERVICE_ID)
    .to(FilePromptTemplateService)
    .inSingletonScope();

  container.bind(PromptBuilder).toSelf().inTransientScope();

  container
    .bind<PromptBuilderFactory>(PROMPT_BUILDER_FACTORY_ID)
    .toFactory((): PromptBuilderFactory => () => container.get(PromptBuilder));

  container
    .bind<PromptDirector>(PROMPT_DIRECTOR_ID)
    .to(PromptDirector)
    .inSingletonScope();

  container
    .bind<AIService>(AI_SERVICE_ID)
    .to(ChatGPTService)
    .inSingletonScope();

  container
    .bind<MessageService>(MESSAGE_SERVICE_ID)
    .to(RepositoryMessageService)
    .inSingletonScope();

  container
    .bind<InterestMessageStore>(INTEREST_MESSAGE_STORE_ID)
    .to(InMemoryInterestMessageStore)
    .inSingletonScope();

  container
    .bind<SummaryService>(SUMMARY_SERVICE_ID)
    .to(RepositorySummaryService)
    .inSingletonScope();

  container
    .bind<HistorySummarizer>(HISTORY_SUMMARIZER_ID)
    .to(DefaultHistorySummarizer)
    .inSingletonScope();

  container
    .bind<ChatResetService>(CHAT_RESET_SERVICE_ID)
    .to(DefaultChatResetService)
    .inSingletonScope();

  container
    .bind<ChatApprovalService>(CHAT_APPROVAL_SERVICE_ID)
    .to(DefaultChatApprovalService)
    .inSingletonScope();

  container
    .bind<ChatConfigService>(CHAT_CONFIG_SERVICE_ID)
    .to(RepositoryChatConfigService)
    .inSingletonScope();

  container
    .bind<ChatInfoService>(CHAT_INFO_SERVICE_ID)
    .to(RepositoryChatInfoService)
    .inSingletonScope();

  container
    .bind<ChatUserService>(CHAT_USER_SERVICE_ID)
    .to(RepositoryChatUserService)
    .inSingletonScope();

  container
    .bind<InterestChecker>(INTEREST_CHECKER_ID)
    .to(DefaultInterestChecker)
    .inSingletonScope();

  container
    .bind<AdminService>(ADMIN_SERVICE_ID)
    .to(AdminServiceImpl)
    .inSingletonScope();

  container
    .bind<ChatMemoryManagerInterface>(CHAT_MEMORY_MANAGER_ID)
    .to(ChatMemoryManagerImpl)
    .inSingletonScope();

  container
    .bind<DialogueManager>(DIALOGUE_MANAGER_ID)
    .to(DefaultDialogueManager)
    .inSingletonScope();

  container
    .bind<MessageContextExtractor>(MESSAGE_CONTEXT_EXTRACTOR_ID)
    .to(DefaultMessageContextExtractor)
    .inSingletonScope();

  container
    .bind<TriggerPipeline>(TRIGGER_PIPELINE_ID)
    .to(DefaultTriggerPipeline)
    .inSingletonScope();

  container
    .bind<ChatResponder>(CHAT_RESPONDER_ID)
    .to(DefaultChatResponder)
    .inSingletonScope();

  container
    .bind<ChatMessenger>(CHAT_MESSENGER_ID)
    .to(TelegramMessenger)
    .inSingletonScope();

  container
    .bind<TopicOfDayScheduler>(TOPIC_OF_DAY_SCHEDULER_ID)
    .to(TopicOfDaySchedulerImpl)
    .inSingletonScope();
};
