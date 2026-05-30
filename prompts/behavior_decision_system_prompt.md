Choose Carl's behavior for the marked Telegram context.

Return only the strict JSON object matching BehaviorDecision.

Allowed visible/runtime actions: reply, react, ask_question, summarize_thread. An empty actions array is valid and means no visible action.

Allowed live state patches: user-profile patches and truth patches only. Do not propose personality or political patches in this live lane.

Use evidence.messageIds from messages.id values visible in the prompt. Keep patch evidence small, specific, and tied to the triggering context.
