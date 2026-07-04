import { useEffect, useRef, useState } from "react";
import { Calendar, Check, Clock, ListTodo, Menu, Mic, Search, Settings, Square, Trash2 } from "lucide-react";
import { saveAudioReminder, type AudioReminderRecord } from "./audioStorage";
import { createReminderFromTranscript, listRecentReminders, type ReminderRecord } from "./reminderStorage";
import { createSpeechRecognitionSession, type SpeechRecognitionSession, type TranscriptSnapshot } from "./speechRecognition";

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

type AppView = "record" | "reminders";

interface CapturedAudioInput {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  transcript: TranscriptSnapshot;
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
  const [savedReminder, setSavedReminder] = useState<ReminderRecord | null>(null);
  const [recentReminders, setRecentReminders] = useState<ReminderRecord[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeView, setActiveView] = useState<AppView>("record");
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const speechRecognitionSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const [transcriptSnapshot, setTranscriptSnapshot] = useState<TranscriptSnapshot | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "requesting-permission" || status === "saving";

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    listRecentReminders(20)
      .then((reminders) => {
        if (isActive) {
          setRecentReminders(reminders);
        }
      })
      .catch(() => {
        if (isActive) {
          setRecentReminders([]);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
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
      setSavedReminder(null);
      setReminderMessage(null);
      setSaveErrorMessage(null);
      setTranscriptSnapshot(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const speechRecognitionSession = createSpeechRecognitionSession();

      chunksRef.current = [];
      recordingStartedAtRef.current = null;
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      speechRecognitionSessionRef.current = speechRecognitionSession;

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
        setSavedReminder(null);
        setReminderMessage(null);
        setSaveErrorMessage(null);
        setTranscriptSnapshot(null);
        speechRecognitionSessionRef.current?.stop();
        speechRecognitionSessionRef.current = null;
        setStatus("recording-error");
      });

      recorder.start();
      setTranscriptSnapshot(speechRecognitionSession.start());
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
    const transcript = speechRecognitionSessionRef.current?.stop() ?? createTranscriptSnapshot("not_supported");

    mediaRecorderRef.current = null;
    releaseStream();
    recordingStartedAtRef.current = null;
    speechRecognitionSessionRef.current = null;
    setTranscriptSnapshot(transcript);

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
      transcript,
    };

    setStatus("saving");

    try {
      const audioRecord = await saveAudioReminder({
        blob: capturedAudioInput.blob,
        mimeType: capturedAudioInput.mimeType,
        durationMs: capturedAudioInput.durationMs,
        transcriptText: capturedAudioInput.transcript.text,
        transcriptStatus: capturedAudioInput.transcript.status,
        transcriptError: capturedAudioInput.transcript.error,
        transcribedAt: capturedAudioInput.transcript.transcribedAt,
      });
      setSavedAudioRecord(audioRecord);
      await createReminderForAudio(audioRecord);
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

  async function createReminderForAudio(audioRecord: AudioReminderRecord) {
    setSavedReminder(null);

    if (audioRecord.transcriptStatus !== "completed" || !audioRecord.transcriptText) {
      setReminderMessage("Reminder not created because no completed transcript is available");
      return;
    }

    try {
      const result = await createReminderFromTranscript({
        audioId: audioRecord.id,
        transcript: audioRecord.transcriptText,
      });

      if (result.ok) {
        setSavedReminder(result.reminder);
        setRecentReminders((currentReminders) => [
          result.reminder,
          ...currentReminders.filter((reminder) => reminder.id !== result.reminder.id),
        ].slice(0, 3));
        setReminderMessage(null);
        return;
      }

      setReminderMessage(getReminderParseMessage(result.error));
    } catch (error) {
      setReminderMessage(getErrorMessage(error));
    }
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <button className="icon-button" type="button" aria-label="Open navigation">
          <Menu aria-hidden="true" size={24} />
        </button>
        <h1>Personal Reminder Creator</h1>
        <span className="top-bar-spacer" aria-hidden="true" />
      </header>

      {activeView === "record" ? (
        <main className="home-page" aria-labelledby="recent-reminders-title">
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
              <span>Record</span>
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

            {isRecording && transcriptSnapshot?.status === "empty" ? (
              <p className="capture-summary" aria-label="Transcript listening status">
                Listening for transcript
              </p>
            ) : null}

            {savedAudioRecord ? <TranscriptSummary audioRecord={savedAudioRecord} /> : null}

            {savedReminder ? (
              <p className="capture-summary" aria-label="Saved reminder">
                Reminder saved - {savedReminder.reminderText} - {formatReminderDueAt(savedReminder.dueAt)}
              </p>
            ) : null}

            {reminderMessage ? (
              <p className="capture-summary" aria-label="Reminder status">
                {reminderMessage}
              </p>
            ) : null}

            {saveErrorMessage ? (
              <p className="capture-summary is-error" aria-label="Audio save error">
                {saveErrorMessage}
              </p>
            ) : null}
          </section>

          <RecentReminders reminders={recentReminders.slice(0, 3)} nowMs={nowMs} onViewAll={() => setActiveView("reminders")} />

          <section className="quote-panel" aria-label="Voice reminder insight">
            <p>"Reminders created with voice are 3x faster than typing."</p>
          </section>
        </main>
      ) : (
        <RemindersScreen reminders={recentReminders} nowMs={nowMs} />
      )}

      <PrimaryNav activeView={activeView} onChangeView={setActiveView} />
    </div>
  );
}

function formatDuration(durationMs: number) {
  return `${Math.max(0, Math.round(durationMs / 1000))}s`;
}

function TranscriptSummary({ audioRecord }: { audioRecord: AudioReminderRecord }) {
  if (audioRecord.transcriptStatus === "completed" && audioRecord.transcriptText) {
    return (
      <p className="transcript-summary" aria-label="Saved transcript">
        {audioRecord.transcriptText}
      </p>
    );
  }

  const message = getTranscriptStatusMessage(audioRecord);

  return message ? (
    <p className="capture-summary" aria-label="Transcript status">
      {message}
    </p>
  ) : null;
}

function RecentReminders({
  reminders,
  nowMs,
  onViewAll,
}: {
  reminders: ReminderRecord[];
  nowMs: number;
  onViewAll: () => void;
}) {
  return (
    <section className="recent-reminders" id="recent-reminders" aria-labelledby="recent-reminders-title">
      <div className="section-heading">
        <h2 id="recent-reminders-title">Recent Reminders</h2>
        <button type="button" onClick={onViewAll}>
          View all
        </button>
      </div>

      <div className="reminder-list">
        {reminders.length > 0 ? (
          reminders.map((reminder) => <ReminderCard key={reminder.id} reminder={reminder} nowMs={nowMs} />)
        ) : (
          <p className="empty-reminders">Recorded reminders will appear here after a transcript includes a future time.</p>
        )}
      </div>
    </section>
  );
}

function RemindersScreen({ reminders, nowMs }: { reminders: ReminderRecord[]; nowMs: number }) {
  return (
    <main className="reminders-page" aria-labelledby="reminders-title">
      <section className="reminder-search" aria-label="Search reminders">
        <Search aria-hidden="true" size={20} />
        <input type="search" placeholder="Search your voice reminders..." aria-label="Search your voice reminders" />
      </section>

      <section className="category-filter" aria-label="Reminder categories">
        {["All", "Personal", "Work", "Shopping", "Ideas"].map((category, index) => (
          <button className={index === 0 ? "is-active" : ""} type="button" key={category}>
            {category}
          </button>
        ))}
      </section>

      <section className="all-reminders" aria-labelledby="reminders-title">
        <h2 id="reminders-title">
          <ListTodo aria-hidden="true" size={24} />
          Upcoming
        </h2>

        <div className="reminders-screen-list">
          {reminders.length > 0 ? (
            reminders.map((reminder) => <ReminderCard key={reminder.id} reminder={reminder} nowMs={nowMs} />)
          ) : (
            <p className="empty-reminders is-full-page">
              No recorded reminders yet. Use Record to create one from your voice.
            </p>
          )}
        </div>
      </section>

      <div className="reminders-end" aria-hidden="true">
        <span />
        <p>End of Reminders</p>
      </div>
    </main>
  );
}

function PrimaryNav({ activeView, onChangeView }: { activeView: AppView; onChangeView: (view: AppView) => void }) {
  return (
    <nav className="bottom-toolbar" aria-label="Primary">
      <a
        className={`toolbar-item ${activeView === "reminders" ? "is-active" : ""}`}
        href="#reminders-title"
        aria-current={activeView === "reminders" ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          onChangeView("reminders");
        }}
      >
        <ListTodo aria-hidden="true" size={22} />
        <span>Reminders</span>
      </a>
      <a
        className={`toolbar-item ${activeView === "record" ? "is-active" : ""}`}
        href="#recent-reminders-title"
        aria-current={activeView === "record" ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          onChangeView("record");
        }}
      >
        <Mic aria-hidden="true" size={22} />
        <span>Record</span>
      </a>
      <a className="toolbar-item" href="#settings">
        <Settings aria-hidden="true" size={22} />
        <span>Settings</span>
      </a>
    </nav>
  );
}

