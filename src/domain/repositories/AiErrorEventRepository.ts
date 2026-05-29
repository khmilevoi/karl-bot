import type {
  AiErrorEventEntity,
  NewAiErrorEvent,
} from '@/domain/entities/AiErrorEventEntity';

export interface AiErrorEventRepository {
  insert(event: NewAiErrorEvent): Promise<number>;
  findById(id: number): Promise<AiErrorEventEntity | undefined>;
}

export const AI_ERROR_EVENT_REPOSITORY_ID = Symbol('AiErrorEventRepository');
