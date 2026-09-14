# Taktra — Living Product Guide

This document is the source-of-truth product guide for the accountability agent. It is intentionally living: whenever the product changes, this file should be updated in the same PR or change set.

## 1. Product purpose

This product is not just a work task tracker. It is a personal life manager and accountability partner for the user.

For a practical overview of current features and usage patterns, see [FEATURES_AND_USAGE.md](FEATURES_AND_USAGE.md).

Its job is to:

- capture important commitments from conversations, notes, and calendar life
- track personal, family, health, admin, growth, and work tasks in one system
- follow up when something is likely to slip
- reduce guilt by helping the user choose a smaller next step when overloaded
- escalate only when the task is genuinely stuck or no longer relevant
- close the loop so nothing quietly rots in the background

## 2. Product north star

The user should feel supported, not chased.

A good outcome is:

- tasks are captured without effort
- important things are not forgotten
- overdue items are surfaced only when they matter
- reminders are specific, brief, and useful
- busy periods do not trigger useless nagging
- tasks are either moved forward, rescheduled, or closed clearly

## 3. Core product principles

### 3.1 It manages life, not only work

The system tracks the full life operating system:

- work tasks
- personal admin
- family responsibilities
- health and fitness
- growth and learning
- relationship follow-ups
- recurring obligations

### 3.2 No silent ghost tasks

If a task is important enough to capture, it should not disappear silently. The system keeps it visible until it is:

- done
- dropped
- rescheduled
- made into a smaller next step

### 3.3 Overload is a valid state

Not every missed task means laziness or low priority. Sometimes the problem is:

- too much on the plate
- life chaos
- exhaustion
- competing priorities
- distraction
- emotional resistance

The manager should respond with a practical reduction, not just guilt.

### 3.4 Better follow-up beats more noise

The system should prefer:

- useful reminders
- minimal messages
- one clear ask
- action-oriented prompts
- reduced-scope next steps

It should avoid:

- repeated nagging
- vague guilt messages
- threatening language
- spam-like follow-ups

## 4. User experience model

### Capture

The agent receives input from:

- Telegram messages
- natural-language notes
- calendar events
- task mentions in conversation
- recurring obligations

When a task is mentioned, it is captured quickly and normalized.

### Track

Every task carries enough metadata to support accountability:

- title
- notes
- context
- priority
- due date
- status
- reason if blocked
- minimum viable action
- nudge history
- escalation level

### Follow up

The agent checks whether the task is:

- due soon
- due today
- stale
- blocked
- snoozed
- already nudged recently

Then it decides whether to send a short, useful message or stay silent.

### Escalate

Escalation should be calm and structured:

1. soft reminder
2. clarify next step
3. reduce scope or reschedule
4. ask if it is still relevant
5. final close-out

### Close the loop

Each task must end in a decision:

- done
- dropped
- rescheduled
- converted to a smaller action

## 5. Task model

The task system should support these life-level dimensions:

- context: work, personal, health, family, growth, admin
- status: open, blocked, done, dropped
- priority: low, normal, high
- dueAt: timestamp or null
- minimumViableAction: small next step for overloaded situations
- statusReason: why it is blocked or delayed
- escalationLevel: 0 to 4
- lastNudgedAt: when the user was last reminded

## 6. Reminder policy

The reminder system should follow these rules:

- do not send reminders for everything
- do not nag immediately after a previous reminder
- prefer one helpful message rather than several weak ones
- batch related tasks together
- ask for a concrete decision
- if the user is overloaded, offer a smaller action
- if a task is stale, ask whether it still matters

## 7. System architecture overview

This project currently has the foundation for the agent in the following places:

- [src/mastra/agents/agent.ts](../src/mastra/agents/agent.ts): agent behavior and instructions
- [src/mastra/index.ts](../src/mastra/index.ts): scheduler and standing reminders
- [src/mastra/tools/todo-tools.ts](../src/mastra/tools/todo-tools.ts): task capture and updates
- [src/mastra/lib/todos.ts](../src/mastra/lib/todos.ts): data model and task lifecycle logic

The main design patterns are:

- task data is persisted in storage
- scheduled check-ins wake the agent
- the agent evaluates real task state before messaging
- follow-up is structured and not purely conversational

## 8. Product behaviors to preserve

The following behaviors are central to this product:

- capture from ordinary conversation
- message through Telegram or a similar push channel
- respect real calendar state
- avoid noisy repeated reminders
- allow personal and work tasks in one ledger
- support realistic life realities like overload and procrastination

## 9. Operational expectations

This product must always be run like a personal accountability system, not a casual chatbot.

### It should feel like:

- a calm but persistent assistant
- a personal chief of staff
- a life manager for both priorities and follow-through
- a system that makes sure important things do not get lost

### It should not feel like:

- spam
- guilt pressure
- meaningless repeated reminders
- artificially strict task policing
- a work-only task app

## 10. Documentation maintenance policy

This guide must be updated whenever the product changes.

Use this rule:

- if the product behavior changes, update this guide in the same change set
- if the task model changes, update the lifecycle and data sections
- if the reminder policy changes, update the reminder behavior section
- if a new category or user need is added, update the product principles and life domains

This keeps the project from drifting into stale documentation.

## 11. Update checklist for every release or feature change

Before merging changes, verify:

- product goals still match the north star
- task model still supports the required life categories
- reminder behavior still avoids noisy over-chasing
- blocked / overloaded states still work
- user-facing behavior still feels supportive rather than nagging
- this guide reflects the new behavior

## 12. Current roadmap focus

The near-term product direction should prioritize:

1. richer accountability states
2. better escalation behavior
3. overloaded-user recovery flows
4. daily and weekly review loops
5. more personalized reminders based on the user’s actual life rhythm
6. personal growth tracking alongside work obligations

## 13. Decision summary

This product is best understood as a life manager and accountability partner, not just a productivity app.

Its success metric is not message count. It is:

- fewer forgotten tasks
- fewer silent slip-throughs
- better completion behavior
- healthier follow-through across work and life
- less guilt and more traction

## 14. Final note

This document should evolve alongside the product. If a feature is added, a behavior changes, or a new life domain becomes relevant, update this file as part of the work. The product is only as strong as the clarity of its operating model.
