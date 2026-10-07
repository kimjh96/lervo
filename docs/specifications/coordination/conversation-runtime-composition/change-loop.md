# Change-loop scheduling

`ConversationChangeLoop` runs serial cycles. Starting a running loop leaves it unchanged. Start attempts a change subscription and schedules an immediate cycle; subscription failure falls back to timed operation. Stop cancels the timer, unsubscribes, and returns the active cycle's promise without aborting it.

Notifications reset the idle streak and request immediate work. During a cycle, they set a pending flag to schedule another cycle afterward. The ordinary interval must be an integer from 100 to 60,000 milliseconds.

Cycle failure invokes `onFailure`. Unless `continueOnFailure` is enabled, failure stops the loop and removes the subscription. With continuation enabled, an optional failure delay applies only if it is an integer from 100 to 300,000 milliseconds; otherwise the ordinary interval applies.

After a successful subscribed cycle:

- No next deadline: no timer.
- Future deadline: schedule its remaining delay.
- Lapsed deadline: use the ordinary interval unless optional idle backoff classifies the result as unchanged. Consecutive unchanged lapsed-deadline results double the delay from `baseMs` to `ceilingMs`; the base is at least 100 milliseconds and the ceiling at most one hour.

A notification, changed result, future deadline, or absent deadline resets the idle streak. Deadline lookup failure falls back to the ordinary interval.
