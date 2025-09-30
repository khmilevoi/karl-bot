import type { Context } from 'telegraf';

import type { TokenStore } from './stores';
import type { Branch, Button, Route, RouterState, RouteView } from './types';

export function getMatch(ctx: Context): readonly string[] | undefined {
  return (ctx as Context & { match?: string[] }).match;
}

export function cb(
  routeId: string,
  args: Array<string | number> = [],
  cbVersion = 'v1'
): string {
  const tail = args.length ? `:${args.join(':')}` : '';
  return `${routeId}!${cbVersion}${tail}`;
}

export function parseCb(data: string): {
  routeId: string;
  cbVersion?: string;
  args: string[];
  isToken: boolean;
  token?: string;
} {
  // Validate input
  if (!data || typeof data !== 'string') {
    return {
      routeId: '',
      cbVersion: undefined,
      args: [],
      isToken: false,
      token: undefined,
    };
  }

  const [head, ...rest] = data.split(':');
  if (!head) {
    return {
      routeId: '',
      cbVersion: undefined,
      args: rest,
      isToken: false,
      token: undefined,
    };
  }

  const [routeId, version] = head.split('!');
  if (!version)
    return { routeId: head, cbVersion: undefined, args: rest, isToken: false };
  if (rest[0] === 't')
    return {
      routeId,
      cbVersion: version,
      args: rest.slice(1),
      isToken: true,
      token: rest[1],
    };
  return { routeId, cbVersion: version, args: rest, isToken: false };
}

export async function cbTok(
  routeId: string,
  tokenStore: TokenStore,
  payload: unknown,
  ttlMs = 10 * 60_000,
  cbVersion = 'v1'
): Promise<string> {
  const token = await tokenStore.save(payload, ttlMs);
  return `${routeId}!${cbVersion}:t:${token}`;
}

type NavigateFn<A = unknown> = <NP = void>(
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

type ButtonActionArgs<A = unknown> = {
  ctx: Context;
  actions: A;
  navigate: NavigateFn<A>;
  navigateBack: () => Promise<void>;
};

export function route<A = unknown, P = void>(
  id: string,
  action: (
    args: RouteActionArgs<A, P>
  ) => Promise<void | RouteView<A>> | void | RouteView<A>,
  options?: {
    actionName?: string;
    actionDescription?: string;
  }
): Route<A, P> {
  return {
    id,
    actionName: options?.actionName,
    actionDescription: options?.actionDescription,
    action,
  };
}

export function button<A = unknown>(config: {
  text: string;
  callback: string;
  action?: (args: ButtonActionArgs<A>) => Promise<void> | void;
  answer?: {
    text?: string;
    alert?: boolean;
    url?: string;
    cacheTimeSec?: number;
  };
}): Button<A> {
  return {
    text: config.text,
    callback: config.callback,
    action: config.action,
    answer: config.answer,
  };
}

export function branch<A = unknown>(
  command: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startRoute: Route<A, any>
): Branch<A> {
  return {
    command,
    description,
    startRoute,
  };
}

export const DSL = {
  row<A = unknown>(...btns: Button<A>[]): Button<A>[] {
    return btns;
  },
  rows<A = unknown>(
    ...lines: Array<Button<A> | Button<A>[]>
  ): Array<Button<A> | Button<A>[]> {
    return lines;
  },
  route,
  button,
  branch,
};
