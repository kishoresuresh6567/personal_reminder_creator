import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, getReminderTimeState } from "./App";
import { saveAudioReminder } from "./audioStorage";
import { completeReminder, createReminderFromTranscript, deleteReminder, listRecentReminders, rescheduleReminder } from "./reminderStorage";

vi.mock("./audioStorage", () => ({
  saveAudioReminder: vi.fn(),
}));

vi.mock("./reminderStorage", () => ({
  completeReminder: vi.fn(),
  createReminderFromTranscript: vi.fn(),
  deleteReminder: vi.fn(),
  listRecentReminders: vi.fn(),
  rescheduleReminder: vi.fn(),
}));

const saveAudioReminderMock = vi.mocked(saveAudioReminder);
const completeReminderMock = vi.mocked(completeReminder);
const createReminderFromTranscriptMock = vi.mocked(createReminderFromTranscript);
const deleteReminderMock = vi.mocked(deleteReminder);
const listRecentRemindersMock = vi.mocked(listRecentReminders);
const rescheduleReminderMock = vi.mocked(rescheduleReminder);

type SpeechRecognitionResultPayload = {
  isFinal: boolean;
  transcript: string;
};

class MockMediaRecorder extends EventTarget {
  static instances: MockMediaRecorder[] = [];

  state: RecordingState = "inactive";
  mimeType = "audio/webm";

  constructor(public readonly stream: MediaStream) {
    super();
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }

  emitData(data: Blob) {
    const event = new Event("dataavailable") as Event & { data: Blob };
    event.data = data;
    this.dispatchEvent(event);
  }

  emitError() {
    this.dispatchEvent(new Event("error"));
  }
}

