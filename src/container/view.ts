import type { Context } from 'grammy';
import { type Container } from 'inversify';

import { type Trigger, TRIGGER_ID } from '../domain/triggers/Trigger';
import { MainService } from '../view/telegram/MainService';
import { MentionTrigger } from '../view/telegram/triggers/MentionTrigger';
import { NameTrigger } from '../view/telegram/triggers/NameTrigger';
import { ReplyTrigger } from '../view/telegram/triggers/ReplyTrigger';

export const register = (container: Container): void => {
  container
    .bind<Trigger<Context>>(TRIGGER_ID)
    .to(MentionTrigger)
    .inSingletonScope();
  container
    .bind<Trigger<Context>>(TRIGGER_ID)
    .to(ReplyTrigger)
    .inSingletonScope();
  container
    .bind<Trigger<Context>>(TRIGGER_ID)
    .to(NameTrigger)
    .inSingletonScope();

  container.bind(MainService).toSelf().inSingletonScope();
};
