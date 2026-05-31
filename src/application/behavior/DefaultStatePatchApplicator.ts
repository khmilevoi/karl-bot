import { inject, injectable } from 'inversify';

import type {
  LiveStatePatch,
  TruthPatch,
  UserProfilePatch,
} from '@/domain/behavior/schemas/patches';
import type {
  BotTruth,
  PatternSignal,
  SocialSignal,
  UserSocialProfile,
} from '@/domain/behavior/schemas/state';
import {
  TRUTH_REPOSITORY_ID,
  type TruthRepository,
} from '@/domain/repositories/TruthRepository';
import {
  USER_SOCIAL_PROFILE_REPOSITORY_ID,
  type UserSocialProfileRepository,
} from '@/domain/repositories/UserSocialProfileRepository';
import type { ChatMessage } from '@/domain/messages/ChatMessage';

import {
  BEHAVIOR_RATE_LIMITER_ID,
  type BehaviorRateLimiter,
} from './BehaviorRateLimiter';
import type { BehaviorPatchResult } from './BehaviorTypes';
import { PATCH_POLICY_ID, type PatchPolicy } from './PatchPolicy';
import {
  STATE_PATCH_APPLICATOR_CONFIG_ID,
  type StatePatchApplicator,
  type StatePatchApplicatorConfig,
} from './StatePatchApplicator';

interface AcceptedPatch {
  index: number;
  patch: LiveStatePatch;
}

type SignalKind = 'label' | 'pattern' | 'grudge';

@injectable()
export class DefaultStatePatchApplicator implements StatePatchApplicator {
  constructor(
    @inject(STATE_PATCH_APPLICATOR_CONFIG_ID)
    private readonly config: StatePatchApplicatorConfig,
    @inject(USER_SOCIAL_PROFILE_REPOSITORY_ID)
    private readonly profileRepo: UserSocialProfileRepository,
    @inject(TRUTH_REPOSITORY_ID) private readonly truthRepo: TruthRepository,
    @inject(PATCH_POLICY_ID) private readonly patchPolicy: PatchPolicy,
    @inject(BEHAVIOR_RATE_LIMITER_ID)
    private readonly rateLimiter: BehaviorRateLimiter
  ) {}

  async applyPatches(params: {
    chatId: number;
    patches: readonly LiveStatePatch[];
    contextMessages: readonly ChatMessage[];
    nowIso?: string;
    nowMs?: number;
  }): Promise<BehaviorPatchResult[]> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const nowMs = params.nowMs ?? Date.now();
    const results: Array<BehaviorPatchResult | null> = params.patches.map(
      () => null
    );
    const accepted: AcceptedPatch[] = [];

    for (const [index, patch] of params.patches.entries()) {
      const policy = this.patchPolicy.evaluate(patch);
      if (policy.outcome !== 'accept') {
        results[index] = {
          patchType: patch.type,
          outcome: 'rejected',
          reason: policy.reason,
        };
        continue;
      }

      const rateLimit = this.rateLimiter.checkPatch({
        chatId: params.chatId,
        patch,
        nowMs,
      });
      if (!rateLimit.allowed) {
        results[index] = {
          patchType: patch.type,
          outcome: 'rate_limited',
          reason: rateLimit.reason,
        };
        continue;
      }

      accepted.push({ index, patch });
    }

    await this.applyUserPatches({
      accepted,
      chatId: params.chatId,
      contextMessages: params.contextMessages,
      nowIso,
      results,
    });

    for (const acceptedPatch of accepted) {
      if (this.isTruthPatch(acceptedPatch.patch)) {
        results[acceptedPatch.index] = await this.applyTruthPatch({
          chatId: params.chatId,
          nowIso,
          patch: acceptedPatch.patch,
        });
      }
    }

