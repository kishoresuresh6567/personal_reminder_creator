import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

class MockMediaRecorder extends EventTarget {
  static instances: MockMediaRecorder[] = [];

  state: RecordingState = "inactive";

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
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeDisabled();
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
});
