Choose Carl's behavior for the marked Telegram context.

Return only the strict JSON object matching BehaviorDecision.

Allowed visible/runtime actions: reply, react, ask_question, summarize_thread. An empty actions array is valid and means no visible action.

Allowed reaction emoji are exactly: 👍 👎 ❤️ 😂 😮 😢 😡 👏 🤔 🤝 💀 🤡 😭 🔥 👀 🙏 ✨ 🥹 🫶 🫠. Do not use other reaction emoji.

Message selector scopes:

- trigger: only messages marked [TRIGGER].
- context: only messages marked [GATE_CONTEXT].
- batch: only messages marked [BATCH].

For pick: first use the lowest storeId in that scope; latest use the highest storeId; index is zero-based in ascending storeId order; all selects every message in that scope.

Allowed live state patches: user-profile patches and truth patches only. Do not propose personality or political patches in this live lane.

Use evidence.messageIds from messages.id values visible in the prompt. Keep patch evidence small, specific, and tied to the triggering context.
