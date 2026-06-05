import { inject, injectable, type ServiceIdentifier } from 'inversify';

import {
  PROMPT_TEMPLATE_SERVICE_ID,
  type PromptTemplateService,
} from '@/application/interfaces/prompts/PromptTemplateService';
import type { ChatMessage } from '@/domain/messages/ChatMessage';

import type { MessageReferenceMap } from './MessageReferenceMap';
import type { PromptMessage } from './PromptMessage';
import { buildBehaviorBrief } from './BehaviorBrief';
import type {
  BehaviorMessageMarkers,
  BehaviorPromptMessage,
  BehaviorPromptState,
  PromptChatUser,
  SelfIdentity,
} from './PromptTypes';
import type {
  BotPersonalityState,
  BotPoliticalState,
  BotTruth,
  UserSocialProfile,
} from '@/domain/behavior/schemas/state';

@injectable()
export class PromptBuilder {
  private readonly steps: Array<() => Promise<PromptMessage[]>> = [];

  constructor(
    @inject(PROMPT_TEMPLATE_SERVICE_ID)
    private readonly templates: PromptTemplateService
  ) {}

  addAskSummary(summary?: string): this {
    if (!summary) {
      return this;
    }
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('askSummary');
      return [
        { role: 'system', content: template.replace('{{summary}}', summary) },
      ];
    });
    return this;
  }

  addSummarizationSystem(): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('summarizationSystem');
      return [{ role: 'system', content: template }];
    });
    return this;
  }

  addPreviousSummary(summary?: string): this {
    if (!summary) {
      return this;
    }
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('previousSummary');
      return [
        { role: 'system', content: template.replace('{{prev}}', summary) },
      ];
    });
    return this;
  }

  addUserPrompt(params: {
    messageId?: string;
    userName?: string;
    fullName?: string;
    replyMessage?: string;
    quoteMessage?: string;
    userMessage: string;
    role?: 'user' | 'assistant';
  }): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('userPrompt');
      const content = template
        .replace('{{messageId}}', params.messageId ?? 'N/A')
        .replace('{{userName}}', params.userName ?? 'N/A')
        .replace('{{fullName}}', params.fullName ?? 'N/A')
        .replace('{{replyMessage}}', params.replyMessage ?? 'N/A')
        .replace('{{quoteMessage}}', params.quoteMessage ?? 'N/A')
        .replace('{{userMessage}}', params.userMessage);
      return [{ role: params.role ?? 'user', content }];
    });
    return this;
  }

  addUserPromptSystem(): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('userPromptSystem');
      return [{ role: 'system', content: template }];
    });
    return this;
  }

  addChatUsers(users: PromptChatUser[]): this {
    if (users.length === 0) {
      return this;
    }

    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('chatUser');
      const formatted = users
        .map((u) =>
          template
            .replace('{{userName}}', u.username)
            .replace('{{fullName}}', u.fullName)
        )
        .join('\n\n');
      return [
        { role: 'system', content: `Все пользователи чата:\n${formatted}` },
      ];
    });
    return this;
  }

  addPriorityRulesSystem(): this {
    this.steps.push(async () => {
      const restrictions = await this.templates.loadTemplate(
        'priorityRulesSystem'
      );
      return [{ role: 'system', content: restrictions }];
    });
    return this;
  }

  addTopicOfDaySystem(params?: { chatTitle?: string }): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('topicOfDaySystem');
      const content = template.replace(
        '{{chatTitle}}',
        params?.chatTitle ?? 'этого чата'
      );
      return [{ role: 'system', content }];
    });
    return this;
  }

  addMessages(messages: ChatMessage[]): this {
    for (const msg of messages) {
      if (msg.role === 'user') {
        this.addUserPrompt({
          messageId: msg.messageId?.toString(),
          userName: msg.username,
          fullName:
            msg.fullName ??
            ([msg.firstName, msg.lastName].filter(Boolean).join(' ') ||
              undefined),
          replyMessage: msg.replyText,
          quoteMessage: msg.quoteText,
          userMessage: msg.content,
          role: 'user',
        });
      } else {
        this.addUserPrompt({
          userName: 'Ассистент',
          userMessage: msg.content,
          role: 'assistant',
        });
      }
    }
    return this;
  }

  addNeutralCore(): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('neutralCore');
      return [{ role: 'system', content: template }];
    });
    return this;
  }

  addBehaviorGateSystem(): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('behaviorGateSystem');
      return [{ role: 'system', content: template }];
    });
    return this;
  }

  addBehaviorDecisionSystem(): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate(
        'behaviorDecisionSystem'
      );
      return [{ role: 'system', content: template }];
    });
    return this;
  }

  addPersonalityState(state: BotPersonalityState): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('personalityState');
      return [
        {
          role: 'system',
          content: template.replace(
            '{{personalityStateJson}}',
            this.stringify(state)
          ),
        },
      ];
    });
    return this;
  }

  addPoliticalState(state: BotPoliticalState): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('politicalState');
      return [
        {
          role: 'system',
          content: template.replace(
            '{{politicalStateJson}}',
            this.stringify(state)
          ),
        },
      ];
    });
    return this;
  }

  addUserProfiles(profiles: UserSocialProfile[]): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('userProfiles');
      return [
        {
          role: 'system',
          content: template.replace(
            '{{userProfilesJson}}',
            this.stringify(profiles)
          ),
        },
      ];
    });
    return this;
  }

  addTruths(truths: BotTruth[]): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('truths');
      return [
        {
          role: 'system',
          content: template.replace('{{truthsJson}}', this.stringify(truths)),
        },
      ];
    });
    return this;
  }

  addBehaviorBrief(
    state: BehaviorPromptState,
    messages: BehaviorPromptMessage[],
    selfIdentity?: SelfIdentity
  ): this {
    this.steps.push(async () => {
      const brief = buildBehaviorBrief({ state, messages, selfIdentity });
      return [{ role: 'system', content: brief }];
    });
    return this;
  }

  addStateEvolutionSystem(): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate(
        'stateEvolutionSystem'
      );
      return [{ role: 'system', content: template }];
    });
    return this;
  }

  addPersonalitySignals(
    signals: import('@/domain/behavior/schemas/state').PersonalitySignal[]
  ): this {
    if (signals.length === 0) {
      return this;
    }
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('personalitySignals');
      return [
        {
          role: 'system',
          content: template.replace(
            '{{personalitySignalsJson}}',
            this.stringify(signals)
          ),
        },
      ];
    });
    return this;
  }

  addUserPoliticalProfiles(
    profiles: import('@/domain/behavior/schemas/state').UserPoliticalProfile[]
  ): this {
    if (profiles.length === 0) {
      return this;
    }
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate(
        'userPoliticalProfiles'
      );
      return [
        {
          role: 'system',
          content: template.replace(
            '{{userPoliticalProfilesJson}}',
            this.stringify(profiles)
          ),
        },
      ];
    });
    return this;
  }

  addBehaviorMessages(
    messages: BehaviorPromptMessage[],
    refMap: MessageReferenceMap,
    markers?: BehaviorMessageMarkers
  ): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('behaviorMessages');
      const triggerSet = new Set(markers?.triggerMessageIds ?? []);
      const contextSet = new Set(markers?.contextMessageIds ?? []);
      const batchSet = new Set(markers?.batchMessageIds ?? []);
      const lines = messages.map((m) => {
        const markerParts = [];
        if (triggerSet.has(m.id)) {
          markerParts.push('[TRIGGER]');
        }
        if (contextSet.has(m.id)) {
          markerParts.push('[GATE_CONTEXT]');
        }
        if (batchSet.has(m.id)) {
          markerParts.push('[BATCH]');
        }
        const marker =
          markerParts.length > 0 ? ` ${markerParts.join(' ')}` : '';
        const fullName =
          m.fullName ??
          ([m.firstName, m.lastName].filter(Boolean).join(' ') || 'N/A');
        const ordinal = refMap.ordinalFor(m.id) ?? 0;
        const source = m.sourceType ?? 'text';
        const header = `[#${ordinal}] [userId:${m.userId ?? 0}] [username:${m.username ?? 'N/A'}] [fullName:${fullName}] [role:${m.role}] [source:${source}]${marker}`;
        const replyLine =
          m.replyText != null && m.replyText.length > 0
            ? `\n↳ ответ @${m.replyUsername ?? 'N/A'}: "${this.truncate(m.replyText)}"`
            : '';
        const quoteLine =
          m.quoteText != null && m.quoteText.length > 0
            ? `\n❝ цитата: "${this.truncate(m.quoteText)}"`
            : '';
        return `${header}${replyLine}${quoteLine}\n${m.content}`;
      });
      return [
        {
          role: 'user',
          content: template.replace('{{behaviorMessages}}', lines.join('\n\n')),
        },
      ];
    });
    return this;
  }

  private truncate(text: string, max = 200): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  private stringify(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  async build(): Promise<PromptMessage[]> {
    const steps = [...this.steps];
    const parts = await Promise.all(steps.map((step) => step()));
    this.steps.length = 0;
    return parts.flat();
  }
}

export type PromptBuilderFactory = () => PromptBuilder;

export const PROMPT_BUILDER_FACTORY_ID = Symbol.for(
  'PromptBuilderFactory'
) as ServiceIdentifier<PromptBuilderFactory>;
