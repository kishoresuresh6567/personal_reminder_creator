import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, getReminderTimeState } from "./App";
import { saveAudioReminder } from "./audioStorage";
import { createReminderFromTranscript, listRecentReminders } from "./reminderStorage";

vi.mock("./audioStorage", () => ({
  saveAudioReminder: vi.fn(),
}));

vi.mock("./reminderStorage", () => ({
  createReminderFromTranscript: vi.fn(),
  listRecentReminders: vi.fn(),
}));

const saveAudioReminderMock = vi.mocked(saveAudioReminder);
const createReminderFromTranscriptMock = vi.mocked(createReminderFromTranscript);
const listRecentRemindersMock = vi.mocked(listRecentReminders);

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
    createReminderFromTranscriptMock.mockClear();
    listRecentRemindersMock.mockClear();
    listRecentRemindersMock.mockResolvedValue([]);
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

  it("loads recent reminders into the recent reminders section", async () => {
    listRecentRemindersMock.mockResolvedValue([
      {
        id: "reminder-1",
        audioId: "audio-1",
        reminderText: "dry clothes",
        originalTranscript: "remind me to dry clothes tomorrow at 7 PM",
        dueDate: "2026-06-29",
        dueTime: "19:00:00",
        dueAt: "2026-06-29T13:30:00.000Z",
        datePhrase: "tomorrow",
        timePhrase: "at 7 PM",
        dateResolution: "relative_day",
        status: "pending",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
    ]);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/dry clothes/i)).toBeInTheDocument());
    expect(listRecentRemindersMock).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(screen.getByText(/^recording$/i)).toBeInTheDocument());
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
    expect(screen.getByLabelText(/transcript listening status/i)).toHaveTextContent(/listening for transcript/i);

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
    await waitFor(() => expect(screen.getByText(/^recording$/i)).toBeInTheDocument());

    MockMediaRecorder.instances[0].emitError();

    await waitFor(() => expect(screen.getByText(/unable to start recording/i)).toBeInTheDocument());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeDisabled();
  });
});
