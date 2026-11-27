<!-- lervo-release package="@lervo/ade" version="0.10.0" schema="1" -->

Needs the Lervo CLI 0.63.0 or later.

## What's changed

- A conversation an agent started opens on its own and shows who started it and from where; the conversation it came from shows a line that opens it.
- A conversation is led by the team's Product Owner by default; in a team without one, the start card proposes a Product Owner that Lervo hires when the work starts.
- A conversation shows about 40 ms sooner when it opens: its list is placed at the end in the frame its rows are measured rather than three frames later.
- A conversation with several agents reads as one timeline: each agent's turns interleave by time, a line names the speaker when it changes, room lines show joins and pauses, and mentions show as quiet pills.
- A development build run outside its app bundle no longer crashes when an agent finishes in the background; it skips the desktop notification instead.
- Agents in the sidebar: the selected project's team under the switcher, Lervo's own agents folded into one row, a plus that hires by role, and Hire a Product Owner in a project without agents.
- An agent's profile shows what it has learned: its active context entries, newest first, with what kind of note each is and when it was observed.
- An agent's question shows its options on a card in the conversation: choose one, or several where allowed, and the answer goes to the agent, or reply in your own words instead.
- Choose a new conversation's agents from a chip on the start card; the conversation's header shows their marks, and each agent in the sidebar shows whether its conversations are working or need you.
- Choosing an agent opens its profile: rename it in place, pick the model and effort its sessions run with, and see the conversations it takes part in.
- Conversations nobody has open stop their agent's process after ten idle minutes, saving about 150 MB each, and resume where they were when opened again.
- Floating glass keeps its blur from the first frame, the floating reply card is edged like other glass, room members reopen without polling, and sizes and lists follow the locale.
- Give an agent an image from its profile: press its mark to choose one; the image shows in the sidebar, the conversation's header, speaker lines, and mention suggestions.
- New work whose coordination the core could not set up says so in one Lervo line, with the failed step's code.
- Opening a conversation no longer moves it to the top of the sidebar.
- Overlapping agent marks part with a transparent cut-out instead of a painted ring, so the header's marks show no white border on any surface.
- Quieter status in the sidebar: a working conversation's title shimmers instead of showing a dot, an agent's mark wears a thin ring while it works or needs you, and only what needs you keeps the amber dot.
- The first conversation opened after launch shows about 300 ms sooner: a conversation already loaded no longer waits out React's Suspense throttle.
- The reply card's @ offers the conversation's agents, then the rest of the team, above the card; mentions in the field show as pills; the working line names each working agent in a conversation of several.
- The session host performs room deliveries: a mentioned agent's running session gets the turn after its current one, or the agent joins the conversation first with its own session; a failed delivery shows as a line where the mention was made.
- The sidebar's agents and the Conversations heading now arrive together and open their space smoothly, so the conversation rows below slide once instead of jumping.
- When Lervo cannot route a reply's mentions, read a turn's summary, or hire the proposed Product Owner, the conversation now says so, and a failing turn summary is no longer asked again on every render.
