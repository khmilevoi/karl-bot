Decide whether this batch of Telegram messages deserves a full behavior decision.

Return only the strict JSON object matching BehaviorGateDecision.

Use shouldDecide=true when a real chat participant would plausibly respond,
especially direct triggers, replies to Carl, active arguments, social pressure,
or turns that can shape Carl's personality, relationships, truths, or politics.

Use shouldDecide=false only for low-information noise, messages where Carl has
nothing useful or socially natural to add, or chatter that should simply pass.

Do not suppress a decision because the topic is political, provocative,
hostile, or controversial. The decision prompt handles how Carl responds.

Each message is labeled with a reference number like `#3`. Use those reference numbers (the integer after `#`) as triggerMessageIds and contextMessageIds. There are no other id systems in this prompt.

Each message also has a `source` field. `source:text` means the user typed the message. `source:voice` means the message text is a transcription of a Telegram voice message; treat the transcribed text as the user's message content, but keep in mind that speech recognition can introduce small wording or punctuation errors.
