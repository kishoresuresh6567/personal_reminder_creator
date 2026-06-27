import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { saveAudioReminder, type AudioReminderRecord } from "./audioStorage";

type RecordingStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "saving"
  | "saved"
  | "stopped"
  | "unsupported"
  | "permission-denied"
  | "recording-error"
  | "save-error";

interface CapturedAudioInput {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const statusCopy: Record<RecordingStatus, string> = {
  idle: "Ready to record",
  "requesting-permission": "Requesting microphone",
  recording: "Recording",
  saving: "Saving audio",
  saved: "Audio saved",
  stopped: "Recording stopped",
  unsupported: "Audio recording is not supported in this browser",
  "permission-denied": "Microphone permission was denied",
  "recording-error": "Unable to start recording",
  "save-error": "Unable to save audio",
};

export function App() {
  return <HomePage />;
}

function HomePage() {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [savedAudioRecord, setSavedAudioRecord] = useState<AudioReminderRecord | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "requesting-permission" || status === "saving";

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
      setSavedAudioRecord(null);
      setSaveErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      chunksRef.current = [];
      recordingStartedAtRef.current = null;
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        void saveCapturedAudio(recorder);
      });

      recorder.addEventListener("error", () => {
        mediaRecorderRef.current = null;
        releaseStream();
        chunksRef.current = [];
        recordingStartedAtRef.current = null;
        setSavedAudioRecord(null);
        setSaveErrorMessage(null);
        setStatus("recording-error");
      });

      recorder.start();
      recordingStartedAtRef.current = performance.now();
      setStatus("recording");
    } catch (error) {
      releaseStream();
      chunksRef.current = [];
      recordingStartedAtRef.current = null;

      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
        setStatus("permission-denied");
        return;
      }

      setStatus("recording-error");
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

  async function saveCapturedAudio(recorder: MediaRecorder) {
    const chunks = chunksRef.current;
    const startedAt = recordingStartedAtRef.current;
    const mimeType = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || "audio/webm";

    mediaRecorderRef.current = null;
    releaseStream();
    recordingStartedAtRef.current = null;

    if (chunks.length === 0) {
      setSavedAudioRecord(null);
      setStatus("stopped");
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    chunksRef.current = [];

    if (blob.size === 0) {
      setSavedAudioRecord(null);
      setStatus("stopped");
      return;
    }

    const capturedAudioInput: CapturedAudioInput = {
      blob,
      mimeType,
      durationMs: startedAt === null ? 0 : Math.max(0, Math.round(performance.now() - startedAt)),
    };

    setStatus("saving");

    try {
      const audioRecord = await saveAudioReminder(capturedAudioInput);
      setSavedAudioRecord(audioRecord);
      setSaveErrorMessage(null);
      setStatus("saved");
    } catch (error) {
      setSavedAudioRecord(null);
      setSaveErrorMessage(getErrorMessage(error));
      setStatus("save-error");
    }
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

          {savedAudioRecord ? (
            <p className="capture-summary" aria-label="Saved audio input">
              Saved - {formatDuration(savedAudioRecord.durationMs)} - ID {savedAudioRecord.id}
            </p>
          ) : null}

          {saveErrorMessage ? (
            <p className="capture-summary is-error" aria-label="Audio save error">
              {saveErrorMessage}
            </p>
          ) : null}
        </section>

        <section className="context-panel" aria-labelledby="home-title">
          <p className="eyebrow">Voice capture</p>
          <h2 id="home-title">Create reminders with your voice</h2>
          <p>Start a focused recording session from the home page. Audio reminders are saved automatically when recording stops.</p>
        </section>
      </main>
    </div>
  );
}

function formatDuration(durationMs: number) {
  return `${Math.max(0, Math.round(durationMs / 1000))}s`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;

    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "The audio could not be saved. Check Supabase setup and try again.";
}
