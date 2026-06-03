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
  AI_ERROR_LOGGER_ID,
  type AiErrorLogger,
} from '../application/behavior/AiErrorLogger';
import {
  BEHAVIOR_AI_SERVICE_ID,
  type BehaviorAiService,
} from '../application/behavior/BehaviorAiService';
import {
  BEHAVIOR_DECISION_VALIDATOR_CONFIG_ID,
  BEHAVIOR_PIPELINE_CONFIG_ID,
  BEHAVIOR_RATE_LIMITER_CONFIG_ID,
  BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG_ID,
  DEFAULT_BEHAVIOR_DECISION_VALIDATOR_CONFIG,
  DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
  DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG,
  DEFAULT_BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG,
  DEFAULT_PATCH_POLICY_CONFIG,
  DEFAULT_STATE_EVOLUTION_CONFIG,
  PATCH_POLICY_CONFIG_ID,
  STATE_EVOLUTION_CONFIG_ID,
  type BehaviorRateLimiterConfig,
  type BehaviorPipelineConfig,
  type BehaviorSummarizationQueueConfig,
  type StateEvolutionConfig,
} from '../application/behavior/BehaviorConfig';
import {
  BEHAVIOR_DECISION_VALIDATOR_ID,
  type BehaviorDecisionValidator,
  type BehaviorDecisionValidatorConfig,
} from '../application/behavior/BehaviorDecisionValidator';
import {
  BEHAVIOR_EXECUTOR_ID,
  type BehaviorExecutor,
} from '../application/behavior/BehaviorExecutor';
import {
  BEHAVIOR_CONTEXT_ASSEMBLER_ID,
  type BehaviorContextAssembler,
} from '../application/behavior/BehaviorContextAssembler';
import {
  BEHAVIOR_EVENT_LOGGER_ID,
  type BehaviorEventLogger,
} from '../application/behavior/BehaviorEventLogger';
import {
  BEHAVIOR_PIPELINE_ID,
  type BehaviorPipeline,
} from '../application/behavior/BehaviorPipeline';
import { DefaultAiErrorLogger } from '../application/behavior/DefaultAiErrorLogger';
import { DefaultBehaviorContextAssembler } from '../application/behavior/DefaultBehaviorContextAssembler';
import { DefaultBehaviorDecisionValidator } from '../application/behavior/DefaultBehaviorDecisionValidator';
import { DefaultBehaviorEventLogger } from '../application/behavior/DefaultBehaviorEventLogger';
import { DefaultBehaviorExecutor } from '../application/behavior/DefaultBehaviorExecutor';
import { DefaultBehaviorPipeline } from '../application/behavior/DefaultBehaviorPipeline';
import { DefaultBehaviorRateLimiter } from '../application/behavior/DefaultBehaviorRateLimiter';
import { DefaultBehaviorSummarizationQueue } from '../application/behavior/DefaultBehaviorSummarizationQueue';
import { DefaultPatchPolicy } from '../application/behavior/DefaultPatchPolicy';
import { DefaultStateEvolutionContextAssembler } from '../application/behavior/DefaultStateEvolutionContextAssembler';
import { DefaultStateEvolutionPass } from '../application/behavior/DefaultStateEvolutionPass';
import { DefaultStateEvolutionScheduler } from '../application/behavior/DefaultStateEvolutionScheduler';
import { DefaultStateEvolutionTrigger } from '../application/behavior/DefaultStateEvolutionTrigger';
import { DefaultStateEvolutionWorker } from '../application/behavior/DefaultStateEvolutionWorker';
import { DefaultStatePatchApplicator } from '../application/behavior/DefaultStatePatchApplicator';
import {
  STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID,
  type StateEvolutionContextAssembler,
} from '../application/behavior/StateEvolutionContextAssembler';
import {
  STATE_EVOLUTION_PASS_ID,
  type StateEvolutionPass,
} from '../application/behavior/StateEvolutionPass';
import {
  STATE_EVOLUTION_SCHEDULER_ID,
  type StateEvolutionScheduler,
} from '../application/behavior/StateEvolutionScheduler';
import {
  STATE_EVOLUTION_TRIGGER_ID,
  type StateEvolutionTrigger,
} from '../application/behavior/StateEvolutionTrigger';
import {
  STATE_EVOLUTION_WORKER_ID,
  type StateEvolutionWorker,
} from '../application/behavior/StateEvolutionWorker';
import {
  BEHAVIOR_RATE_LIMITER_ID,
  type BehaviorRateLimiter,
} from '../application/behavior/BehaviorRateLimiter';
import {
  BEHAVIOR_SUMMARIZATION_QUEUE_ID,
  type BehaviorSummarizationQueue,
} from '../application/behavior/BehaviorSummarizationQueue';
import {
  PATCH_POLICY_ID,
  type PatchPolicy,
  type PatchPolicyConfig,
} from '../application/behavior/PatchPolicy';
import {
  DEFAULT_STATE_PATCH_APPLICATOR_CONFIG,
  STATE_PATCH_APPLICATOR_CONFIG_ID,
  STATE_PATCH_APPLICATOR_ID,
  type StatePatchApplicator,
  type StatePatchApplicatorConfig,
} from '../application/behavior/StatePatchApplicator';
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
  CHAT_MESSENGER_ID,
  type ChatMessenger,
} from '../application/interfaces/chat/ChatMessenger';
import {
  CHAT_RESET_SERVICE_ID,
  type ChatResetService,
} from '../application/interfaces/chat/ChatResetService';
import {
  CHAT_USER_SERVICE_ID,
  type ChatUserService,
} from '../application/interfaces/chat/ChatUserService';
import {
  DIALOGUE_MANAGER_ID,
  type DialogueManager,
} from '../application/interfaces/chat/DialogueManager';
import {
  TRIGGER_PIPELINE_ID,
  type TriggerPipeline,
} from '../application/interfaces/chat/TriggerPipeline';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '../application/interfaces/env/EnvService';
import {
  VOICE_CONFIG_ID,
  type VoiceConfig,
} from '../application/voice/VoiceConfig';
import {
  VOICE_MESSAGE_SERVICE_ID,
  type VoiceMessageService,
} from '../application/interfaces/voice/VoiceMessageService';
import { DefaultVoiceMessageService } from '../application/use-cases/voice/DefaultVoiceMessageService';
import {
  VOICE_MESSAGE_WORKER_ID,
  type VoiceMessageWorker,
} from '../application/interfaces/voice/VoiceMessageWorker';
import { DefaultVoiceMessageWorker } from '../application/use-cases/voice/DefaultVoiceMessageWorker';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '../application/interfaces/logging/LoggerFactory';
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
  MANUAL_JOB_RUNNER_ID,
  type ManualJobRunner,
} from '../application/interfaces/scheduler/ManualJobRunner';
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
import { DefaultChatApprovalService } from '../application/use-cases/chat/DefaultChatApprovalService';
import { DefaultChatResetService } from '../application/use-cases/chat/DefaultChatResetService';
import { DefaultDialogueManager } from '../application/use-cases/chat/DefaultDialogueManager';
import { DefaultTriggerPipeline } from '../application/use-cases/chat/DefaultTriggerPipeline';
import { RepositoryChatConfigService } from '../application/use-cases/chat/RepositoryChatConfigService';
import { RepositoryChatInfoService } from '../application/use-cases/chat/RepositoryChatInfoService';
import { RepositoryChatUserService } from '../application/use-cases/chat/RepositoryChatUserService';
import { DefaultMessageContextExtractor } from '../application/use-cases/messages/DefaultMessageContextExtractor';
import { RepositoryMessageService } from '../application/use-cases/messages/RepositoryMessageService';
import { DefaultManualJobRunner } from '../application/use-cases/scheduler/DefaultManualJobRunner';
import { TopicOfDaySchedulerImpl } from '../application/use-cases/scheduler/TopicOfDayScheduler';
import { RepositorySummaryService } from '../application/use-cases/summaries/RepositorySummaryService';
import { DefaultEnvService } from '../infrastructure/config/DefaultEnvService';
import { TestEnvService } from '../infrastructure/config/TestEnvService';
import { ChatGPTService } from '../infrastructure/external/ChatGPTService';
import { OpenAIEmbeddingService } from '../infrastructure/external/OpenAIEmbeddingService';
import {
  EMBEDDING_SERVICE_ID,
  type EmbeddingService,
} from '../application/interfaces/ai/EmbeddingService';
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

  const envService = container.get<EnvService>(ENV_SERVICE_ID);
  container
    .bind<VoiceConfig>(VOICE_CONFIG_ID)
    .toConstantValue(envService.getVoiceConfig());

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
    .bind<BehaviorPipelineConfig>(BEHAVIOR_PIPELINE_CONFIG_ID)
    .toConstantValue(DEFAULT_BEHAVIOR_PIPELINE_CONFIG);

  container
    .bind<BehaviorDecisionValidatorConfig>(
      BEHAVIOR_DECISION_VALIDATOR_CONFIG_ID
    )
    .toConstantValue(DEFAULT_BEHAVIOR_DECISION_VALIDATOR_CONFIG);

  container
    .bind<PatchPolicyConfig>(PATCH_POLICY_CONFIG_ID)
    .toConstantValue(DEFAULT_PATCH_POLICY_CONFIG);

  container
    .bind<BehaviorRateLimiterConfig>(BEHAVIOR_RATE_LIMITER_CONFIG_ID)
    .toConstantValue(DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG);

  container
    .bind<BehaviorSummarizationQueueConfig>(
      BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG_ID
    )
    .toConstantValue(DEFAULT_BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG);

  container
    .bind<StatePatchApplicatorConfig>(STATE_PATCH_APPLICATOR_CONFIG_ID)
    .toConstantValue(DEFAULT_STATE_PATCH_APPLICATOR_CONFIG);

  container
    .bind<StateEvolutionConfig>(STATE_EVOLUTION_CONFIG_ID)
    .toConstantValue(DEFAULT_STATE_EVOLUTION_CONFIG);

  container
    .bind<AIService>(AI_SERVICE_ID)
    .to(ChatGPTService)
    .inSingletonScope();

  container
    .bind<BehaviorAiService>(BEHAVIOR_AI_SERVICE_ID)
    .to(ChatGPTService)
    .inSingletonScope();

  container
    .bind<EmbeddingService>(EMBEDDING_SERVICE_ID)
    .to(OpenAIEmbeddingService)
    .inSingletonScope();

  container
    .bind<BehaviorContextAssembler>(BEHAVIOR_CONTEXT_ASSEMBLER_ID)
    .to(DefaultBehaviorContextAssembler)
    .inSingletonScope();

  container
    .bind<BehaviorDecisionValidator>(BEHAVIOR_DECISION_VALIDATOR_ID)
    .to(DefaultBehaviorDecisionValidator)
    .inSingletonScope();

  container
    .bind<PatchPolicy>(PATCH_POLICY_ID)
    .to(DefaultPatchPolicy)
    .inSingletonScope();

  container
    .bind<BehaviorRateLimiter>(BEHAVIOR_RATE_LIMITER_ID)
    .to(DefaultBehaviorRateLimiter)
    .inSingletonScope();

  container
    .bind<BehaviorSummarizationQueue>(BEHAVIOR_SUMMARIZATION_QUEUE_ID)
    .to(DefaultBehaviorSummarizationQueue)
    .inSingletonScope();

  container
    .bind<BehaviorExecutor>(BEHAVIOR_EXECUTOR_ID)
    .to(DefaultBehaviorExecutor)
    .inSingletonScope();

  container
    .bind<StatePatchApplicator>(STATE_PATCH_APPLICATOR_ID)
    .to(DefaultStatePatchApplicator)
    .inSingletonScope();

  container
    .bind<BehaviorEventLogger>(BEHAVIOR_EVENT_LOGGER_ID)
    .to(DefaultBehaviorEventLogger)
    .inSingletonScope();

  container
    .bind<AiErrorLogger>(AI_ERROR_LOGGER_ID)
    .to(DefaultAiErrorLogger)
    .inSingletonScope();

  container
    .bind<BehaviorPipeline>(BEHAVIOR_PIPELINE_ID)
    .to(DefaultBehaviorPipeline)
    .inSingletonScope();

  container
    .bind<StateEvolutionContextAssembler>(STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID)
    .to(DefaultStateEvolutionContextAssembler)
    .inSingletonScope();

  container
    .bind<StateEvolutionPass>(STATE_EVOLUTION_PASS_ID)
    .to(DefaultStateEvolutionPass)
    .inSingletonScope();

  container
    .bind<StateEvolutionWorker>(STATE_EVOLUTION_WORKER_ID)
    .to(DefaultStateEvolutionWorker)
    .inSingletonScope();

  container
    .bind<StateEvolutionTrigger>(STATE_EVOLUTION_TRIGGER_ID)
    .to(DefaultStateEvolutionTrigger)
    .inSingletonScope();

  container
    .bind<StateEvolutionScheduler>(STATE_EVOLUTION_SCHEDULER_ID)
    .to(DefaultStateEvolutionScheduler)
    .inSingletonScope();

  container
    .bind<MessageService>(MESSAGE_SERVICE_ID)
    .to(RepositoryMessageService)
    .inSingletonScope();

  container
    .bind<SummaryService>(SUMMARY_SERVICE_ID)
    .to(RepositorySummaryService)
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
    .bind<AdminService>(ADMIN_SERVICE_ID)
    .to(AdminServiceImpl)
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
    .bind<ChatMessenger>(CHAT_MESSENGER_ID)
    .to(TelegramMessenger)
    .inSingletonScope();

  container
    .bind<TopicOfDayScheduler>(TOPIC_OF_DAY_SCHEDULER_ID)
    .to(TopicOfDaySchedulerImpl)
    .inSingletonScope();

  container
    .bind<ManualJobRunner>(MANUAL_JOB_RUNNER_ID)
    .to(DefaultManualJobRunner)
    .inSingletonScope();

  container
    .bind<VoiceMessageService>(VOICE_MESSAGE_SERVICE_ID)
    .to(DefaultVoiceMessageService)
    .inSingletonScope();

  container
    .bind<VoiceMessageWorker>(VOICE_MESSAGE_WORKER_ID)
    .to(DefaultVoiceMessageWorker)
    .inSingletonScope();
};
