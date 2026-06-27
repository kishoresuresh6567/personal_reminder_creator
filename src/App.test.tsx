import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { saveAudioReminder } from "./audioStorage";

vi.mock("./audioStorage", () => ({
  saveAudioReminder: vi.fn(),
}));

const saveAudioReminderMock = vi.mocked(saveAudioReminder);

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

  beforeEach(() => {
    MockMediaRecorder.instances = [];
    vi.restoreAllMocks();
    saveAudioReminderMock.mockClear();
    saveAudioReminderMock.mockResolvedValue({
      id: "audio-1",
      storagePath: "audio/audio-1.webm",
      mimeType: "audio/webm",
      durationMs: 1000,
      sizeBytes: 11,
      createdAt: "2026-06-27T00:00:00.000Z",
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: originalMediaRecorder,
    });
  });

  it("renders the home page title and recording controls", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /personal reminder creator/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record audio/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeDisabled();
    expect(screen.getByText(/ready to record/i)).toBeInTheDocument();
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
    });
    expect(screen.getByLabelText(/saved audio input/i)).toHaveTextContent(/saved/i);
    expect(screen.getByLabelText(/saved audio input/i)).toHaveTextContent(/audio-1/i);
    expect(stop).toHaveBeenCalledTimes(1);
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