function ReminderCard({ reminder, nowMs }: { reminder: ReminderRecord; nowMs: number }) {
  const timeState = getReminderTimeState(reminder.dueAt, nowMs);
  const age = formatReminderAge(reminder.createdAt);
  const dueTime = formatReminderTime(reminder.dueAt);
  const timeStateLabel = timeState === "past" ? "Past" : "Future";

  return (
    <article className={`reminder-card is-${timeState}`} aria-label={`${timeStateLabel} reminder: ${reminder.reminderText}`}>
      <div className="reminder-content">
        <p>{reminder.reminderText}</p>
        <div className="reminder-meta">
          <span className="reminder-tag">{getReminderTag(reminder)}</span>
        </div>
      </div>

      <div className="reminder-control-stack">
        <div className="reminder-actions" aria-label={`Actions for ${reminder.reminderText}`}>
          <button type="button" aria-label={`Delete ${reminder.reminderText}`}>
            <Trash2 aria-hidden="true" size={16} />
          </button>
          <button type="button" aria-label={`Schedule ${reminder.reminderText}`}>
            <Calendar aria-hidden="true" size={16} />
          </button>
          <button className="complete-button" type="button" aria-label={`Mark ${reminder.reminderText} complete`}>
            <Check aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="reminder-time-row">
          <span>{age}</span>
          <span className="reminder-clock">
            <Clock aria-hidden="true" size={12} />
            {dueTime}
          </span>
        </div>
      </div>
    </article>
  );
}