    return results.map(
      (result, index) =>
        result ?? {
          patchType: params.patches[index].type,
          outcome: 'failed',
          reason: 'patch was not processed',
        }
    );
  }

  private async applyUserPatches(params: {
    accepted: AcceptedPatch[];
    chatId: number;
    contextMessages: readonly ChatMessage[];
    nowIso: string;
    results: Array<BehaviorPatchResult | null>;
  }): Promise<void> {
    const byUser = new Map<number, AcceptedPatch[]>();

    for (const acceptedPatch of params.accepted) {
      if (!this.isUserPatch(acceptedPatch.patch)) {
        continue;
      }
      const patches = byUser.get(acceptedPatch.patch.userId) ?? [];
      patches.push(acceptedPatch);
      byUser.set(acceptedPatch.patch.userId, patches);
    }

    for (const [userId, acceptedPatches] of byUser) {
      const existing = await this.profileRepo.findByChatAndUser(
        params.chatId,
        userId
      );
      const profile =
        existing ?? this.defaultProfile(params.chatId, userId, params.nowIso);
      const latestUsername = this.latestUsername(
        params.contextMessages,
        userId
      );
      if (latestUsername !== null && profile.username !== latestUsername) {
        profile.username = latestUsername;
      }

      let changed = false;
      const affinityDelta = acceptedPatches.reduce((sum, acceptedPatch) => {
        const { patch } = acceptedPatch;
        return patch.type === 'user.adjust_affinity' ? sum + patch.delta : sum;
      }, 0);

      if (affinityDelta !== 0) {
        profile.affinityScore = this.clampAffinity(
          profile.affinityScore + affinityDelta
        );
        changed = true;
      }

      for (const acceptedPatch of acceptedPatches) {
        const { patch } = acceptedPatch;
        if (!this.isUserPatch(patch)) {
          continue;
        }
        if (patch.type === 'user.adjust_affinity') {
          continue;
        }

        const applied = this.applyUserSignalPatch(profile, patch);
        if (applied) {
          changed = true;
        } else {
          params.results[acceptedPatch.index] = {
            patchType: patch.type,
            outcome: 'rejected',
            reason: 'target_not_found',
          };
        }
      }

      if (!changed) {
        continue;
      }

      this.recomputeRuntimeFields(profile);
      profile.updatedAt = params.nowIso;
      await this.profileRepo.upsert(profile);

      for (const acceptedPatch of acceptedPatches) {
        if (params.results[acceptedPatch.index] !== null) {
          continue;
        }
        params.results[acceptedPatch.index] = {
          patchType: acceptedPatch.patch.type,
          outcome: 'applied',
          reason: null,
          stateRef: {
            kind: 'user_social_profile',
            chatId: params.chatId,
            userId,
          },
        };
      }
    }
  }

  private applyUserSignalPatch(
    profile: UserSocialProfile,
    patch: Exclude<UserProfilePatch, { type: 'user.adjust_affinity' }>
  ): boolean {
    switch (patch.type) {
      case 'user.add_label':
        profile.labels.push(
          this.socialSignal(patch.label, patch.evidence.messageIds)
        );
        return true;
      case 'user.add_pattern':
        profile.patterns.push({
          polarity: patch.polarity,
          text: patch.text,
          evidenceMessageIds: patch.evidence.messageIds,
          status: 'active',
        });
        return true;
      case 'user.add_grudge':
        profile.grudges.push(
          this.socialSignal(patch.text, patch.evidence.messageIds)
        );
        return true;
      case 'user.contest_profile_signal':
        return this.contestSignal({
          evidenceMessageIds: patch.evidence.messageIds,
          kind: patch.target.kind,
          profile,
          text: patch.target.text,
        });
    }
  }

  private async applyTruthPatch(params: {
    chatId: number;
    nowIso: string;
    patch: TruthPatch;
  }): Promise<BehaviorPatchResult> {
    const { chatId, nowIso, patch } = params;

    switch (patch.type) {
      case 'truth.add': {
        const id = await this.truthRepo.add({
          chatId,
          text: patch.text,
          sourceMessageIds: this.uniqueIds(patch.evidence.messageIds),
          confidence: this.clampConfidence(patch.evidence.confidence),
          relatedTruthIds: this.uniqueIds(patch.relatedTruthIds),
          contradictsTruthIds: this.uniqueIds(patch.contradictsTruthIds),
          status: this.truthStatus(patch.evidence.confidence),
          createdAt: nowIso,
        });
        return this.appliedTruth(patch.type, chatId, id);
      }
      case 'truth.reinforce': {
        const truth = await this.findMutableTruth(chatId, patch.truthId);
        if (!truth) {
          return this.rejectedTruth(patch.type, 'target_not_found');
        }
        truth.sourceMessageIds = this.uniqueIds([
          ...truth.sourceMessageIds,
          ...patch.evidence.messageIds,
        ]);
        truth.confidence = this.clampConfidence(
          truth.confidence + 0.2 * patch.evidence.confidence
        );
        truth.status = this.truthStatus(truth.confidence);
        await this.truthRepo.update(truth);
        return this.appliedTruth(patch.type, chatId, truth.id);
      }
      case 'truth.contest': {
        const truth = await this.findMutableTruth(chatId, patch.truthId);
        if (!truth) {
          return this.rejectedTruth(patch.type, 'target_not_found');
        }
        const counterId = await this.truthRepo.add({
          chatId,
          text: patch.counterText,
          sourceMessageIds: this.uniqueIds(patch.evidence.messageIds),
          confidence: this.clampConfidence(patch.evidence.confidence),
          relatedTruthIds: [],
          contradictsTruthIds: [truth.id],
          status: this.truthStatus(patch.evidence.confidence),
          createdAt: nowIso,
        });
        truth.contradictsTruthIds = this.uniqueIds([
          ...truth.contradictsTruthIds,
          counterId,
        ]);
        truth.sourceMessageIds = this.uniqueIds([
          ...truth.sourceMessageIds,
          ...patch.evidence.messageIds,
        ]);
        truth.confidence = this.clampConfidence(
          truth.confidence - 0.2 * patch.evidence.confidence
        );
        truth.status = 'contested';
        await this.truthRepo.update(truth);
        return this.appliedTruth(patch.type, chatId, truth.id);
      }
      case 'truth.revise': {
        const truth = await this.findMutableTruth(chatId, patch.truthId);
        if (!truth) {
          return this.rejectedTruth(patch.type, 'target_not_found');
        }
        const replacementId = await this.truthRepo.add({
          chatId,
          text: patch.revisedText,
          sourceMessageIds: this.uniqueIds(patch.evidence.messageIds),
          confidence: this.clampConfidence(
            Math.max(truth.confidence, patch.evidence.confidence)
          ),
          relatedTruthIds: this.uniqueIds([truth.id, ...truth.relatedTruthIds]),
          contradictsTruthIds: this.uniqueIds(truth.contradictsTruthIds),
          status: this.truthStatus(
            Math.max(truth.confidence, patch.evidence.confidence)
          ),
          createdAt: nowIso,
        });
        truth.status = 'superseded';
        truth.relatedTruthIds = this.uniqueIds([
          ...truth.relatedTruthIds,
          replacementId,
        ]);
        await this.truthRepo.update(truth);
        return this.appliedTruth(patch.type, chatId, replacementId);
      }
    }
  }

  private async findMutableTruth(
    chatId: number,
    truthId: number
  ): Promise<BotTruth | null> {
    const truth = await this.truthRepo.findById(truthId);
    if (!truth || truth.chatId !== chatId || truth.status === 'superseded') {
      return null;
    }
    return truth;
  }

  private contestSignal(params: {
    evidenceMessageIds: number[];
    kind: SignalKind;
    profile: UserSocialProfile;
    text: string;
  }): boolean {
    const signal = this.findLatestSignal(
      this.signalsByKind(params.profile, params.kind),
      params.text
    );
    if (!signal) {
      return false;
    }

    signal.evidenceMessageIds = this.uniqueIds([
      ...signal.evidenceMessageIds,
      ...params.evidenceMessageIds,
    ]);
    signal.status = signal.status === 'active' ? 'contested' : 'inactive';
    return true;
  }

  private signalsByKind(
    profile: UserSocialProfile,
    kind: SignalKind
  ): Array<SocialSignal | PatternSignal> {
    switch (kind) {
      case 'label':
        return profile.labels;
      case 'pattern':
        return profile.patterns;
      case 'grudge':
        return profile.grudges;
    }
  }

  private findLatestSignal(
    signals: Array<SocialSignal | PatternSignal>,
    text: string
  ): SocialSignal | PatternSignal | null {
    for (let index = signals.length - 1; index >= 0; index -= 1) {
      const signal = signals[index];
      if (signal.text === text && signal.status !== 'inactive') {
        return signal;
      }
    }
    return null;
  }

  private defaultProfile(
    chatId: number,
    userId: number,
    nowIso: string
  ): UserSocialProfile {
    return {
      userId,
      chatId,
      username: null,
      affinityScore: 0,
      labels: [],
      patterns: [],
      grudges: [],
      trustLevel: 'none',
      preferredDistance: 'neutral',
      communicationStyle: '',
      conflictStyle: '',
      preferredTone: '',
      interests: [],
      updatedAt: nowIso,
    };
  }

  private latestUsername(
    messages: readonly ChatMessage[],
    userId: number
  ): string | null {
    const matching = messages
      .filter((message) => message.userId === userId && message.username)
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return matching.length > 0
      ? (matching[matching.length - 1].username ?? null)
      : null;
  }

  private recomputeRuntimeFields(profile: UserSocialProfile): void {
    const activeGrudges = profile.grudges.filter(
      (signal) => signal.status === 'active'
    ).length;
    const activeNegativePatterns = profile.patterns.filter(
      (signal) => signal.status === 'active' && signal.polarity === 'negative'
    ).length;

    if (profile.affinityScore >= 2 && activeGrudges === 0) {
      profile.trustLevel = 'high';
    } else if (profile.affinityScore >= 1 && activeGrudges === 0) {
      profile.trustLevel = 'medium';
    } else if (profile.affinityScore >= 0) {
      profile.trustLevel = 'low';
    } else {
      profile.trustLevel = 'none';
    }

    if (activeGrudges >= 2 || profile.affinityScore <= -3) {
      profile.preferredDistance = 'hostile';
    } else if (activeGrudges === 1) {
      profile.preferredDistance = 'avoidant';
    } else if (activeNegativePatterns >= 2) {
      profile.preferredDistance = 'mocking';
    } else if (profile.affinityScore <= -1) {
      profile.preferredDistance = 'cold';
    } else if (profile.affinityScore >= 2) {
      profile.preferredDistance = 'warm';
    } else {
      profile.preferredDistance = 'neutral';
    }
  }

  private socialSignal(
    text: string,
    evidenceMessageIds: number[]
  ): SocialSignal {
    return {
      text,
      evidenceMessageIds,
      status: 'active',
    };
  }

  private truthStatus(confidence: number): BotTruth['status'] {
    return this.clampConfidence(confidence) >= this.config.truthStableConfidence
      ? 'stable'
      : 'fresh';
  }

  private appliedTruth(
    patchType: TruthPatch['type'],
    chatId: number,
    truthId: number
  ): BehaviorPatchResult {
    return {
      patchType,
      outcome: 'applied',
      reason: null,
      stateRef: {
        kind: 'bot_truth',
        chatId,
        truthId,
      },
    };
  }

  private rejectedTruth(
    patchType: TruthPatch['type'],
    reason: string
  ): BehaviorPatchResult {
    return {
      patchType,
      outcome: 'rejected',
      reason,
    };
  }

  private isUserPatch(patch: LiveStatePatch): patch is UserProfilePatch {
    return patch.type.startsWith('user.');
  }

  private isTruthPatch(patch: LiveStatePatch): patch is TruthPatch {
    return patch.type.startsWith('truth.');
  }

  private clampAffinity(value: number): number {
    return Math.max(-3, Math.min(3, value));
  }

  private clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private uniqueIds(ids: readonly number[]): number[] {
    return [...new Set(ids)];
  }
}
