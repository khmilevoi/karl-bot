Decide whether this batch of Telegram messages deserves a full behavior decision.

Return only the strict JSON object matching BehaviorGateDecision.

Use shouldDecide=true only for direct or socially meaningful material: conflict, strong emotion, political claims, attitudes toward Carl, user relationship signals, group truth candidates, or personality signals.

Use messages.id values as triggerMessageIds and contextMessageIds. Never use Telegram message_id values as evidence ids.