class MockSpeechRecognition extends EventTarget {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((event: { error: string; message?: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();

  constructor() {
    super();
    MockSpeechRecognition.instances.push(this);
  }

  emitResults(results: SpeechRecognitionResultPayload[]) {
    this.onresult?.({
      resultIndex: 0,
      results: results.map((result) => ({
        isFinal: result.isFinal,
        0: { transcript: result.transcript },
      })),
    });
  }

  emitError(error: string, message?: string) {
    this.onerror?.({ error, message });
  }
}

function createMediaStreamMock() {
  const stop = vi.fn();

  return {
    stream: {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream,
    stop,
  };
}

describe("App", () => {
  const originalMediaDevices = navigator.mediaDevices;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalSpeechRecognition = (globalThis as typeof globalThis & { SpeechRecognition?: unknown }).SpeechRecognition;
  const originalWebkitSpeechRecognition = (globalThis as typeof globalThis & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

  beforeEach(() => {
    MockMediaRecorder.instances = [];
    MockSpeechRecognition.instances = [];
    vi.restoreAllMocks();
    saveAudioReminderMock.mockClear();
    completeReminderMock.mockClear();
    createReminderFromTranscriptMock.mockClear();
    deleteReminderMock.mockClear();
    listRecentRemindersMock.mockClear();
    rescheduleReminderMock.mockClear();
    completeReminderMock.mockResolvedValue(null);
    deleteReminderMock.mockResolvedValue(undefined);
    listRecentRemindersMock.mockResolvedValue([]);
    rescheduleReminderMock.mockImplementation(async (reminderId, input) => ({
      id: reminderId,
      audioId: "audio-1",
      reminderText: "dry clothes",
      category: "Personal",
      originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
      dueDate: input.dueDate,
      dueTime: input.dueTime,
      dueAt: input.dueAt,
      datePhrase: input.datePhrase,
      timePhrase: input.timePhrase,
      dateResolution: input.dateResolution,
      status: "pending",
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    }));
    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
      transcriptText: null,
      transcriptStatus: "not_supported",
      transcriptError: "Speech recognition is not supported in this browser.",
      transcribedAt: null,
    });
    createReminderFromTranscriptMock.mockResolvedValue({
      ok: true,
      reminder: {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "buy milk",
        originalTranscript: "buy milk tomorrow at 8 AM",
        dueDate: "2026-06-29",
        dueTime: "08:00:00",
        dueAt: "2026-06-29T02:30:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      },
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "webkitSpeechRecognition", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: originalMediaRecorder,
    });
    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: originalSpeechRecognition,
    });
    Object.defineProperty(globalThis, "webkitSpeechRecognition", {
      configurable: true,
      writable: true,
      value: originalWebkitSpeechRecognition,
    });
  });

  it("renders the home page title and recording controls", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /personal reminder creator/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record audio/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeDisabled();
    expect(screen.getByText(/ready to record/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent reminders/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /record/i })).toHaveAttribute("aria-current", "page");
  });

  it("opens the alarm list screen from the alarm tab", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: /alarm/i }));

    expect(screen.getByRole("link", { name: /alarm/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText(/next alarm/i)).toBeInTheDocument();
    expect(screen.getByText(/no alarms scheduled/i)).toBeInTheDocument();
    expect(screen.getByText(/no alarms yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/weekdays/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add new alarm/i })).toBeInTheDocument();
  });

  it("loads recent reminders into the recent reminders section", async () => {
    const createdAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2026-06-29",
        dueTime: "19:00:00",
        dueAt: "2026-06-29T13:30:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/dry clothes/i)).toBeInTheDocument());
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByLabelText(/created/i)).toHaveTextContent(/7 days ago/i);
    expect(screen.getByLabelText(/event time/i)).toHaveTextContent(/7:00 PM/i);
    expect(screen.getByLabelText(/event date/i)).toHaveTextContent(/(?:Jun 29, 2026|29 Jun 2026)/i);
    expect(listRecentRemindersMock).toHaveBeenCalledTimes(1);
  });

  it("deletes a reminder from the home page recent reminders list", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete dry clothes/i }));

    expect(deleteReminderMock).toHaveBeenCalledWith("reminder-1");
    await waitFor(() => expect(screen.queryByText(/dry clothes/i)).not.toBeInTheDocument());
  });

  it("strikes and removes a completed reminder from the home page recent reminders list", async () => {
    const user = userEvent.setup();
    let resolveComplete: () => void = () => {};

    completeReminderMock.mockReturnValue(
      new Promise((resolve) => {
        resolveComplete = () => resolve(null);
      }),
    );
    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mark dry clothes complete/i }));

    expect(completeReminderMock).toHaveBeenCalledWith("reminder-1");
    expect(screen.getByLabelText(/future reminder: dry clothes/i)).toHaveClass("is-completing");

    resolveComplete();

    await waitFor(() => expect(screen.queryByText(/dry clothes/i)).not.toBeInTheDocument());
  });

  it("keeps a completed daily recurring reminder visible with the next due date", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes every day at 7 PM",
        dueDate: "2026-07-09",
        dueTime: "19:00:00",
        dueAt: "2026-07-09T13:30:00.000Z",
        datePhrase: "daily schedule",
        timePhrase: "at 7:00 pm",
        dateResolution: "rescheduled_daily",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);
    completeReminderMock.mockResolvedValue({
      id: "reminder-1",
      audioId: "audio-1",
      reminderText: "dry clothes",
      category: "Personal",
      originalTranscript: "remind me to dry clothes every day at 7 PM",
      dueDate: "2026-07-10",
      dueTime: "19:00:00",
      dueAt: "2026-07-10T13:30:00.000Z",
      datePhrase: "daily schedule",
      timePhrase: "at 7:00 pm",
      dateResolution: "rescheduled_daily",
      status: "pending",
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-07-09T13:31:00.000Z",
    });

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mark dry clothes complete/i }));

    expect(completeReminderMock).toHaveBeenCalledWith("reminder-1");
    await waitFor(() => expect(screen.getByText(/dry clothes/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/event date 10 jul 2026/i)).toBeInTheDocument();
  });

  it("opens the reschedule screen from a home page reminder", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reschedule dry clothes/i }));

    expect(screen.getByRole("heading", { name: /reschedule reminder/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/reschedule dry clothes/i)).toBeInTheDocument();
    expect(screen.getByText(/repeat every day/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/daily time/i)).toHaveValue("19:00");
    expect(screen.getByLabelText(/daily time/i)).toHaveDisplayValue("7:00 pm");
    expect(getSelectOptionLabels(screen.getByLabelText(/daily time/i))).toEqual(
      expect.arrayContaining(["12:00 am", "12:30 am", "11:30 pm"]),
    );
    expect(getSelectOptionLabels(screen.getByLabelText(/daily time/i)).at(0)).toBe("12:00 am");
    expect(getSelectOptionLabels(screen.getByLabelText(/daily time/i)).at(-1)).toBe("11:30 pm");
    expect(screen.getByText(/weekly schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/monthly schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/this reminder will be updated globally/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm reschedule/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard changes/i })).toBeInTheDocument();
  });

  it("confirms a daily reschedule with the selected time", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reschedule dry clothes/i }));
    await user.selectOptions(screen.getByLabelText(/daily time/i), "10:30");
    expect(screen.getByLabelText(/daily time/i)).toHaveDisplayValue("10:30 am");
    await user.click(screen.getByRole("button", { name: /confirm reschedule/i }));

    await waitFor(() =>
      expect(rescheduleReminderMock).toHaveBeenCalledWith(
        "reminder-1",
        expect.objectContaining({
          dueDate: expect.any(String),
          dueTime: "10:30:00",
          datePhrase: "daily schedule",
          timePhrase: "at 10:30 am",
          dateResolution: "rescheduled_daily",
        }),
      ),
    );
    expect(await screen.findByLabelText(/reschedule success/i)).toHaveTextContent(/rescheduled/i);
  });

  it("updates weekly schedule controls before confirming", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reschedule dry clothes/i }));
    await user.click(screen.getByRole("button", { name: /^weekly schedule$/i }));
    await user.click(screen.getByRole("button", { name: /toggle wednesday/i }));
    await user.selectOptions(screen.getByLabelText(/weekly time/i), "18:00");
    expect(screen.getByLabelText(/weekly time/i)).toHaveDisplayValue("6:00 pm");
    await user.click(screen.getByRole("button", { name: /confirm reschedule/i }));

    await waitFor(() =>
      expect(rescheduleReminderMock).toHaveBeenCalledWith(
        "reminder-1",
        expect.objectContaining({
          dueTime: "18:00:00",
          datePhrase: "weekly schedule:1,3",
          timePhrase: "at 6:00 pm",
          dateResolution: "rescheduled_weekly",
        }),
      ),
    );
  });

  it("updates all monthly dropdown controls before confirming", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reschedule dry clothes/i }));
    await user.click(screen.getByRole("button", { name: /^monthly schedule$/i }));
    await user.selectOptions(screen.getByLabelText(/monthly year/i), "2099");
    await user.selectOptions(screen.getByLabelText(/monthly month/i), "Feb");
    await user.selectOptions(screen.getByLabelText(/monthly day/i), "2");
    await user.selectOptions(screen.getByLabelText(/monthly time/i), "09:00");
    expect(screen.getByLabelText(/monthly time/i)).toHaveDisplayValue("9:00 am");
    await user.click(screen.getByRole("button", { name: /confirm reschedule/i }));

    await waitFor(() =>
      expect(rescheduleReminderMock).toHaveBeenCalledWith(
        "reminder-1",
        expect.objectContaining({
          dueDate: "2099-02-02",
          dueTime: "09:00:00",
          datePhrase: "monthly schedule",
          timePhrase: "at 9:00 am",
          dateResolution: "rescheduled_monthly",
        }),
      ),
    );
  });

  it("focuses each dropdown when clicking its arrow area", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reschedule dry clothes/i }));

    for (const label of [/daily time/i, /weekly time/i, /monthly day/i, /monthly time/i, /monthly month/i, /monthly year/i]) {
      const select = screen.getByLabelText(label);

      await user.click(select);
      expect(select).toHaveFocus();
    }
  });

  it("returns from the reschedule screen to the previous home view", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reschedule dry clothes/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByRole("heading", { name: /recent reminders/i })).toBeInTheDocument();
    expect(screen.getByText(/dry clothes/i)).toBeInTheDocument();
  });

  it("discards reschedule changes and returns to the previous home view", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        category: "Personal",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2099-01-01",
        dueTime: "19:00:00",
        dueAt: "2099-01-01T19:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText(/dry clothes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reschedule dry clothes/i }));
    await user.selectOptions(screen.getByLabelText(/daily time/i), "10:30");
    await user.click(screen.getByRole("button", { name: /discard changes/i }));

    expect(rescheduleReminderMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /recent reminders/i })).toBeInTheDocument();
  });

  it("opens the reminders screen from the View all button", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: /view all/i }));

    expect(screen.getByRole("heading", { name: /upcoming/i })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search your voice reminders/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reminders/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/no recorded reminders yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/pick up groceries for dinner/i)).not.toBeInTheDocument();
  });

  it("filters reminders by category while All shows everything", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "work-reminder",
        audioId: "audio-1",
        reminderText: "submit report",
        category: "Work",
        originalTranscript: "submit report Monday at 9",
        dueDate: "2099-01-01",
        dueTime: "09:00:00",
        dueAt: "2099-01-01T09:00:00.000Z",
        datePhrase: "Monday",
        timePhrase: "at 9",
        dateResolution: "weekday",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      {
        id: "shopping-reminder",
        audioId: "audio-2",
        reminderText: "buy milk",
        category: "Shopping",
        originalTranscript: "buy milk tomorrow at 8 AM",
        dueDate: "2099-01-01",
        dueTime: "08:00:00",
        dueAt: "2099-01-01T08:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /view all/i }));

    expect(await screen.findByText(/submit report/i)).toBeInTheDocument();
    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Work" }));

    expect(screen.getByText(/submit report/i)).toBeInTheDocument();
    expect(screen.queryByText(/buy milk/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));

    expect(screen.getByText(/submit report/i)).toBeInTheDocument();
    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();
  });

  it("deletes a reminder from the reminders screen", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "work-reminder",
        audioId: "audio-1",
        reminderText: "submit report",
        category: "Work",
        originalTranscript: "submit report Monday at 9",
        dueDate: "2099-01-01",
        dueTime: "09:00:00",
        dueAt: "2099-01-01T09:00:00.000Z",
        datePhrase: "Monday",
        timePhrase: "at 9",
        dateResolution: "weekday",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      {
        id: "shopping-reminder",
        audioId: "audio-2",
        reminderText: "buy milk",
        category: "Shopping",
        originalTranscript: "buy milk tomorrow at 8 AM",
        dueDate: "2099-01-01",
        dueTime: "08:00:00",
        dueAt: "2099-01-01T08:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /view all/i }));
    expect(await screen.findByText(/submit report/i)).toBeInTheDocument();
    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete submit report/i }));

    expect(deleteReminderMock).toHaveBeenCalledWith("work-reminder");
    await waitFor(() => expect(screen.queryByText(/submit report/i)).not.toBeInTheDocument());
    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();
  });

  it("strikes and removes a completed reminder from the reminders screen and home page", async () => {
    const user = userEvent.setup();
    let resolveComplete: () => void = () => {};

    completeReminderMock.mockReturnValue(
      new Promise((resolve) => {
        resolveComplete = () => resolve(null);
      }),
    );
    listRecentRemindersMock.mockResolvedValue([
      {
        id: "work-reminder",
        audioId: "audio-1",
        reminderText: "submit report",
        category: "Work",
        originalTranscript: "submit report Monday at 9",
        dueDate: "2099-01-01",
        dueTime: "09:00:00",
        dueAt: "2099-01-01T09:00:00.000Z",
        datePhrase: "Monday",
        timePhrase: "at 9",
        dateResolution: "weekday",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      {
        id: "shopping-reminder",
        audioId: "audio-2",
        reminderText: "buy milk",
        category: "Shopping",
        originalTranscript: "buy milk tomorrow at 8 AM",
        dueDate: "2099-01-01",
        dueTime: "08:00:00",
        dueAt: "2099-01-01T08:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /view all/i }));
    expect(await screen.findByText(/submit report/i)).toBeInTheDocument();
    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mark submit report complete/i }));

    expect(completeReminderMock).toHaveBeenCalledWith("work-reminder");
    expect(screen.getByLabelText(/future reminder: submit report/i)).toHaveClass("is-completing");

    resolveComplete();

    await waitFor(() => expect(screen.queryByText(/submit report/i)).not.toBeInTheDocument());
    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /record/i }));

    expect(screen.queryByText(/submit report/i)).not.toBeInTheDocument();
    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();
  });

  it("opens the reschedule screen from the reminders screen", async () => {
    const user = userEvent.setup();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "work-reminder",
        audioId: "audio-1",
        reminderText: "submit report",
        category: "Work",
        originalTranscript: "submit report Monday at 9",
        dueDate: "2099-01-01",
        dueTime: "09:00:00",
        dueAt: "2099-01-01T09:00:00.000Z",
        datePhrase: "Monday",
        timePhrase: "at 9",
        dateResolution: "weekday",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      {
        id: "shopping-reminder",
        audioId: "audio-2",
        reminderText: "buy milk",
        category: "Shopping",
        originalTranscript: "buy milk tomorrow at 8 AM",
        dueDate: "2099-01-01",
        dueTime: "08:00:00",
        dueAt: "2099-01-01T08:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /view all/i }));
    expect(await screen.findByText(/submit report/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reschedule submit report/i }));

    expect(screen.getByRole("heading", { name: /reschedule reminder/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/reschedule submit report/i)).toBeInTheDocument();
    expect(screen.getByText(/repeat every day/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/daily time/i)).toHaveValue("09:00");
    expect(screen.getByText(/specific days/i)).toBeInTheDocument();
    expect(screen.getByText(/monthly recurrence/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm reschedule/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByRole("heading", { name: /upcoming/i })).toBeInTheDocument();
    expect(screen.getByText(/submit report/i)).toBeInTheDocument();
  });

  it("opens the reminders screen from the bottom Reminders tab", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: /reminders/i }));

    expect(screen.getByRole("heading", { name: /upcoming/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reminders/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /record/i })).not.toHaveAttribute("aria-current");
    expect(screen.queryByText(/weekly project sync briefing/i)).not.toBeInTheDocument();
  });

  it("marks future reminders green and past reminders red based on due time", async () => {
    listRecentRemindersMock.mockResolvedValue([
      {
        id: "future-reminder",
        audioId: "audio-1",
        reminderText: "future reminder",
        originalTranscript: "future reminder",
        dueDate: "2099-01-01",
        dueTime: "09:00:00",
        dueAt: "2099-01-01T09:00:00.000Z",
        datePhrase: "future",
        timePhrase: "at 9 AM",
        dateResolution: "explicit_date",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      {
        id: "past-reminder",
        audioId: "audio-2",
        reminderText: "past reminder",
        originalTranscript: "past reminder",
        dueDate: "2000-01-01",
        dueTime: "09:00:00",
        dueAt: "2000-01-01T09:00:00.000Z",
        datePhrase: "past",
        timePhrase: "at 9 AM",
        dateResolution: "explicit_date",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByLabelText(/future reminder: future reminder/i)).toHaveClass("is-future");
    expect(screen.getByLabelText(/past reminder: past reminder/i)).toHaveClass("is-past");
  });

  it("changes a reminder from future to past once the due time passes", () => {
    const dueAt = "2026-07-04T05:30:00.000Z";

    expect(getReminderTimeState(dueAt, new Date("2026-07-04T05:29:59.999Z").getTime())).toBe("future");
    expect(getReminderTimeState(dueAt, new Date("2026-07-04T05:30:00.000Z").getTime())).toBe("past");
  });

  it("starts recording after microphone permission is granted", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();
    const getUserMedia = vi.fn().mockResolvedValue(stream);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await waitFor(() => expect(screen.getByText(/i'm listening/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /record audio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled();
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].state).toBe("recording");
  });

  it("stops the recorder and releases the microphone tracks", async () => {
    const user = userEvent.setup();
    const { stream, stop } = createMediaStreamMock();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/recording stopped/i)).toBeInTheDocument());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(saveAudioReminderMock).not.toHaveBeenCalled();
    expect(createReminderFromTranscriptMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeDisabled();
  });

  it("saves non-empty recorded audio when recording stops", async () => {
    const user = userEvent.setup();
    const { stream, stop } = createMediaStreamMock();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/audio saved/i)).toBeInTheDocument());
    expect(saveAudioReminderMock).toHaveBeenCalledTimes(1);
    expect(saveAudioReminderMock).toHaveBeenCalledWith({
      blob: expect.any(Blob),
      mimeType: "audio/webm",
      durationMs: expect.any(Number),
      transcriptText: null,
      transcriptStatus: "not_supported",
      transcriptError: "Speech recognition is not supported in this browser.",
      transcribedAt: null,
    });
    expect(screen.getByLabelText(/saved audio input/i)).toHaveTextContent(/saved/i);
    expect(screen.getByLabelText(/saved audio input/i)).toHaveTextContent(/audio-1/i);
    expect(screen.getByLabelText(/transcript status/i)).toHaveTextContent(/speech recognition not supported/i);
    expect(createReminderFromTranscriptMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/reminder status/i)).toHaveTextContent(/no completed transcript/i);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("saves browser speech recognition text with recorded audio", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
      transcriptText: "buy milk tomorrow at 8 AM",
      transcriptStatus: "completed",
      transcriptError: null,
      transcribedAt: "2026-06-27T00:00:00.000Z",
    });

    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    expect(MockSpeechRecognition.instances).toHaveLength(1);
    expect(MockSpeechRecognition.instances[0].continuous).toBe(true);
    expect(MockSpeechRecognition.instances[0].interimResults).toBe(true);
    expect(MockSpeechRecognition.instances[0].start).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/i'm listening/i)).toBeInTheDocument();

    MockSpeechRecognition.instances[0].emitResults([{ isFinal: true, transcript: "buy milk tomorrow at 8 AM" }]);
    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/audio saved/i)).toBeInTheDocument());
    expect(MockSpeechRecognition.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(saveAudioReminderMock).toHaveBeenCalledWith({
      blob: expect.any(Blob),
      mimeType: "audio/webm",
      durationMs: expect.any(Number),
      transcriptText: "buy milk tomorrow at 8 AM",
      transcriptStatus: "completed",
      transcriptError: null,
      transcribedAt: expect.any(String),
    });
    expect(createReminderFromTranscriptMock).toHaveBeenCalledWith({
      audioId: "audio-1",
      transcript: "buy milk tomorrow at 8 AM",
    });
    expect(screen.getByLabelText(/saved transcript/i)).toHaveTextContent(/buy milk tomorrow at 8 am/i);
    expect(screen.getByLabelText(/saved reminder/i)).toHaveTextContent(/reminder saved/i);
    expect(screen.getByLabelText(/saved reminder/i)).toHaveTextContent(/buy milk/i);
  });

  it("keeps existing reminders visible after saving a new reminder", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-2",
        audioId: "audio-2",
        reminderText: "call dad",
        category: "Personal",
        originalTranscript: "call dad tomorrow at 8 AM",
        dueDate: "2099-01-01",
        dueTime: "08:00:00",
        dueAt: "2099-01-01T08:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      {
        id: "reminder-3",
        audioId: "audio-3",
        reminderText: "submit report",
        category: "Work",
        originalTranscript: "submit report tomorrow at 9 AM",
        dueDate: "2099-01-01",
        dueTime: "09:00:00",
        dueAt: "2099-01-01T09:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 9 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "reminder-4",
        audioId: "audio-4",
        reminderText: "buy bread",
        category: "Shopping",
        originalTranscript: "buy bread tomorrow at 10 AM",
        dueDate: "2099-01-01",
        dueTime: "10:00:00",
        dueAt: "2099-01-01T10:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 10 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-26T00:00:00.000Z",
        updatedAt: "2026-06-26T00:00:00.000Z",
      },
    ]);
    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-29T00:00:00.000Z",
      transcriptText: "buy milk tomorrow at 8 AM",
      transcriptStatus: "completed",
      transcriptError: null,
      transcribedAt: "2026-06-29T00:00:00.000Z",
    });
    createReminderFromTranscriptMock.mockResolvedValue({
      ok: true,
      reminder: {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "buy milk",
        category: "Shopping",
        originalTranscript: "buy milk tomorrow at 8 AM",
        dueDate: "2099-01-01",
        dueTime: "08:00:00",
        dueAt: "2099-01-01T08:00:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 8 AM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    });

    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/call dad/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockSpeechRecognition.instances[0].emitResults([{ isFinal: true, transcript: "buy milk tomorrow at 8 AM" }]);
    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByLabelText(/saved reminder/i)).toHaveTextContent(/buy milk/i));
    await user.click(screen.getByRole("button", { name: /view all/i }));

    expect(screen.getByText(/buy milk/i)).toBeInTheDocument();
    expect(screen.getByText(/call dad/i)).toBeInTheDocument();
    expect(screen.getByText(/submit report/i)).toBeInTheDocument();
    expect(screen.getByText(/buy bread/i)).toBeInTheDocument();
  });

  it("uses interim speech recognition text when final text is not emitted before stopping", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
      transcriptText: "buy milk tomorrow at 8 AM",
      transcriptStatus: "completed",
      transcriptError: null,
      transcribedAt: "2026-06-27T00:00:00.000Z",
    });

    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockSpeechRecognition.instances[0].emitResults([{ isFinal: false, transcript: "buy milk tomorrow at 8 AM" }]);
    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/audio saved/i)).toBeInTheDocument());
    expect(saveAudioReminderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptText: "buy milk tomorrow at 8 AM",
        transcriptStatus: "completed",
        transcriptError: null,
      }),
    );
    expect(createReminderFromTranscriptMock).toHaveBeenCalledWith({
      audioId: "audio-1",
      transcript: "buy milk tomorrow at 8 AM",
    });
  });

  it("shows a reminder status when a completed transcript cannot become a future reminder", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
      transcriptText: "buy milk",
      transcriptStatus: "completed",
      transcriptError: null,
      transcribedAt: "2026-06-27T00:00:00.000Z",
    });
    createReminderFromTranscriptMock.mockResolvedValue({
      ok: false,
      error: "missing_time",
      originalTranscript: "buy milk",
    });

    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockSpeechRecognition.instances[0].emitResults([{ isFinal: true, transcript: "buy milk" }]);
    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/audio saved/i)).toBeInTheDocument());
    expect(createReminderFromTranscriptMock).toHaveBeenCalledWith({
      audioId: "audio-1",
      transcript: "buy milk",
    });
    expect(screen.getByLabelText(/reminder status/i)).toHaveTextContent(/no time was found/i);
    expect(screen.queryByLabelText(/saved reminder/i)).not.toBeInTheDocument();
  });

  it("saves an empty transcript status when recognition returns no final text", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
      transcriptText: null,
      transcriptStatus: "empty",
      transcriptError: null,
      transcribedAt: null,
    });

    Object.defineProperty(globalThis, "webkitSpeechRecognition", {
      configurable: true,
      writable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/audio saved/i)).toBeInTheDocument());
    expect(saveAudioReminderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptText: null,
        transcriptStatus: "empty",
        transcriptError: null,
        transcribedAt: null,
      }),
    );
    expect(createReminderFromTranscriptMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/transcript status/i)).toHaveTextContent(/no transcript captured/i);
  });

  it("saves a failed transcript status when speech recognition errors", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
      transcriptText: null,
      transcriptStatus: "failed",
      transcriptError: "Speech permission blocked",
      transcribedAt: null,
    });

    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockSpeechRecognition.instances[0].emitError("not-allowed", "Speech permission blocked");
    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/audio saved/i)).toBeInTheDocument());
    expect(saveAudioReminderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptText: null,
        transcriptStatus: "failed",
        transcriptError: "Speech permission blocked",
        transcribedAt: null,
      }),
    );
    expect(createReminderFromTranscriptMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/transcript status/i)).toHaveTextContent(/speech permission blocked/i);
  });

  it("shows a saving state while the audio record is being created", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();
    let resolveSave: (value: Awaited<ReturnType<typeof saveAudioReminder>>) => void = () => {};

    saveAudioReminderMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/saving audio/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /record audio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeDisabled();

    resolveSave({
      id: "audio-2",
      storagePath: "audio/audio-2.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
      transcriptText: null,
      transcriptStatus: "not_supported",
      transcriptError: null,
      transcribedAt: null,
    });

    await waitFor(() => expect(screen.getByText(/audio saved/i)).toBeInTheDocument());
  });

  it("shows a save error when the audio record cannot be created", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    saveAudioReminderMock.mockRejectedValue({ message: "Supabase save failed" });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());

    MockMediaRecorder.instances[0].emitData(new Blob(["voice input"], { type: "audio/webm" }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/unable to save audio/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/audio save error/i)).toHaveTextContent(/supabase save failed/i);
    expect(screen.queryByLabelText(/saved audio input/i)).not.toBeInTheDocument();
    expect(createReminderFromTranscriptMock).not.toHaveBeenCalled();
  });

  it("does not accept an empty recording as voice input", async () => {
    const user = userEvent.setup();
    const { stream } = createMediaStreamMock();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop recording/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getByText(/recording stopped/i)).toBeInTheDocument());
    expect(saveAudioReminderMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/saved audio input/i)).not.toBeInTheDocument();
  });

  it("shows unsupported browser feedback when recording APIs are missing", async () => {
    const user = userEvent.setup();

    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));

    expect(screen.getByText(/audio recording is not supported/i)).toBeInTheDocument();
  });

  it("shows permission-denied feedback when microphone access is denied", async () => {
    const user = userEvent.setup();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
      },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));

    await waitFor(() => expect(screen.getByText(/microphone permission was denied/i)).toBeInTheDocument());
  });

  it("releases microphone tracks and shows an error when the recorder fails", async () => {
    const user = userEvent.setup();
    const { stream, stop } = createMediaStreamMock();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /record audio/i }));
    await waitFor(() => expect(screen.getByText(/i'm listening/i)).toBeInTheDocument());

    MockMediaRecorder.instances[0].emitError();

    await waitFor(() => expect(screen.getByText(/unable to start recording/i)).toBeInTheDocument());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeDisabled();
  });
});

function getSelectOptionLabels(element: HTMLElement) {
  return Array.from((element as HTMLSelectElement).options, (option) => option.textContent);
}
