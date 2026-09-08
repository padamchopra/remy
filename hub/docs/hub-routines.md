# Hub routines and Inbox runs

WRK-20 and WRK-130–132 move organization routine scheduling to Durable Object alarms. No personal computer owns the clock. Ask an agent in Inbox for repeated work; its organization routine tool is unavailable in ordinary threads and external MCP sessions. Existing routines can be edited, paused or removed beside that agent.

Schedules support daily, weekdays, weekly and monthly cadence with an IANA time zone. Missing days and nonexistent daylight-saving times are skipped. The hub records the next occurrence durably, prewarms hosted fallback two minutes ahead, and uses the routing resolver at execution time. Routine threads are open by default, with the agent's visibility still enforced on reads, replies, notifications and live replay.

Every launch is claimed before contacting a computer. Retries do not start the same occurrence twice. A restart during an ambiguous launch leaves a message asking the person to check the thread; it does not quietly duplicate work. A missing eligible computer or lost member access records failure in both the routine and agent conversation. Missed occurrences are not replayed as a burst.

Inbox indexes computer-owned runs with current access and state, including offline history. Results appear in the agent conversation, and an available run opens its original computer/thread URL. Personal routine results remain personal even though their thread's default visibility is open. Native organization-phone integration is outside this layer; the narrow browser uses the same live Inbox data.

Validation covers a 09:00 hub-clock boundary, prewarming, duplicate delivery, reconstruction, failed routing, IANA zones, daylight saving and missing month days. Browser QA asks through the real MCP server, waits for a real Durable Object alarm, receives the daemon's result, verifies run access, pauses the routine and checks the mobile result. The model is a disposable fixture; a real hosted model with every Mac asleep still awaits WRK-15's organization credentials and deployment.
