import type {
  BehaviorEventEntity,
  NewBehaviorEvent,
} from '@/domain/entities/BehaviorEventEntity';

export interface BehaviorEventRepository {
  insert(event: NewBehaviorEvent): Promise<number>;
  findById(id: number): Promise<BehaviorEventEntity | undefined>;
  findByChatId(chatId: number): Promise<BehaviorEventEntity[]>;
  findByChatIdAfter(
    chatId: number,
    afterId: number
  ): Promise<BehaviorEventEntity[]>;
  countByChatIdAfter(chatId: number, afterId: number): Promise<number>;
}

export const BEHAVIOR_EVENT_REPOSITORY_ID = Symbol('BehaviorEventRepository');
