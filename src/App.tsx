import { useEffect, useRef, useState } from "react";
import {
  AlarmClock,
  ArrowLeft,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Info,
  ListTodo,
  Menu,
  Mic,
  RefreshCw,
  Search,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import { saveAudioReminder, type AudioReminderRecord } from "./audioStorage";
import {
  completeReminder,
  createReminderFromTranscript,
  deleteReminder,
  listRecentReminders,
  rescheduleReminder,
  type ReminderRecord,
  type RescheduleReminderInput,
} from "./reminderStorage";
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

type AppView = "record" | "reminders" | "reschedule";
type ReturnableAppView = Exclude<AppView, "reschedule">;
type CategoryFilter = "All" | "Personal" | "Work" | "Shopping" | "Ideas";

interface CapturedAudioInput {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  transcript: TranscriptSnapshot;
}

const statusCopy: Record<RecordingStatus, string> = {
  idle: "Ready to record",
  "requesting-permission": "Requesting microphone",
  recording: "I'm listening...",
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
  const [completingReminderIds, setCompletingReminderIds] = useState<Set<string>>(() => new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeView, setActiveView] = useState<AppView>("record");
  const [rescheduleReturnView, setRescheduleReturnView] = useState<ReturnableAppView>("reminders");
  const [rescheduleReminderId, setRescheduleReminderId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("All");
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const speechRecognitionSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const [transcriptSnapshot, setTranscriptSnapshot] = useState<TranscriptSnapshot | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "requesting-permission" || status === "saving";
  const shellClassName = `app-shell ${activeView === "reminders" ? "is-reminders-view" : ""} ${
    activeView === "reschedule" ? "is-reschedule-view" : ""
  } ${
    isRecording ? "is-listening-view" : ""
  }`;

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    listRecentReminders(100)
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
        ]);
        setDeleteErrorMessage(null);
        setReminderMessage(null);
        return;
      }

      setReminderMessage(getReminderParseMessage(result.error));
    } catch (error) {
      setReminderMessage(getErrorMessage(error));
    }
  }

  async function handleDeleteReminder(reminderId: string) {
    try {
      await deleteReminder(reminderId);
      setRecentReminders((currentReminders) => currentReminders.filter((reminder) => reminder.id !== reminderId));
      setSavedReminder((currentReminder) => (currentReminder?.id === reminderId ? null : currentReminder));
      setCompletingReminderIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(reminderId);
        return nextIds;
      });
      setDeleteErrorMessage(null);
    } catch (error) {
      setDeleteErrorMessage(getErrorMessage(error));
    }
  }

  async function handleCompleteReminder(reminderId: string) {
    setCompletingReminderIds((currentIds) => new Set(currentIds).add(reminderId));

    try {
      const updatedReminder = await completeReminder(reminderId);

      if (updatedReminder) {
        setRecentReminders((currentReminders) =>
          currentReminders.map((reminder) => (reminder.id === updatedReminder.id ? updatedReminder : reminder)),
        );
        setSavedReminder((currentReminder) => (currentReminder?.id === updatedReminder.id ? updatedReminder : currentReminder));
      } else {
        setRecentReminders((currentReminders) => currentReminders.filter((reminder) => reminder.id !== reminderId));
        setSavedReminder((currentReminder) => (currentReminder?.id === reminderId ? null : currentReminder));
      }

      setCompletingReminderIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(reminderId);
        return nextIds;
      });
      setDeleteErrorMessage(null);
    } catch (error) {
      setCompletingReminderIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(reminderId);
        return nextIds;
      });
      setDeleteErrorMessage(getErrorMessage(error));
    }
  }

  async function handleConfirmReschedule(reminderId: string, input: RescheduleReminderInput) {
    const updatedReminder = await rescheduleReminder(reminderId, input);

    setRecentReminders((currentReminders) =>
      currentReminders.map((reminder) => (reminder.id === updatedReminder.id ? updatedReminder : reminder)),
    );
    setSavedReminder((currentReminder) => (currentReminder?.id === updatedReminder.id ? updatedReminder : currentReminder));

    return updatedReminder;
  }

  function handleRescheduleReminder(reminderId: string) {
    setRescheduleReminderId(reminderId);
    setRescheduleReturnView(activeView === "record" ? "record" : "reminders");
    setActiveView("reschedule");
  }

  function handleBackFromReschedule() {
    setActiveView(rescheduleReturnView);
  }

  function handleChangeView(view: AppView) {
    if (view !== "reschedule") {
      setRescheduleReminderId(null);
    }

    setActiveView(view);
  }

  return (
    <div className={shellClassName}>
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

            {isRecording ? <p className="stop-hint">Tap to finalize your reminder</p> : null}

            {savedAudioRecord ? (
              <p className="capture-summary" aria-label="Saved audio input">
                Saved - {formatDuration(savedAudioRecord.durationMs)} - ID {savedAudioRecord.id}
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

            {deleteErrorMessage ? (
              <p className="capture-summary is-error" aria-label="Reminder delete error">
                {deleteErrorMessage}
              </p>
            ) : null}
          </section>

          {!isRecording ? (
            <>
              <RecentReminders
                reminders={recentReminders.slice(0, 3)}
                completingReminderIds={completingReminderIds}
                nowMs={nowMs}
                onCompleteReminder={handleCompleteReminder}
                onDeleteReminder={handleDeleteReminder}
                onRescheduleReminder={handleRescheduleReminder}
                onViewAll={() => setActiveView("reminders")}
              />

              <section className="quote-panel" aria-label="Voice reminder insight">
                <p>"Reminders created with voice are 3x faster than typing."</p>
              </section>
            </>
          ) : null}
        </main>
      ) : activeView === "reminders" ? (
        <RemindersScreen
          reminders={recentReminders}
          completingReminderIds={completingReminderIds}
          nowMs={nowMs}
          activeCategory={activeCategory}
          onChangeCategory={setActiveCategory}
          onCompleteReminder={handleCompleteReminder}
          onDeleteReminder={handleDeleteReminder}
          onRescheduleReminder={handleRescheduleReminder}
        />
      ) : (
        <RescheduleScreen
          reminder={recentReminders.find((reminder) => reminder.id === rescheduleReminderId) ?? null}
          onBack={handleBackFromReschedule}
          onConfirmReschedule={handleConfirmReschedule}
        />
      )}

      <PrimaryNav activeView={activeView} onChangeView={handleChangeView} />
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
  completingReminderIds,
  nowMs,
  onViewAll,
  onCompleteReminder,
  onDeleteReminder,
  onRescheduleReminder,
}: {
  reminders: ReminderRecord[];
  completingReminderIds: Set<string>;
  nowMs: number;
  onViewAll: () => void;
  onCompleteReminder: (reminderId: string) => void;
  onDeleteReminder: (reminderId: string) => void;
  onRescheduleReminder: (reminderId: string) => void;
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
          reminders.map((reminder) => (
            <ReminderCard
              key={reminder.id}
              reminder={reminder}
              isCompleting={completingReminderIds.has(reminder.id)}
              nowMs={nowMs}
              onCompleteReminder={onCompleteReminder}
              onDeleteReminder={onDeleteReminder}
              onRescheduleReminder={onRescheduleReminder}
            />
          ))
        ) : (
          <p className="empty-reminders">Recorded reminders will appear here after a transcript includes a future time.</p>
        )}
      </div>
    </section>
  );
}

