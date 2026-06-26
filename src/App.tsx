import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

type RecordingStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "stopped"
  | "unsupported"
  | "permission-denied"
  | "error";

const statusCopy: Record<RecordingStatus, string> = {
  idle: "Ready to record",
  "requesting-permission": "Requesting microphone",
  recording: "Recording",
  stopped: "Recording stopped",
  unsupported: "Audio recording is not supported in this browser",
  "permission-denied": "Microphone permission was denied",
  error: "Unable to start recording",
};

export function App() {
  return <HomePage />;
}

function HomePage() {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isRecording = status === "recording";
  const isBusy = status === "requesting-permission";

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  async function startRecording() {
    if (isBusy || isRecording) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("unsupported");
      return;
    }

    try {
      setStatus("requesting-permission");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        setStatus("stopped");
      });

      recorder.start();
      setStatus("recording");
    } catch (error) {
      releaseStream();

      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
        setStatus("permission-denied");
        return;
      }

      setStatus("error");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else if (status === "recording") {
      setStatus("stopped");
    }

    mediaRecorderRef.current = null;
    releaseStream();
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <h1>Personal Reminder Creator</h1>
      </header>

      <main className="home-page" aria-labelledby="home-title">
        <section className="voice-panel" aria-live="polite">
          <p className="status-label">{statusCopy[status]}</p>

          <div className={`waveform ${isRecording ? "is-active" : ""}`} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>

          <button
            className={`record-button ${isRecording ? "is-recording" : ""}`}
            type="button"
            onClick={startRecording}
            disabled={isBusy || isRecording}
            aria-label="Record Audio"
          >
            <Mic aria-hidden="true" size={38} strokeWidth={1.8} />
            <span>Record Audio</span>
          </button>

          <button className="stop-button" type="button" onClick={stopRecording} disabled={!isRecording}>
            <Square aria-hidden="true" size={18} fill="currentColor" />
            <span>Stop Recording</span>
          </button>
        </section>

        <section className="context-panel" aria-labelledby="home-title">
          <p className="eyebrow">Voice capture</p>
          <h2 id="home-title">Create reminders with your voice</h2>
          <p>Start a focused recording session from the home page. Reminder storage and editing arrive in a later flow.</p>
        </section>
      </main>
    </div>
  );
}
