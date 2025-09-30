import type { Context } from 'telegraf';
import type {
  BotCommand,
  BotCommandScope,
} from 'telegraf/typings/core/types/typegram';

import type { StateStore, TokenStore } from './stores';

// Enhanced Telegraf context types
export type ContextWithCallbackQuery = Context & {
  callbackQuery?: {
    data?: string;
    message?: {
      message_id?: number;
    };
  };
};

export type ContextWithMessage = Context & {
  message?: {
    text?: string;
  };
};

export type ContextWithMatch = Context & {
  match?: string[];
};

export type RenderMode = 'edit' | 'replace' | 'append' | 'smart';

export type Button<A = unknown> = {
  text: string;
  callback: string;
  action?: (args: {
    ctx: Context;
    actions: A;
    navigate: NavigateFn<A>;
    navigateBack: () => Promise<void>;
  }) => Promise<void> | void;
  answer?: {
    text?: string;
    alert?: boolean;
    url?: string;
    cacheTimeSec?: number;
  };
};

export type RouteView<A = unknown> = {
  text: string;
  buttons?: Array<Button<A> | Button<A>[]>;
  disablePreview?: boolean;
  renderMode?: RenderMode;
  showBack?: boolean;
  showCancel?: boolean;
  onText?: (
    args: RouteActionArgs<A, never> & { text: string }
  ) => Promise<RouteView<A> | void> | RouteView<A> | void;
};

export type NavigateFn<A = unknown> = <NP = void>(
  route: Route<A, NP>,
  ...p: NP extends void ? [] : [params: NP]
) => Promise<void>;

type RouteActionArgs<A = unknown, P = void> = {
  ctx: Context;
  actions: A;
  params: P;
  navigate: NavigateFn<A>;
  navigateBack: () => Promise<void>;
  state: RouterState;
};

export type Route<A = unknown, P = void> = {
  id: string;
  actionName?: string;
  actionDescription?: string;
  action: (
    args: RouteActionArgs<A, P>
  ) => Promise<void | RouteView<A>> | void | RouteView<A>;
};

export type RouteNode<A = unknown> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route: Route<A, any>;
  hasBack?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: Array<RouteNode<A> | Route<A, any>>;
};

export type RouterState = {
  stack: string[];
  params: Record<string, unknown>;
  awaitingTextRouteId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentOnTextHandler?: (args: any) => any;
  messages: Array<{
    messageId: number;
    text: string;
    buttons: Button<unknown>[][];
    showBack: boolean;
    showCancel: boolean;
  }>;
};

export type StartOptions = {
  inputPrompt?: string;
  backLabel?: string;
  backCallbackData?: string;
  renderMode?: RenderMode;
  onEditFail?: 'reply' | 'replace' | 'ignore';
  errorRenderMode?: RenderMode;
  errorPrefix?: string;
  errorDefaultText?: string;
  cancelLabel?: string;
  cancelCallbackData?: string;
  cancelCommands?: string[];
  showCancelOnWait?: boolean;
  cbVersion?: string;
  onError?: (err: unknown, ctx: Context, state: RouterState) => void;
  stateStore?: StateStore;
  tokenStore?: TokenStore;
  maxMessages?: number;
  commands?: BotCommand[];
  commandsExtra?: { scope?: BotCommandScope; language_code?: string };
};

export type ConnectHandler = (ctx: Context) => Promise<void> | void;

export type Branch<A = unknown> = {
  command: string;
  description: string;
  startRoute: Route<A, unknown>;
};

export interface RunningRouter<A = unknown> {
  onText(fn: (ctx: Context) => Promise<void> | void): () => void;
  onConnect(fn: ConnectHandler): () => void;
  navigate<P = void>(
    ctx: Context,
    route: Route<A, P>,
    ...p: P extends void ? [] : [params: P]
  ): Promise<void>;
  navigateBack(ctx: Context): Promise<void>;
}
