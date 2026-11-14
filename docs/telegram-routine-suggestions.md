# Suggestions for the current time

Telegram check-ins can now ask about an activity regularly recorded at the current London half-hour, for example:

> On 3 recent weekdays, you logged Gym around 12:00. Is that what you’re doing today, or something else?

Suggestions use the previous 28 days, require at least three distinct matching days and a match on at least 60% of recorded comparable days at that time. The latest match must be within seven days. Weekdays and weekends are compared separately; missing diary data is not counted as evidence of inactivity. The prompt states the actual number of matching days rather than claiming the activity happened today.

Work suggestions keep company and project/task together. Travel suggestions retain recorded modes and destination. Notes and workout contents are not copied into prompts. Planned calendar entries, unknown/review-marked activities, and days explicitly marked as exceptional are excluded. An occupied current slot or exceptional current day suppresses the suggestion.

Suggestions use the existing check-in schedule and controls: quiet hours, snooze, pause, daily limits, recent-chat suppression, unanswered-message limits and queue deduplication still apply. Explicit commitment follow-ups and priority prompts retain precedence. No additional check-ins are scheduled and no extra AI requests are made. The prompt itself never writes a diary entry; normal clarification/save rules apply to a reply.

The database read remains scoped to the linked owner and uses the existing `(user_id, date)` index. No schema or permission changes are required.

Verification covers sparse/conflicting/stale history, weekday/weekend separation, London daylight saving, half-hour boundaries, work/travel details, exclusions and pacing. Isolated PostgreSQL integration tests exercise the actual history query, owner isolation, queued message, deduplication and unchanged diary records. These tests do not send a real Telegram message.
