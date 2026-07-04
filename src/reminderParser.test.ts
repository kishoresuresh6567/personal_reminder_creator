import { describe, expect, it } from "vitest";
import { categorizeReminder, parseReminderTranscript } from "./reminderParser";

const sundayEvening = new Date(2026, 5, 28, 18, 0, 0);

describe("parseReminderTranscript", () => {
  it("defaults a time-only reminder to today when the time is still future", () => {
    const result = parseReminderTranscript("Dry clothes at 7 PM", sundayEvening);

    expect(result).toMatchObject({
      ok: true,
      reminder: {
        reminderText: "Dry clothes",
        originalTranscript: "Dry clothes at 7 PM",
        dueDate: "2026-06-28",
        dueTime: "19:00:00",
        datePhrase: null,
        timePhrase: "at 7 PM",
        dateResolution: "default_today",
      },
    });
  });

  it("trims reminder prefixes and saves tomorrow as a future relative day", () => {
    const result = parseReminderTranscript("Remind me to call mom tomorrow at 8 AM", sundayEvening);

    expect(result).toMatchObject({
      ok: true,
      reminder: {
        reminderText: "call mom",
        dueDate: "2026-06-29",
        dueTime: "08:00:00",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
      },
    });
  });

  it("resolves weekday names to the nearest upcoming weekday", () => {
    const result = parseReminderTranscript("Please remind me to submit report on Monday at 9", sundayEvening);

    expect(result).toMatchObject({
      ok: true,
      reminder: {
        reminderText: "submit report",
        dueDate: "2026-06-29",
        dueTime: "09:00:00",
        datePhrase: "Monday",
        timePhrase: "at 9",
        dateResolution: "weekday",
      },
    });
  });

  it("uses next week when the requested weekday is today but the time already passed", () => {
    const mondayMorning = new Date(2026, 5, 29, 10, 0, 0);
    const result = parseReminderTranscript("set a reminder to submit report Monday at 9", mondayMorning);

    expect(result).toMatchObject({
      ok: true,
      reminder: {
        reminderText: "submit report",
        dueDate: "2026-07-06",
        dueTime: "09:00:00",
        datePhrase: "Monday",
        timePhrase: "at 9",
        dateResolution: "weekday",
      },
    });
  });

  it("removes explicit date and time phrases from the reminder text", () => {
    const result = parseReminderTranscript("Create a reminder to pay rent on June 30 at 7:30 PM", sundayEvening);

    expect(result).toMatchObject({
      ok: true,
      reminder: {
        reminderText: "pay rent",
        dueDate: "2026-06-30",
        dueTime: "19:30:00",
        datePhrase: "June 30",
        timePhrase: "at 7:30 PM",
        dateResolution: "explicit_date",
      },
    });
  });

  it("parses numeric dates", () => {
    const result = parseReminderTranscript("remind me to renew insurance 06/30/2026 by 19:30", sundayEvening);

    expect(result).toMatchObject({
      ok: true,
      reminder: {
        reminderText: "renew insurance",
        dueDate: "2026-06-30",
        dueTime: "19:30:00",
        datePhrase: "06/30/2026",
        timePhrase: "by 19:30",
        dateResolution: "explicit_date",
      },
    });
  });

  it("rejects yesterday reminders as past due", () => {
    const result = parseReminderTranscript("Remind me yesterday to pay rent at 5 PM", sundayEvening);

    expect(result).toEqual({
      ok: false,
      error: "past_due",
      originalTranscript: "Remind me yesterday to pay rent at 5 PM",
    });
  });

  it("rejects a time-only reminder when today's time has already passed", () => {
    const result = parseReminderTranscript("Dry clothes at 5 PM", sundayEvening);

    expect(result).toEqual({
      ok: false,
      error: "past_due",
      originalTranscript: "Dry clothes at 5 PM",
    });
  });

  it("rejects empty reminder text after trimming commands and date/time phrases", () => {
    const result = parseReminderTranscript("remind me to at 7 PM", sundayEvening);

    expect(result).toEqual({
      ok: false,
      error: "empty_reminder_text",
      originalTranscript: "remind me to at 7 PM",
    });
  });

  it("rejects transcripts without a time", () => {
    const result = parseReminderTranscript("remind me to call mom tomorrow", sundayEvening);

    expect(result).toEqual({
      ok: false,
      error: "missing_time",
      originalTranscript: "remind me to call mom tomorrow",
    });
  });
});

describe("categorizeReminder", () => {
  it("categorizes office and work reminders as Work", () => {
    expect(categorizeReminder("prepare the office project report")).toBe("Work");
  });

  it("categorizes buying reminders as Shopping", () => {
    expect(categorizeReminder("buy groceries and milk")).toBe("Shopping");
  });

  it("categorizes suggestion reminders as Ideas", () => {
    expect(categorizeReminder("suggest a dinner idea to Priya")).toBe("Ideas");
  });

  it("defaults personal reminders to Personal", () => {
    expect(categorizeReminder("call mom")).toBe("Personal");
  });
});
