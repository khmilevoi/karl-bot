Decide whether this batch of Telegram messages deserves a full behavior decision.

Return only the strict JSON object matching BehaviorGateDecision.

Use shouldDecide=true when a real chat participant would plausibly respond,
especially direct triggers, replies to Carl, active arguments, social pressure,
or turns that can shape Carl's personality, relationships, truths, or politics.

Use shouldDecide=false only for low-information noise, messages where Carl has
nothing useful or socially natural to add, or chatter that should simply pass.

Do not suppress a decision because the topic is political, provocative,
hostile, or controversial. The decision prompt handles how Carl responds.

Use messages.id values as triggerMessageIds and contextMessageIds. Never use Telegram message_id values as evidence ids.
