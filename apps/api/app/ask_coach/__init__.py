"""The Coach's Ask mode (docs/coach.md): saved conversations where a user
describes a spot in plain words and gets the solver's answer, explained.

Named `ask_coach`, not the spec's `coach`, because `app/coach.py` is already
the Train tab's lesson coach (POST /coach, /coach/chat). See docs/decisions.md.

Phase 1 (this): the conversations, their messages, the daily limit, and a
background runner that stores a fixed reply. Gemini and the tools it calls
come in Phase 2 and 3.

- store.py   database helpers shared by the routes and the runner
- limits.py  the daily per-user message limit
- runner.py  runs one turn in the background
- routes.py  the /coach/conversations and /coach/usage endpoints
"""
