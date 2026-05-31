import { describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

import { TopicOfDaySchedulerImpl } from '../src/application/use-cases/scheduler/TopicOfDayScheduler';

describe('TopicOfDayScheduler', () => {
  it('schedules cron jobs and sends article', async () => {
    const chatConfig = {
      getTopicOfDaySchedules: vi.fn(
        async () => new Map([[1, { cron: '0 0 9 * * *', timezone: 'UTC' }]])
      ),
    };
    const ai = { generateTopicOfDay: vi.fn(async () => 'article') };
    const bot = { sendMessage: vi.fn(async () => {}) };
    const loggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    };
    const chatUsers = { listUsers: vi.fn(async () => []) };
    const chatInfo = { getChat: vi.fn(async () => ({ title: 'Chat' })) };
    const summaries = { getSummary: vi.fn(async () => '') };

    const scheduler = new TopicOfDaySchedulerImpl(
      chatConfig as any,
      ai as any,
      bot as any,
      chatUsers as any,
      chatInfo as any,
      summaries as any,
      loggerFactory as any
    );

    const scheduleMock = vi.mocked(cron.schedule);
    scheduleMock.mockImplementation((_expr, _cb, _opts) => {
      return {} as any;
    });

    await scheduler.start();
    expect(scheduleMock).toHaveBeenCalledWith(
      '0 0 9 * * *',
      expect.any(Function),
      { timezone: 'UTC' }
    );
    scheduleMock.mock.calls[0][1]();
    await (scheduler as any).execute(1);
    expect(ai.generateTopicOfDay).toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledWith(1, 'article');
  });

  it('normalizes UTC offset timezones for scheduling', async () => {
    const chatConfig = {
      getTopicOfDaySchedules: vi.fn(
        async () => new Map([[1, { cron: '0 0 9 * * *', timezone: 'UTC+02' }]])
      ),
    };
    const ai = { generateTopicOfDay: vi.fn(async () => 'article') };
    const bot = { sendMessage: vi.fn(async () => {}) };
    const loggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    };
    const chatUsers = { listUsers: vi.fn(async () => []) };
    const chatInfo = { getChat: vi.fn(async () => ({ title: 'Chat' })) };
    const summaries = { getSummary: vi.fn(async () => '') };

    const scheduler = new TopicOfDaySchedulerImpl(
      chatConfig as any,
      ai as any,
      bot as any,
      chatUsers as any,
      chatInfo as any,
      summaries as any,
      loggerFactory as any
    );

    const scheduleMock = vi.mocked(cron.schedule);
    scheduleMock.mockImplementation((_expr, _cb, _opts) => {
      return {} as any;
    });

    await scheduler.start();
    expect(scheduleMock).toHaveBeenCalledWith(
      '0 0 9 * * *',
      expect.any(Function),
      { timezone: 'Etc/GMT-2' }
    );
  });

  it('skips sending when topic is empty', async () => {
    const chatConfig = {
      getTopicOfDaySchedules: vi.fn(
        async () => new Map([[1, { cron: '0 0 9 * * *', timezone: 'UTC' }]])
      ),
    };
    const ai = { generateTopicOfDay: vi.fn(async () => '   ') };
    const bot = { sendMessage: vi.fn(async () => {}) };
    const loggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    };
    const chatUsers = { listUsers: vi.fn(async () => []) };
    const chatInfo = { getChat: vi.fn(async () => ({ title: 'Chat' })) };
    const summaries = { getSummary: vi.fn(async () => '') };

    const scheduler = new TopicOfDaySchedulerImpl(
      chatConfig as any,
      ai as any,
      bot as any,
      chatUsers as any,
      chatInfo as any,
      summaries as any,
      loggerFactory as any
    );

    await (scheduler as any).execute(1);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('reschedules job when topic time changes', async () => {
    const tasks: { stop: ReturnType<typeof vi.fn>; fire: () => void }[] = [];
    const scheduleMock = vi.mocked(cron.schedule);
    scheduleMock.mockReset();
    scheduleMock.mockImplementation((_expr, cb, _opts) => {
      let stopped = false;
      const task = {
        stop: vi.fn(() => {
          stopped = true;
        }),
        fire: () => {
          if (!stopped) cb();
        },
      } as any;
      tasks.push(task);
      return task;
    });

    const repoConfig = {
      chatId: 1,
      historyLimit: 50,
      topicTime: '09:00',
      topicTimezone: 'UTC',
    };
    const chatConfig = {
      getTopicOfDaySchedules: vi.fn(
        async () => new Map([[1, { cron: '0 0 9 * * *', timezone: 'UTC' }]])
      ),
      getConfig: vi.fn(async () => ({
        ...repoConfig,
        topicTime: '10:30',
      })),
    };
    const ai = { generateTopicOfDay: vi.fn(async () => 'article') };
    const bot = { sendMessage: vi.fn(async () => {}) };
    const loggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    };
    const chatUsers = { listUsers: vi.fn(async () => []) };
    const chatInfo = { getChat: vi.fn(async () => ({ title: 'Chat' })) };
    const summaries = { getSummary: vi.fn(async () => '') };

    const scheduler = new TopicOfDaySchedulerImpl(
      chatConfig as any,
      ai as any,
      bot as any,
      chatUsers as any,
      chatInfo as any,
      summaries as any,
      loggerFactory as any
    );

    await scheduler.start();
    expect(scheduleMock).toHaveBeenCalledTimes(1);

    await scheduler.reschedule(1);

    expect(tasks[0].stop).toHaveBeenCalled();
    expect(scheduleMock).toHaveBeenLastCalledWith(
      '0 30 10 * * *',
      expect.any(Function),
      { timezone: 'UTC' }
    );

    // old task should not run
    tasks[0].fire();
    expect(bot.sendMessage).not.toHaveBeenCalled();

    // new task runs
    tasks[1].fire();
    await vi.waitFor(() =>
      expect(bot.sendMessage).toHaveBeenCalledWith(1, 'article')
    );
  });
});
