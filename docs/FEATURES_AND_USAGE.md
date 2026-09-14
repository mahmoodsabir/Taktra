# Features & Usage Guide

This document is the living feature and usage guide for the life-manager accountability system. It is meant to grow with the product and serve as the main reference for what the system does, how it behaves, and how to use it well.

This file should be updated whenever we add a new capability, change reminder behavior, or change the way tasks are handled.

## 1. Product purpose

This system is a personal accountability partner for both life and work. It is not only a task tracker; it is a system that:

- captures commitments from everyday conversation
- tracks personal, family, health, admin, growth, and work tasks together
- follows up when something is at risk of slipping
- reduces overwhelm by suggesting smaller next steps
- prevents important tasks from silently disappearing
- helps the user close loops instead of leaving tasks half-finished

The goal is not guilt. The goal is momentum, clarity, and closure.

## 2. What the system does

### 2.1 Captures tasks from natural conversation

The agent watches ordinary conversation and turns important mentions into tracked tasks.

Examples:

- "I need to book a dentist appointment this week"
- "I should go to the gym after work"
- "I need to send the invoice tomorrow"
- "I have to call my mom back"

These are captured as tasks with the right context and urgency.

### 2.2 Tracks life areas, not only work

Tasks can live in these contexts:

- work
- personal
- health
- family
- growth
- admin

This keeps one system for everything that matters in the user’s life.

### 2.3 Manages task states and follow-up

Each task can move through states such as:

- open
- blocked
- done
- dropped

This makes the system realistic for life situations where the user is busy, tired, delayed, or overwhelmed.

### 2.4 Supports overload-aware progress

If the user is overloaded, lazy, distracted, or buried in something else, the task system supports a smaller action:

- minimumViableAction
- blocked reason
- reduced-scope follow-up
- reschedule or move forward instead of forcing the full original task

This helps the agent act like a helpful life manager instead of a nagging bot.

### 2.5 Follows up only when useful

The system is designed to avoid spam.

It checks:

- whether the task is due soon or overdue
- whether it is blocked
- whether the user was already nudged recently
- whether a smaller next step is more appropriate
- whether the task is still worth interrupting the user for

Silence is valid when the task is genuinely not worth disturbing the user about.

### 2.6 Connects with calendar and reminders

Tasks and events work together. When an item has a real time and place, the system can surface it via calendar tools as well as task tracking.

This is useful for:

- appointments
- calendar commitments
- meetings
- reminders before an event happens
- keeping tasks and scheduling in sync

### 2.7 Maintains accountability through closure

The system tries to prevent ghost tasks. A task should end in a clear outcome:

- finished
- dropped
- rescheduled
- converted into a smaller valid step

That keeps the backlog honest and useful.

## 3. Core features

### Task capture

The agent can create tasks with fields like:

- title
- notes
- context
- priority
- due date
- minimum viable action

This lets it store the actual task plus the realistic next step when the task becomes too heavy.

### Task management

Users or the agent can:

- list tasks
- update task status
- snooze tasks
- set due dates
- mark tasks as blocked
- explain why a task is blocked
- raise escalation level for repeated follow-up

### Reminder system

Recurring check-ins wake the agent to decide whether a message is useful.

Examples of reminder patterns:

- morning brief
- midday sweep
- due-sweep
- evening closeout

These are designed to be short and practical, not noisy.

### Overload handling

A big part of the product is its ability to answer the question: "I am overwhelmed. What now?"

Instead of simply pushing the same task harder, the system can:

- propose the minimum viable action
- ask whether to reschedule
- ask whether the task is still a priority
- help convert the task into something doable today

### Memory and working context

The agent keeps operational memory so it knows:

- recurring priorities
- personal context
- life patterns
- preferences for nudging
- what not to nag about

### Workspace safety and tool behavior

The app includes a workspace for files and actions, with protections for:

- file writes
- file edits
- deletions
- shell execution approval

This protects the user from accidental or unsafe automation.

## 4. Typical usage

### 4.1 Capture a task from a message

Example:

> "I need to go to the gym after work and I should start a 10-minute walk tomorrow morning."

The system should:

- create a health task
- note the due timing or context
- store a smaller viable action if relevant
- keep it in the upcoming accountability flow

### 4.2 Handle blocked or overloaded tasks

Example:

> "I’m busy with family stuff and I’m exhausted. I can’t do the full workout today."

The system should:

- mark the task as blocked
- add a statusReason explaining the situation
- suggest the minimum viable action
- keep the task in the queue without shame or excessive pressure

### 4.3 Follow up without spam

When a task is overdue or approaching a due point, the system can send a short message like:

- "This still needs a small move. Do you want the 10-minute version, a reschedule, or to drop it?"
- "You have this due today. What is the minimum action that still counts?"

The user should get a practical nudge rather than a generic guilt message.

### 4.4 Close a task out

When a task is completed, the agent should mark it as done immediately.

When it is no longer relevant, it can be:

- marked dropped
- converted to a smaller action
- rescheduled with a new due date

### 4.5 Use the calendar as part of the system

If the user says something like:

> "I’m meeting the doctor at 3pm Friday"

The system should log the item and, when appropriate, create a calendar event with reminders.

This helps keep real-world commitments and follow-up tasks aligned.

## 5. System workflow

The normal flow looks like this:

1. User expresses a task or goal
2. System captures and stores it
3. System tracks due dates, status, and context
4. Reminder checks assess whether something is due or stale
5. Agent decides whether to message or stay silent
6. User responds or the task is updated
7. Task is closed out, rescheduled, or dropped

This loop is the heart of the accountability model.

## 6. Good usage rules

To keep the system useful:

- capture tasks early, even if they are informal
- prefer clear, concrete titles
- use the correct life context
- give a realistic minimum viable action when the task feels heavy
- do not nag every time the same task is due
- prefer one useful message over multiple weak ones
- ask questions only when the answer changes the next action

## 7. What this system is not

This system is not:

- a generic prompt bot
- a business-only to-do app
- a noisy reminder spam engine
- a guilt machine
- a work-only planning system

It is a practical life manager and follow-through system.

## 8. Maintenance rule

This document should be updated in the same change set as any product change.

When we add a new feature, change reminders, add task metadata, update workflows, or change the user behavior model, this guide should be revised so it remains the reliable source of truth.

## 9. Documentation map

Relevant project files:

- [../README.md](../README.md)
- [../docs/LIVING_PRODUCT_GUIDE.md](LIVING_PRODUCT_GUIDE.md)
- [../src/mastra/agents/agent.ts](../src/mastra/agents/agent.ts)
- [../src/mastra/index.ts](../src/mastra/index.ts)
- [../src/mastra/tools/todo-tools.ts](../src/mastra/tools/todo-tools.ts)
- [../src/mastra/lib/todos.ts](../src/mastra/lib/todos.ts)

Together these files describe the product, the reminder behavior, the task lifecycle, and the implementation details.
