import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CALENDAR_ID, TIMEZONE, calendar, summarizeEvent } from '../lib/google';

const timed = z.object({
  dateTime: z.string().describe('ISO 8601 datetime, e.g. "2026-09-02T14:00:00+03:00".'),
  timeZone: z.string().optional().describe(`IANA timezone. Defaults to ${TIMEZONE}.`),
});

export const listEventsTool = createTool({
  id: 'calendar_list_events',
  description:
    'Read events from Google Calendar in a time range. Use this before scheduling anything, and when checking what is coming up.',
  inputSchema: z.object({
    timeMin: z.string().describe('ISO 8601 start of the range (inclusive).'),
    timeMax: z.string().describe('ISO 8601 end of the range (exclusive).'),
    query: z.string().optional().describe('Free-text search across event fields.'),
    maxResults: z.number().int().min(1).max(250).default(50),
  }),
  execute: async ({ timeMin, timeMax, query, maxResults }) => {
    const response = await calendar().events.list({
      calendarId: CALENDAR_ID,
      timeMin,
      timeMax,
      q: query,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = (response.data.items ?? []).map(summarizeEvent);
    return { count: events.length, events };
  },
});

export const createEventTool = createTool({
  id: 'calendar_create_event',
  description: 'Create an event on Google Calendar.',
  inputSchema: z.object({
    title: z.string(),
    start: timed,
    end: timed,
    description: z.string().optional(),
    location: z.string().optional(),
    attendees: z.array(z.string().email()).optional().describe('Email addresses to invite.'),
    reminderMinutes: z
      .number()
      .int()
      .min(0)
      .max(40320)
      .optional()
      .describe('Minutes before start for a popup reminder. Omit for calendar defaults.'),
  }),
  execute: async ({ title, start, end, description, location, attendees, reminderMinutes }) => {
    const response = await calendar().events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: attendees?.length ? 'all' : 'none',
      requestBody: {
        summary: title,
        description,
        location,
        start: { dateTime: start.dateTime, timeZone: start.timeZone ?? TIMEZONE },
        end: { dateTime: end.dateTime, timeZone: end.timeZone ?? TIMEZONE },
        attendees: attendees?.map((email) => ({ email })),
        reminders:
          reminderMinutes === undefined
            ? { useDefault: true }
            : { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMinutes }] },
      },
    });
    return summarizeEvent(response.data);
  },
});

export const updateEventTool = createTool({
  id: 'calendar_update_event',
  description: 'Change an existing Google Calendar event. Only the fields you pass are modified.',
  inputSchema: z.object({
    eventId: z.string().describe('Event id from calendar_list_events.'),
    title: z.string().optional(),
    start: timed.optional(),
    end: timed.optional(),
    description: z.string().optional(),
    location: z.string().optional(),
  }),
  execute: async ({ eventId, title, start, end, description, location }) => {
    const response = await calendar().events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      requestBody: {
        ...(title !== undefined && { summary: title }),
        ...(description !== undefined && { description }),
        ...(location !== undefined && { location }),
        ...(start && { start: { dateTime: start.dateTime, timeZone: start.timeZone ?? TIMEZONE } }),
        ...(end && { end: { dateTime: end.dateTime, timeZone: end.timeZone ?? TIMEZONE } }),
      },
    });
    return summarizeEvent(response.data);
  },
});

export const deleteEventTool = createTool({
  id: 'calendar_delete_event',
  description: 'Delete an event from Google Calendar. Confirm with the user before calling this.',
  inputSchema: z.object({
    eventId: z.string().describe('Event id from calendar_list_events.'),
  }),
  requireApproval: true,
  execute: async ({ eventId }) => {
    await calendar().events.delete({ calendarId: CALENDAR_ID, eventId });
    return { deleted: eventId };
  },
});
