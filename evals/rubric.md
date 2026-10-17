# Human Rubric: AI Copy Assistant

Score each draft 1–5 on each criterion. Graders see the case input (goal, tone, promotion, brief) and the draft. They don't see which model produced it.

| Criterion | 5 | 3 | 1 |
|---|---|---|---|
| **Accuracy** | States only what's in the input; any offer is exactly `{{offer}}` | Slightly vague, but nothing false | Invents or changes an offer, date, service or claim |
| **Clarity** | One clear message with one call to action | Understandable, but wordy | Confusing or several competing asks |
| **Tone fit** | Exactly the requested tone and sounds like a local salon | Generic | Wrong tone, or sounds robotic or pushy |
| **Brevity** | Reads at a glance on a phone | A little long | Wall of text |
| **Respect** | Warm and never guilt-tripping | Neutral | Pressure tactics, guilt, or anything inappropriate |

Record scores in `evals/results/YYYY-MM-DD-<model>-<promptVersion>.csv` with the columns `case_id, draft_index, accuracy, clarity, tone, brevity, respect, notes`.
