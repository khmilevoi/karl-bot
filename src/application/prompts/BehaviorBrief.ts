import type {
  BehaviorPromptMessage,
  BehaviorPromptState,
  SelfIdentity,
} from './PromptTypes';
import type { UserSocialProfile } from '@/domain/behavior/schemas/state';

const TONE_BY_DISTANCE: Record<UserSocialProfile['preferredDistance'], string> =
  {
    warm: 'тёплый, поддерживающий тон',
    neutral: 'ровный, нейтральный тон',
    cold: 'холодно и сдержанно',
    mocking: 'колко, с насмешкой',
    avoidant: 'коротко, держи дистанцию',
    hostile: 'резко и конфронтационно',
  };

const EMOJI_BY_DISTANCE: Record<
  UserSocialProfile['preferredDistance'],
  string
> = {
  warm: '🔥/🫶/🥹/❤️',
  neutral: '👀/🤔/🙏',
  cold: '🤡/👎/🫠',
  mocking: '🤡/💀/🫠',
  avoidant: '👀/🤔',
  hostile: '👎/🤡/💀',
};

function activeUserIds(messages: BehaviorPromptMessage[]): number[] {
  const ids = new Set<number>();
  for (const m of messages) {
    if (m.role === 'user' && typeof m.userId === 'number') {
      ids.add(m.userId);
    }
  }
  return [...ids];
}

function handle(profile: UserSocialProfile): string {
  return profile.username != null
    ? `@${profile.username}`
    : `id:${profile.userId}`;
}

function relationshipCard(profile: UserSocialProfile): string {
  const grudge = profile.grudges.find((g) => g.status === 'active');
  const grudgePart = grudge != null ? ` · обида: "${grudge.text}"` : '';
  const tone = TONE_BY_DISTANCE[profile.preferredDistance];
  const emoji = EMOJI_BY_DISTANCE[profile.preferredDistance];
  const interests =
    profile.interests.length > 0
      ? ` · интересы: ${profile.interests.join(', ')}`
      : '';
  return (
    `${handle(profile)} — affinity ${profile.affinityScore} · distance: ${profile.preferredDistance} · ` +
    `trust: ${profile.trustLevel}${grudgePart}${interests} → ${tone}; reaction-уклон ${emoji}`
  );
}

function moodBrief(state: BehaviorPromptState): string {
  const s = state.personality.speechStyle;
  const c = state.political.compass;
  const isBlankStyle =
    s.tone === 'neutral' &&
    s.humor === 'none' &&
    state.personality.recurringThemes.length === 0;
  if (isBlankStyle) {
    return 'характер ещё не сформирован — держись сдержанно, наблюдай, не строй из себя то, чего пока нет.';
  }
  const themes =
    state.personality.recurringThemes.length > 0
      ? ` Темы: ${state.personality.recurringThemes.join(', ')}.`
      : '';
  return (
    `Сейчас ты: tone=${s.tone}, humor=${s.humor}, verbosity=${s.verbosity}, formality=${s.formality}. ` +
    `Компас: эконом ${c.economic} / соц ${c.social} (увер. ${c.economicConfidence}/${c.socialConfidence}).${themes} ` +
    `Говори в этом голосе; в политике аргументируй с этих позиций сразу.`
  );
}

export function buildBehaviorBrief(params: {
  state: BehaviorPromptState;
  messages: BehaviorPromptMessage[];
  selfIdentity?: SelfIdentity;
}): string {
  const { state, messages, selfIdentity } = params;
  const lines: string[] = ['# Кто ты сейчас и как относиться к собеседникам'];

  if (selfIdentity != null) {
    const uname =
      selfIdentity.username != null
        ? `@${selfIdentity.username}`
        : '(без username)';
    lines.push(
      `Ты — ${selfIdentity.name} (${uname}). К тебе обращаются ТОЛЬКО когда пишут ${uname}, ` +
        `твоё имя как обращение, или отвечают (reply) на твоё сообщение. Остальное — чужой разговор.`
    );
  }

  lines.push(moodBrief(state));

  const ids = activeUserIds(messages);
  const cards = ids
    .map((id) => state.profiles.find((p) => p.userId === id))
    .filter((p): p is UserSocialProfile => p != null)
    .map(relationshipCard);

  if (cards.length > 0) {
    lines.push('Отношения с активными собеседниками:');
    lines.push(...cards);
  } else {
    lines.push(
      'отношений пока нет — держись нейтрально и наблюдай, кто есть кто.'
    );
  }

  return lines.join('\n');
}