function getReminderTag(reminder: ReminderRecord) {
  if (reminder.id.includes("groceries")) {
    return "Shopping";
  }

  if (reminder.id.includes("report") || reminder.id.includes("sync")) {
    return "Work";
  }

  if (reminder.id.includes("ingredients")) {
    return "Home";
  }

  return "Personal";
}

function formatReminderAge(createdAt: string) {
  const createdTime = new Date(createdAt).getTime();

  if (Number.isNaN(createdTime)) {
    return "Recently";
  }

  const elapsedMs = Date.now() - createdTime;
  const elapsedHours = Math.max(0, Math.round(elapsedMs / 3_600_000));

  if (elapsedHours < 1) {
    return "Just now";
  }

  if (elapsedHours < 24) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  }

  const elapsedDays = Math.round(elapsedHours / 24);

  if (elapsedDays === 1) {
    return "Yesterday";
  }

  return `${elapsedDays} days ago`;
}

function formatReminderTime(dueAt: string) {
  const dueDate = new Date(dueAt);

  if (Number.isNaN(dueDate.getTime())) {
    return "10:30 AM";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(dueDate);
}

export function getReminderTimeState(dueAt: string, nowMs: number): "future" | "past" {
  const dueMs = new Date(dueAt).getTime();

  if (Number.isNaN(dueMs)) {
    return "future";
  }

  return dueMs <= nowMs ? "past" : "future";
}

function getTranscriptStatusMessage(audioRecord: AudioReminderRecord) {
  if (audioRecord.transcriptStatus === "not_supported") {
    return "Speech recognition not supported in this browser";
  }

  if (audioRecord.transcriptStatus === "empty") {
    return "No transcript captured";
  }

  if (audioRecord.transcriptStatus === "failed") {
    return audioRecord.transcriptError || "Speech recognition failed";
  }

  return null;
}

function getReminderParseMessage(error: string) {
  const messages: Record<string, string> = {
    empty_transcript: "Reminder not created because transcript is empty",
    empty_reminder_text: "Reminder not created because no reminder text was found",
    missing_time: "Reminder not created because no time was found",
    missing_date: "Reminder not created because no date was found",
    past_due: "Reminder not created because the due time is in the past",
    invalid_date: "Reminder not created because the date could not be understood",
    invalid_time: "Reminder not created because the time could not be understood",
  };

  return messages[error] ?? "Reminder not created";
}

function formatReminderDueAt(dueAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dueAt));
}

function createTranscriptSnapshot(status: TranscriptSnapshot["status"]): TranscriptSnapshot {
  return {
    text: null,
    status,
    error: status === "not_supported" ? "Speech recognition is not supported in this browser." : null,
    transcribedAt: null,
  };
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