function RemindersScreen({
  reminders,
  completingReminderIds,
  nowMs,
  activeCategory,
  onChangeCategory,
  onCompleteReminder,
  onDeleteReminder,
  onRescheduleReminder,
}: {
  reminders: ReminderRecord[];
  completingReminderIds: Set<string>;
  nowMs: number;
  activeCategory: CategoryFilter;
  onChangeCategory: (category: CategoryFilter) => void;
  onCompleteReminder: (reminderId: string) => void;
  onDeleteReminder: (reminderId: string) => void;
  onRescheduleReminder: (reminderId: string) => void;
}) {
  const visibleReminders = getRemindersForCategory(reminders, activeCategory);

  return (
    <main className="reminders-page" aria-labelledby="reminders-title">
      <section className="reminder-search" aria-label="Search reminders">
        <Search aria-hidden="true" size={20} />
        <input type="search" placeholder="Search your voice reminders..." aria-label="Search your voice reminders" />
      </section>

      <section className="category-filter" aria-label="Reminder categories">
        {(["All", "Personal", "Work", "Shopping", "Ideas"] satisfies CategoryFilter[]).map((category) => (
          <button
            className={category === activeCategory ? "is-active" : ""}
            type="button"
            key={category}
            onClick={() => onChangeCategory(category)}
          >
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
          {visibleReminders.length > 0 ? (
            visibleReminders.map((reminder) => (
              <ReminderCard
                key={reminder.id}
                reminder={reminder}
                isCompleting={completingReminderIds.has(reminder.id)}
                nowMs={nowMs}
                onCompleteReminder={onCompleteReminder}
                onDeleteReminder={onDeleteReminder}
                onRescheduleReminder={onRescheduleReminder}
              />
            ))
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

type ScheduleMode = "daily" | "weekly" | "monthly";

const scheduleTimes = createScheduleTimes();
const scheduleMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekDayLabels = ["S", "M", "T", "W", "T", "F", "S"];

function RescheduleScreen({
  reminder,
  onBack,
  onConfirmReschedule,
}: {
  reminder: ReminderRecord | null;
  onBack: () => void;
  onConfirmReschedule: (reminderId: string, input: RescheduleReminderInput) => Promise<ReminderRecord>;
}) {
  const initialSchedule = reminder ? createInitialScheduleState(reminder) : null;
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("daily");
  const [dailyTime, setDailyTime] = useState(initialSchedule?.time ?? "09:00");
  const [weeklyTime, setWeeklyTime] = useState("14:30");
  const [selectedWeekdays, setSelectedWeekdays] = useState<boolean[]>(() => [false, true, false, false, false, false, false]);
  const [monthlyDay, setMonthlyDay] = useState(initialSchedule?.day ?? "29");
  const [monthlyMonth, setMonthlyMonth] = useState(initialSchedule?.month ?? "Oct");
  const [monthlyYear, setMonthlyYear] = useState(initialSchedule?.year ?? String(new Date().getFullYear()));
  const [monthlyTime, setMonthlyTime] = useState("18:00");
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const monthIndex = Math.max(0, scheduleMonths.indexOf(monthlyMonth));
  const yearOptions = createYearOptions(initialSchedule?.year);
  const monthlyDayOptions = createDayOptions(Number(monthlyYear), monthIndex);

  function toggleWeekday(index: number) {
    setScheduleMode("weekly");
    setSelectedWeekdays((currentDays) => {
      const nextDays = currentDays.map((isSelected, dayIndex) => (dayIndex === index ? !isSelected : isSelected));

      return nextDays.some(Boolean) ? nextDays : currentDays;
    });
  }

  async function confirmReschedule() {
    if (!reminder || isSavingSchedule) {
      return;
    }

    try {
      setIsSavingSchedule(true);
      setScheduleError(null);
      const updatedReminder = await onConfirmReschedule(reminder.id, createRescheduleInput());
      setScheduleMessage(`Your reminder has been rescheduled to ${formatReminderDueAt(updatedReminder.dueAt)}.`);
    } catch (error) {
      setScheduleError(getErrorMessage(error));
    } finally {
      setIsSavingSchedule(false);
    }
  }

  function createRescheduleInput(): RescheduleReminderInput {
    if (scheduleMode === "weekly") {
      const weekdayIndexes = getSelectedWeekdayIndexes(selectedWeekdays);
      const dueDate = getNextWeeklyDate(weekdayIndexes, weeklyTime);

      return createReschedulePayload(
        dueDate,
        weeklyTime,
        formatWeeklySchedulePhrase(weekdayIndexes),
        `at ${formatScheduleTimeLabel(weeklyTime)}`,
        "rescheduled_weekly",
      );
    }

    if (scheduleMode === "monthly") {
      const dueDate = formatDateParts(Number(monthlyYear), monthIndex, Number(monthlyDay));

      return createReschedulePayload(
        dueDate,
        monthlyTime,
        "monthly schedule",
        `at ${formatScheduleTimeLabel(monthlyTime)}`,
        "rescheduled_monthly",
      );
    }

    return createReschedulePayload(
      getNextDailyDate(dailyTime),
      dailyTime,
      "daily schedule",
      `at ${formatScheduleTimeLabel(dailyTime)}`,
      "rescheduled_daily",
    );
  }

  return (
    <main className="reschedule-page" aria-labelledby="reschedule-title">
      <div className="reschedule-topbar">
        <button className="reschedule-back-icon" type="button" aria-label="Back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <h2 id="reschedule-title">Reschedule Reminder</h2>
      </div>

      {reminder ? (
        <section className="reschedule-panel" aria-label={`Reschedule ${reminder.reminderText}`}>
          <section className="schedule-card is-daily" aria-label="Daily schedule">
            <div className="schedule-card-header">
              <div className="schedule-title-group">
                <span className="schedule-icon is-green">
                  <RefreshCw aria-hidden="true" size={14} />
                </span>
                <span>
                  <strong>Repeat Every Day</strong>
                  <small>Simple consistent reminders</small>
                </span>
              </div>
              <button
                className={`toggle-switch ${scheduleMode === "daily" ? "is-on" : ""}`}
                type="button"
                aria-label="Daily schedule"
                aria-pressed={scheduleMode === "daily"}
                onClick={() => setScheduleMode("daily")}
              />
            </div>

            <label className="schedule-input-row">
              <select
                aria-label="Daily time"
                value={dailyTime}
                onChange={(event) => {
                  setScheduleMode("daily");
                  setDailyTime(event.target.value);
                }}
              >
                  {getTimeOptions(dailyTime).map((time) => (
                    <option value={time} key={time}>
                      {formatScheduleTimeLabel(time)}
                    </option>
                  ))}
              </select>
              <span className="schedule-input-icons">
                <Clock aria-hidden="true" size={13} />
                <ChevronDown aria-hidden="true" size={13} />
              </span>
            </label>
          </section>

          <section className="schedule-section" aria-label="Weekly schedule">
            <p className="schedule-section-label">Weekly Schedule</p>
            <div className="schedule-card">
              <div className="schedule-card-header">
                <div className="schedule-title-group">
                  <span className="schedule-icon is-blue">
                    <CalendarDays aria-hidden="true" size={14} />
                  </span>
                  <span>
                    <strong>Specific Days</strong>
                    <small>Custom weekly patterns</small>
                  </span>
                </div>
                <button
                  className={`toggle-switch ${scheduleMode === "weekly" ? "is-on" : ""}`}
                  type="button"
                  aria-label="Weekly schedule"
                  aria-pressed={scheduleMode === "weekly"}
                  onClick={() => setScheduleMode("weekly")}
                />
              </div>

              <div className="weekday-grid" aria-label="Selected weekdays">
                {weekDayLabels.map((day, index) => (
                  <button
                    className={selectedWeekdays[index] ? "is-selected" : ""}
                    type="button"
                    aria-label={`Toggle ${getWeekdayName(index)}`}
                    aria-pressed={selectedWeekdays[index]}
                    key={`${day}-${index}`}
                    onClick={() => toggleWeekday(index)}
                  >
                    {day}
                  </button>
                ))}
              </div>

              <label className="schedule-input-row">
                <select
                  aria-label="Weekly time"
                  value={weeklyTime}
                  onChange={(event) => {
                    setScheduleMode("weekly");
                    setWeeklyTime(event.target.value);
                  }}
                >
                  {getTimeOptions(weeklyTime).map((time) => (
                    <option value={time} key={time}>
                      {formatScheduleTimeLabel(time)}
                    </option>
                  ))}
                </select>
                <span className="schedule-input-icons">
                  <Clock aria-hidden="true" size={13} />
                  <ChevronDown aria-hidden="true" size={13} />
                </span>
              </label>
            </div>
          </section>

          <section className="schedule-section" aria-label="Monthly schedule">
            <p className="schedule-section-label">Monthly Schedule</p>
            <div className="schedule-card">
              <div className="schedule-card-header">
                <div className="schedule-title-group">
                  <span className="schedule-icon is-red">
                    <Calendar aria-hidden="true" size={14} />
                  </span>
                  <span>
                    <strong>Monthly Recurrence</strong>
                    <small>Once every month</small>
                  </span>
                </div>
                <button
                  className={`toggle-switch ${scheduleMode === "monthly" ? "is-on" : ""}`}
                  type="button"
                  aria-label="Monthly schedule"
                  aria-pressed={scheduleMode === "monthly"}
                  onClick={() => setScheduleMode("monthly")}
                />
              </div>

              <div className="monthly-grid">
                <label className="schedule-input-row">
                  <select
                    aria-label="Monthly day"
                    value={monthlyDay}
                    onChange={(event) => {
                      setScheduleMode("monthly");
                      setMonthlyDay(event.target.value);
                    }}
                  >
                    {monthlyDayOptions.map((day) => (
                      <option value={day} key={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" size={13} />
                </label>
                <label className="schedule-input-row">
                  <select
                    aria-label="Monthly time"
                    value={monthlyTime}
                    onChange={(event) => {
                      setScheduleMode("monthly");
                      setMonthlyTime(event.target.value);
                    }}
                  >
                    {getTimeOptions(monthlyTime).map((time) => (
                      <option value={time} key={time}>
                        {formatScheduleTimeLabel(time)}
                      </option>
                    ))}
                  </select>
                  <span className="schedule-input-icons">
                    <Clock aria-hidden="true" size={13} />
                    <ChevronDown aria-hidden="true" size={13} />
                  </span>
                </label>
                <label className="schedule-input-row">
                  <select
                    aria-label="Monthly month"
                    value={monthlyMonth}
                    onChange={(event) => {
                      setScheduleMode("monthly");
                      setMonthlyMonth(event.target.value);
                      setMonthlyDay((currentDay) =>
                        String(Math.min(Number(currentDay), getDaysInMonth(Number(monthlyYear), scheduleMonths.indexOf(event.target.value)))),
                      );
                    }}
                  >
                    {scheduleMonths.map((month) => (
                      <option value={month} key={month}>
                        {month}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" size={13} />
                </label>
                <label className="schedule-input-row">
                  <select
                    aria-label="Monthly year"
                    value={monthlyYear}
                    onChange={(event) => {
                      setScheduleMode("monthly");
                      setMonthlyYear(event.target.value);
                      setMonthlyDay((currentDay) => String(Math.min(Number(currentDay), getDaysInMonth(Number(event.target.value), monthIndex))));
                    }}
                  >
                    {yearOptions.map((year) => (
                      <option value={year} key={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" size={13} />
                </label>
              </div>
            </div>
          </section>

          <section className="schedule-info" aria-label="Reschedule update notice">
            <Info aria-hidden="true" size={15} />
            <p>
              This reminder will be updated globally. You'll receive a push notification 5 minutes prior to the new scheduled time.
            </p>
          </section>

          {scheduleMessage ? (
            <section className="schedule-success" aria-label="Reschedule success">
              <h3>Rescheduled!</h3>
              <p>{scheduleMessage}</p>
            </section>
          ) : null}

          {scheduleError ? (
            <p className="schedule-error" aria-label="Reschedule error">
              {scheduleError}
            </p>
          ) : null}

          <button className="confirm-reschedule-button" type="button" onClick={confirmReschedule} disabled={isSavingSchedule}>
            {isSavingSchedule ? "Saving..." : "Confirm Reschedule"}
            <CheckCircle2 aria-hidden="true" size={16} />
          </button>

          <button className="discard-reschedule-button" type="button" onClick={onBack}>
            Discard Changes
          </button>
        </section>
      ) : (
        <section className="reschedule-panel" aria-label="Reschedule reminder details">
          <div className="reschedule-empty">
            <p className="empty-reminders is-full-page">This reminder is no longer available.</p>
          </div>
        </section>
      )}
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
      <a className="toolbar-item" href="#alarm">
        <AlarmClock aria-hidden="true" size={22} />
        <span>Alarm</span>
      </a>
      <a className="toolbar-item" href="#settings">
        <Settings aria-hidden="true" size={22} />
        <span>Settings</span>
      </a>
    </nav>
  );
}

function formatTimeForScheduleField(dueTime: string) {
  const timeParts = dueTime.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);

  if (!timeParts) {
    return "09:00";
  }

  return `${timeParts[1]}:${timeParts[2]}`;
}

function createInitialScheduleState(reminder: ReminderRecord) {
  return {
    time: formatTimeForScheduleField(reminder.dueTime),
    day: formatDayForScheduleField(reminder.dueDate),
    month: formatMonthForScheduleField(reminder.dueDate),
    year: formatYearForScheduleField(reminder.dueDate),
  };
}

function createReschedulePayload(
  dueDate: string,
  time: string,
  datePhrase: string,
  timePhrase: string,
  dateResolution: string,
): RescheduleReminderInput {
  const dueTime = `${time}:00`;

  return {
    dueDate,
    dueTime,
    dueAt: combineDateAndScheduleTime(dueDate, time),
    datePhrase,
    timePhrase,
    dateResolution,
  };
}

function getTimeOptions(selectedTime: string) {
  return scheduleTimes.includes(selectedTime) ? scheduleTimes : [...scheduleTimes, selectedTime];
}

function createScheduleTimes() {
  return Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2);
    const minute = index % 2 === 0 ? 0 : 30;

    return `${padTwoDigits(hour)}:${padTwoDigits(minute)}`;
  });
}

function formatScheduleTimeLabel(time: string) {
  const timeParts = time.match(/^(\d{2}):(\d{2})$/);

  if (!timeParts) {
    return time;
  }

  const [, hour, minute] = timeParts;

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(2000, 0, 1, Number(hour), Number(minute)));
}

function createDayOptions(year: number, monthIndex: number) {
  return Array.from({ length: getDaysInMonth(year, monthIndex) }, (_, index) => String(index + 1));
}

function createYearOptions(selectedYear?: string) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3];

  if (selectedYear) {
    years.push(Number(selectedYear));
  }

  return [...new Set(years)].sort((firstYear, secondYear) => firstYear - secondYear).map(String);
}

function getDaysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getNextWeekdayDate(weekdayIndex: number, time: string) {
  const now = new Date();
  const [hour, minute] = time.split(":").map(Number);
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  const dayOffset = (weekdayIndex - candidate.getDay() + 7) % 7;

  candidate.setDate(candidate.getDate() + dayOffset);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }

  return formatDate(candidate);
}

function getNextWeeklyDate(weekdayIndexes: number[], time: string) {
  const dueDates = weekdayIndexes.map((weekdayIndex) => getNextWeekdayDate(weekdayIndex, time));

  return dueDates.sort()[0] ?? getNextWeekdayDate(1, time);
}

function getSelectedWeekdayIndexes(selectedWeekdays: boolean[]) {
  const selectedIndexes = selectedWeekdays.map((isSelected, index) => (isSelected ? index : null)).filter(isNumber);

  return selectedIndexes.length > 0 ? selectedIndexes : [1];
}

function formatWeeklySchedulePhrase(weekdayIndexes: number[]) {
  return `weekly schedule:${weekdayIndexes.join(",")}`;
}

function getNextDailyDate(time: string) {
  const now = new Date();
  const [hour, minute] = time.split(":").map(Number);
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return formatDate(candidate);
}

function formatDateParts(year: number, monthIndex: number, day: number) {
  const safeDay = Math.min(day, getDaysInMonth(year, monthIndex));

  return `${year}-${padTwoDigits(monthIndex + 1)}-${padTwoDigits(safeDay)}`;
}

function combineDateAndScheduleTime(dueDate: string, time: string) {
  const dateParts = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeParts = time.match(/^(\d{2}):(\d{2})$/);

  if (!dateParts || !timeParts) {
    return new Date().toISOString();
  }

  const [, year, month, day] = dateParts;
  const [, hour, minute] = timeParts;

  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0).toISOString();
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`;
}

function getWeekdayName(index: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][index] ?? "weekday";
}

function padTwoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function isNumber(value: number | null): value is number {
  return typeof value === "number";
}

function formatDayForScheduleField(dueDate: string) {
  const dateParts = dueDate.match(/^\d{4}-\d{2}-(\d{2})$/);

  return dateParts ? String(Number(dateParts[1])) : "29";
}

function formatMonthForScheduleField(dueDate: string) {
  const dateParts = dueDate.match(/^(\d{4})-(\d{2})-\d{2}$/);

  if (!dateParts) {
    return "Oct";
  }

  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, 1));
}

function formatYearForScheduleField(dueDate: string) {
  const dateParts = dueDate.match(/^(\d{4})-\d{2}-\d{2}$/);

  return dateParts ? dateParts[1] : "2023";
}

function ReminderCard({
  reminder,
  isCompleting,
  nowMs,
  onCompleteReminder,
  onDeleteReminder,
  onRescheduleReminder,
}: {
  reminder: ReminderRecord;
  isCompleting: boolean;
  nowMs: number;
  onCompleteReminder: (reminderId: string) => void;
  onDeleteReminder: (reminderId: string) => void;
  onRescheduleReminder: (reminderId: string) => void;
}) {
  const timeState = getReminderTimeState(reminder.dueAt, nowMs);
  const age = formatReminderAge(reminder.createdAt);
  const dueDate = formatReminderEventDate(reminder.dueDate, reminder.dueAt);
  const dueTime = formatReminderEventTime(reminder.dueTime, reminder.dueAt);
  const timeStateLabel = timeState === "past" ? "Past" : "Future";

  return (
    <article
      className={`reminder-card is-${timeState} ${isCompleting ? "is-completing" : ""}`}
      aria-label={`${timeStateLabel} reminder: ${reminder.reminderText}`}
    >
      <div className="reminder-content">
        <p>{reminder.reminderText}</p>
        <div className="reminder-meta">
          <span className="reminder-tag">{getReminderTag(reminder)}</span>
          <span aria-label={`Created ${age}`}>{age}</span>
          <span className="reminder-icon-meta" aria-label={`Event time ${dueTime}`}>
            <Clock aria-hidden="true" size={12} />
            {dueTime}
          </span>
          <span className="reminder-icon-meta" aria-label={`Event date ${dueDate}`}>
            <Calendar aria-hidden="true" size={12} />
            {dueDate}
          </span>
        </div>
      </div>

      <div className="reminder-control-stack">
        <div className="reminder-actions" aria-label={`Actions for ${reminder.reminderText}`}>
          <button type="button" aria-label={`Delete ${reminder.reminderText}`} onClick={() => onDeleteReminder(reminder.id)}>
            <Trash2 aria-hidden="true" size={16} />
          </button>
          <button type="button" aria-label={`Reschedule ${reminder.reminderText}`} onClick={() => onRescheduleReminder(reminder.id)}>
            <Calendar aria-hidden="true" size={16} />
          </button>
          <button
            className="complete-button"
            type="button"
            aria-label={`Mark ${reminder.reminderText} complete`}
            disabled={isCompleting}
            onClick={() => onCompleteReminder(reminder.id)}
          >
            <Check aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="reminder-time-row" aria-hidden="true" />
      </div>
    </article>
  );
}

function getReminderTag(reminder: ReminderRecord) {
  return reminder.category?.trim() || "Personal";
}

function getRemindersForCategory(reminders: ReminderRecord[], activeCategory: CategoryFilter) {
  if (activeCategory === "All") {
    return reminders;
  }

  return reminders.filter((reminder) => getReminderTag(reminder).toLowerCase() === activeCategory.toLowerCase());
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

function formatReminderEventDate(dueDate: string, dueAt: string) {
  const dateParts = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateParts) {
    const [, year, month, day] = dateParts;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day));

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(localDate);
  }

  const fallbackDate = new Date(dueAt);

  if (Number.isNaN(fallbackDate.getTime())) {
    return "Event date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(fallbackDate);
}

function formatReminderEventTime(dueTime: string, dueAt: string) {
  const timeParts = dueTime.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);

  if (timeParts) {
    const [, hour, minute] = timeParts;
    const localTime = new Date(2000, 0, 1, Number(hour), Number(minute));

    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(localTime);
  }

  const fallbackDate = new Date(dueAt);

  if (Number.isNaN(fallbackDate.getTime())) {
    return "10:30 AM";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(fallbackDate);
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
