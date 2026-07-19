import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  AlarmClock,
  ArrowLeft,
  BellRing,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Info,
  ListTodo,
  LogOut,
  Menu,
  Mic,
  MoreVertical,
  PlusCircle,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  StopCircle,
  Square,
  Trash2,
  Vibrate,
  Volume2,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useAuthSession } from "./auth";
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
import { enablePushNotifications, getPushNotificationState, hasPushNotificationSubscription, type PushNotificationState } from "./pushNotifications";

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

type AppView = "record" | "reminders" | "alarm" | "alarm-settings" | "reschedule";
type ReturnableAppView = Exclude<AppView, "reschedule" | "alarm-settings">;
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
  const auth = useAuthSession();
  if (auth.isLoading) return <AuthLoadingScreen />;
  if (!auth.user) return <GoogleSignInScreen authError={auth.authError} onSignIn={auth.signInWithGoogle} />;
  return <HomePage user={auth.user} onSignOut={() => void auth.signOut()} />;
}

function HomePage({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [savedAudioRecord, setSavedAudioRecord] = useState<AudioReminderRecord | null>(null);
  const [savedReminder, setSavedReminder] = useState<ReminderRecord | null>(null);
  const [recentReminders, setRecentReminders] = useState<ReminderRecord[]>([]);
  const [completingReminderIds, setCompletingReminderIds] = useState<Set<string>>(() => new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeView, setActiveView] = useState<AppView>("record");
  const [rescheduleReturnView, setRescheduleReturnView] = useState<ReturnableAppView>("reminders");
  const [rescheduleReminderId, setRescheduleReminderId] = useState<string | null>(null);
  const [alarmSettingsReminderId, setAlarmSettingsReminderId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("All");
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [ringingReminderId, setRingingReminderId] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushNotificationState>(() => getPushNotificationState());
  const [isPushRegistered, setIsPushRegistered] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const speechRecognitionSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const alarmAudioContextRef = useRef<AudioContext | null>(null);
  const alarmAudioTimerRef = useRef<number | null>(null);
  const alarmVibrationTimerRef = useRef<number | null>(null);
  const triggeredAlarmKeysRef = useRef<Set<string>>(new Set());
  const handledNotificationUrlRef = useRef<string | null>(null);
  const appStartedAtRef = useRef(Date.now());
  const [transcriptSnapshot, setTranscriptSnapshot] = useState<TranscriptSnapshot | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "requesting-permission" || status === "saving";
  const shellClassName = `app-shell ${activeView === "reminders" ? "is-reminders-view" : ""} ${
    activeView === "reschedule" ? "is-reschedule-view" : ""
  } ${
    activeView === "alarm-settings" ? "is-alarm-settings-view" : ""
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
    void hasPushNotificationSubscription().then((isRegistered) => {
      if (isActive) setIsPushRegistered(isRegistered);
    });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const reminderId = parameters.get("alarm");
    const action = parameters.get("action");
    const notificationKey = reminderId ? `${reminderId}:${action ?? "open"}` : null;

    if (!reminderId || !notificationKey || handledNotificationUrlRef.current === notificationKey) return;

    const reminder = recentReminders.find((candidate) => candidate.id === reminderId);
    if (!reminder) return;

    handledNotificationUrlRef.current = notificationKey;

    if (action === "snooze-5") {
      void handleSnoozeRingingAlarm(reminderId, 5).finally(clearNotificationActionFromUrl);
      return;
    }

    if (action === "stop") {
      void handleStopRingingAlarm(reminderId).finally(clearNotificationActionFromUrl);
      return;
    }

    triggeredAlarmKeysRef.current.add(getAlarmTriggerKey(reminder));
    setRingingReminderId(reminderId);
    clearNotificationActionFromUrl();
  }, [recentReminders]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "OPEN_REMINDER_ALARM" || typeof event.data.reminderId !== "string") return;

      const reminderId = event.data.reminderId;
      const reminder = recentReminders.find((candidate) => candidate.id === reminderId);
      if (!reminder) return;

      if (event.data.action === "snooze-5") {
        void handleSnoozeRingingAlarm(reminderId, 5);
      } else if (event.data.action === "stop") {
        void handleStopRingingAlarm(reminderId);
      } else {
        triggeredAlarmKeysRef.current.add(getAlarmTriggerKey(reminder));
        setRingingReminderId(reminderId);
      }
    };

    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
  }, [recentReminders]);

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

  useEffect(() => {
    const unlockAlarmAudio = () => {
      void getAlarmAudioContext(alarmAudioContextRef)?.resume?.();
    };

    window.addEventListener("pointerdown", unlockAlarmAudio, { once: true });
    window.addEventListener("keydown", unlockAlarmAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAlarmAudio);
      window.removeEventListener("keydown", unlockAlarmAudio);
    };
  }, []);

  useEffect(() => {
    if (ringingReminderId) {
      return;
    }

    const dueReminder = recentReminders
      .filter((reminder) => reminder.status === "pending")
      .slice()
      .sort((firstReminder, secondReminder) => new Date(firstReminder.dueAt).getTime() - new Date(secondReminder.dueAt).getTime())
      .find((reminder) => {
        const dueMs = new Date(reminder.dueAt).getTime();

        return (
          !Number.isNaN(dueMs) &&
          dueMs >= appStartedAtRef.current &&
          dueMs <= nowMs &&
          !triggeredAlarmKeysRef.current.has(getAlarmTriggerKey(reminder))
        );
      });

    if (!dueReminder) {
      return;
    }

    triggeredAlarmKeysRef.current.add(getAlarmTriggerKey(dueReminder));
    setRingingReminderId(dueReminder.id);
  }, [nowMs, recentReminders, ringingReminderId]);

  useEffect(() => {
    if (!ringingReminderId) {
      stopAlarmAudio(alarmAudioTimerRef);
      stopAlarmVibration(alarmVibrationTimerRef);
      return;
    }

    startAlarmAudio(alarmAudioContextRef, alarmAudioTimerRef);
    startAlarmVibration(alarmVibrationTimerRef);

    return () => {
      stopAlarmAudio(alarmAudioTimerRef);
      stopAlarmVibration(alarmVibrationTimerRef);
    };
  }, [ringingReminderId]);

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
      void speechRecognitionSessionRef.current?.stop();
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
    const transcript = speechRecognitionSessionRef.current
      ? await speechRecognitionSessionRef.current.stop()
      : createTranscriptSnapshot("not_supported");

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

  async function handleStopRingingAlarm(reminderId: string) {
    setRingingReminderId(null);
    await handleCompleteReminder(reminderId);
  }

  async function handleSnoozeRingingAlarm(reminderId: string, minutes: number) {
    const snoozedUntil = new Date(Date.now() + minutes * 60_000);
    const updatedReminder = await handleConfirmReschedule(reminderId, {
      dueDate: formatDate(snoozedUntil),
      dueTime: `${padTwoDigits(snoozedUntil.getHours())}:${padTwoDigits(snoozedUntil.getMinutes())}:00`,
      dueAt: snoozedUntil.toISOString(),
      datePhrase: `snoozed ${minutes} minutes`,
      timePhrase: `snoozed ${minutes} minutes`,
      dateResolution: "snoozed",
    });

    triggeredAlarmKeysRef.current.delete(getAlarmTriggerKey(updatedReminder));
    setRingingReminderId(null);
  }

  async function handleEnablePushNotifications() {
    setIsEnablingPush(true);
    setPushMessage(null);

    try {
      const nextState = await enablePushNotifications();
      setPushState(nextState);
      setIsPushRegistered(nextState === "granted");
      setPushMessage(
        nextState === "granted"
          ? "Background notifications enabled on this browser."
          : nextState === "denied"
            ? "Notifications are blocked. Enable them in your browser settings."
            : nextState === "unsupported"
              ? "Background notifications are not supported in this browser."
              : "Notification permission was not enabled.",
      );
    } catch (error) {
      setPushMessage(getErrorMessage(error));
    } finally {
      setIsEnablingPush(false);
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

  function handleOpenAlarmSettings(reminderId: string) {
    setAlarmSettingsReminderId(reminderId);
    setActiveView("alarm-settings");
  }

  function handleBackFromAlarmSettings() {
    setActiveView("alarm");
  }

  async function handleDeleteAlarm(reminderId: string) {
    await handleDeleteReminder(reminderId);
    setActiveView("alarm");
  }

  function handleChangeView(view: AppView) {
    if (view !== "reschedule") {
      setRescheduleReminderId(null);
    }

    if (view !== "alarm-settings") {
      setAlarmSettingsReminderId(null);
    }

    setActiveView(view);
  }

  return (
    <div className={shellClassName}>
      <header className="top-bar">
        <button className="icon-button" type="button" aria-label="Open navigation">
          <Menu aria-hidden="true" size={24} />
        </button>
        <h1>{getTopBarTitle(activeView)}</h1>
        <button className="account-button" type="button" onClick={onSignOut} aria-label={`Sign out ${user.email ?? "account"}`}>
          <span>{user.email}</span>
          <LogOut aria-hidden="true" size={17} />
        </button>
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
              <div className="saved-reminder-notifications">
                <p className="capture-summary" aria-label="Saved reminder">
                  Reminder saved - {savedReminder.reminderText} - {formatReminderDueAt(savedReminder.dueAt)}
                </p>
              </div>
            ) : null}

            {!isPushRegistered ? (
              <div className="saved-reminder-notifications" aria-label="Background notification setup">
                <button className="enable-notifications-button" type="button" onClick={() => void handleEnablePushNotifications()} disabled={isEnablingPush || pushState === "unsupported"}>
                  <BellRing aria-hidden="true" size={18} />
                  {isEnablingPush ? "Enabling..." : pushState === "granted" ? "Register this browser for notifications" : "Enable background notifications"}
                </button>
                {!pushMessage && pushState === "unsupported" ? <p className="capture-summary" role="status">Background notifications are not supported in this browser.</p> : null}
                {!pushMessage && pushState === "denied" ? <p className="capture-summary" role="status">Notifications are blocked. Allow them in this browser's site settings, reload, and try again.</p> : null}
              </div>
            ) : null}
            {pushMessage ? <p className="capture-summary" role="status">{pushMessage}</p> : null}

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
      ) : activeView === "alarm" ? (
        <AlarmScreen reminders={recentReminders} onOpenAlarmSettings={handleOpenAlarmSettings} />
      ) : activeView === "alarm-settings" ? (
        <AlarmSettingsScreen
          reminder={recentReminders.find((reminder) => reminder.id === alarmSettingsReminderId) ?? null}
          onBack={handleBackFromAlarmSettings}
          onDeleteAlarm={handleDeleteAlarm}
        />
      ) : (
        <RescheduleScreen
          reminder={recentReminders.find((reminder) => reminder.id === rescheduleReminderId) ?? null}
          onBack={handleBackFromReschedule}
          onConfirmReschedule={handleConfirmReschedule}
        />
      )}

      {ringingReminderId ? (
        <RingingAlarmOverlay
          reminder={recentReminders.find((reminder) => reminder.id === ringingReminderId) ?? null}
          isStopping={completingReminderIds.has(ringingReminderId)}
          onStopAlarm={handleStopRingingAlarm}
          onSnoozeAlarm={handleSnoozeRingingAlarm}
        />
      ) : null}

      <PrimaryNav activeView={activeView} onChangeView={handleChangeView} />
    </div>
  );
}

function AuthLoadingScreen() {
  return <main className="auth-page"><p className="auth-kicker">PERSONAL REMINDER CREATOR</p><p>Checking your session…</p></main>;
}

function GoogleSignInScreen({ authError, onSignIn }: { authError: string | null; onSignIn: () => Promise<void> }) {
  const [isSigningIn, setIsSigningIn] = useState(false);

  async function handleSignIn() {
    setIsSigningIn(true);
    try { await onSignIn(); }
    finally { setIsSigningIn(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark"><Mic aria-hidden="true" size={34} /></div>
        <p className="auth-kicker">PERSONAL REMINDER CREATOR</p>
        <h1 id="auth-title">Your reminders, on every device</h1>
        <p className="auth-copy">Sign in with your personal Gmail account to keep reminders and notifications private.</p>
        <button className="google-sign-in-button" type="button" onClick={() => void handleSignIn()} disabled={isSigningIn}>
          <GoogleMark />
          {isSigningIn ? "Opening Google…" : "Continue with Google"}
        </button>
        <p className="auth-note">Only addresses ending in @gmail.com are allowed.</p>
        {authError ? <p className="auth-error" role="alert">{authError}</p> : null}
      </section>
    </main>
  );
}

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"/><path fill="#34a853" d="M12 22c2.7 0 4.97-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.39 13.86A6 6 0 0 1 6.07 12c0-.65.11-1.28.32-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.48l3.35-2.62Z"/><path fill="#ea4335" d="M12 6.01c1.47 0 2.78.5 3.82 1.49l2.88-2.88A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"/></svg>;
}

function getTopBarTitle(activeView: AppView) {
  if (activeView === "alarm-settings") {
    return "Alarm Settings";
  }

  if (activeView === "alarm") {
    return "Alarms";
  }

  return "Personal Reminder Creator";
}

function formatDuration(durationMs: number) {
  return `${Math.max(0, Math.round(durationMs / 1000))}s`;
}

function RingingAlarmOverlay({
  reminder,
  isStopping,
  onStopAlarm,
  onSnoozeAlarm,
}: {
  reminder: ReminderRecord | null;
  isStopping: boolean;
  onStopAlarm: (reminderId: string) => Promise<void>;
  onSnoozeAlarm: (reminderId: string, minutes: number) => Promise<void>;
}) {
  if (!reminder) {
    return null;
  }

  const alarmTime = formatAlarmTimeParts(reminder);

  return (
    <section className="ringing-alarm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="ringing-alarm-title">
      <header className="ringing-alarm-header">
        <AlarmClock aria-hidden="true" size={18} />
        <span>Alarm</span>
      </header>

      <main className="ringing-alarm-stage">
        <div className="ringing-alarm-icon-wrap" aria-hidden="true">
          <span />
          <span />
          <div>
            <AlarmClock size={40} />
          </div>
        </div>

        <div className="ringing-alarm-time">
          <h2 id="ringing-alarm-title">
            {alarmTime.time}
            <span>{alarmTime.period}</span>
          </h2>
        </div>

        <div className="ringing-alarm-waveform" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </main>

      <footer className="ringing-alarm-actions">
        <button className="ringing-snooze-button" type="button" onClick={() => void onSnoozeAlarm(reminder.id, 5)}>
          <Clock aria-hidden="true" size={18} />
          Snooze (5m)
        </button>
        <button className="ringing-snooze-button" type="button" onClick={() => void onSnoozeAlarm(reminder.id, 10)}>
          <Clock aria-hidden="true" size={18} />
          Snooze (10m)
        </button>
        <button className="ringing-snooze-button" type="button" onClick={() => void onSnoozeAlarm(reminder.id, 15)}>
          <Clock aria-hidden="true" size={18} />
          Snooze
        </button>
        <button className="ringing-stop-button" type="button" onClick={() => void onStopAlarm(reminder.id)} disabled={isStopping}>
          <StopCircle aria-hidden="true" size={19} />
          {isStopping ? "Stopping..." : "Stop Alarm"}
        </button>
      </footer>
    </section>
  );
}

function getAlarmTriggerKey(reminder: ReminderRecord) {
  return `${reminder.id}:${reminder.dueAt}`;
}

function clearNotificationActionFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("alarm");
  url.searchParams.delete("action");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function startAlarmAudio(audioContextRef: MutableRefObject<AudioContext | null>, timerRef: MutableRefObject<number | null>) {
  stopAlarmAudio(timerRef);
  playAlarmTone(audioContextRef);
  timerRef.current = window.setInterval(() => {
    playAlarmTone(audioContextRef);
  }, 650);
}

function startAlarmVibration(timerRef: MutableRefObject<number | null>) {
  stopAlarmVibration(timerRef);
  vibrateAlarmPattern();
  timerRef.current = window.setInterval(vibrateAlarmPattern, 1400);
}

function stopAlarmVibration(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  navigator.vibrate?.(0);
}

function vibrateAlarmPattern() {
  navigator.vibrate?.([250, 90, 250, 160, 450]);
}

function stopAlarmAudio(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }
}

function playAlarmTone(audioContextRef: MutableRefObject<AudioContext | null>) {
  const audioContext = getAlarmAudioContext(audioContextRef);

  if (!audioContext) {
    return;
  }

  void audioContext.resume?.();

  try {
    const startsAt = audioContext.currentTime;

    [
      { frequency: 659.25, offset: 0 },
      { frequency: 783.99, offset: 0.16 },
      { frequency: 987.77, offset: 0.32 },
    ].forEach(({ frequency, offset }, index) => {
      const oscillator = audioContext.createOscillator();
      const harmonyOscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const noteStartsAt = startsAt + offset;
      const noteEndsAt = noteStartsAt + 0.22;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStartsAt);
      harmonyOscillator.type = "triangle";
      harmonyOscillator.frequency.setValueAtTime(frequency / 2, noteStartsAt);
      gain.gain.setValueAtTime(0.0001, noteStartsAt);
      gain.gain.exponentialRampToValueAtTime(index === 2 ? 0.26 : 0.22, noteStartsAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEndsAt);
      oscillator.connect(gain);
      harmonyOscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(noteStartsAt);
      harmonyOscillator.start(noteStartsAt);
      oscillator.stop(noteEndsAt);
      harmonyOscillator.stop(noteEndsAt);
    });
  } catch {
    // Browser audio can be blocked until a user gesture; the visual alarm still appears.
  }
}

function getAlarmAudioContext(audioContextRef: MutableRefObject<AudioContext | null>) {
  if (audioContextRef.current) {
    return audioContextRef.current;
  }

  const AudioContextConstructor = getAudioContextConstructor();

  if (!AudioContextConstructor) {
    return null;
  }

  audioContextRef.current = new AudioContextConstructor();
  return audioContextRef.current;
}

function getAudioContextConstructor() {
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
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

function AlarmScreen({
  reminders,
  onOpenAlarmSettings,
}: {
  reminders: ReminderRecord[];
  onOpenAlarmSettings: (reminderId: string) => void;
}) {
  const alarms = reminders
    .filter((reminder) => reminder.status === "pending")
    .slice()
    .sort((firstReminder, secondReminder) => new Date(firstReminder.dueAt).getTime() - new Date(secondReminder.dueAt).getTime());
  const nextAlarm = alarms[0] ?? null;
  const nextAlarmTime = nextAlarm ? formatAlarmTimeParts(nextAlarm) : null;

  return (
    <main className="alarm-page" aria-labelledby="alarm-title">
      <section className="alarm-hero" aria-label="Next alarm">
        <div className="alarm-hero-content">
          <BellRing aria-hidden="true" size={42} />
          <p>{nextAlarm ? "Next Alarm" : "No alarms scheduled"}</p>
          {nextAlarm && nextAlarmTime ? (
            <>
              <h2>
                {nextAlarmTime.time} <span>{nextAlarmTime.period}</span>
              </h2>
              <small>{formatReminderEventDate(nextAlarm.dueDate, nextAlarm.dueAt)}</small>
            </>
          ) : (
            <h2>Add your first reminder</h2>
          )}
        </div>
      </section>

      <section className="alarm-list" aria-labelledby="alarm-title">
        <h2 id="alarm-title">Alarms</h2>
        <div className="alarm-grid">
          {alarms.length > 0 ? (
            alarms.map((reminder) => {
              const alarmTime = formatAlarmTimeParts(reminder);
              const alarmChips = getAlarmChips(reminder);

              return (
                <button
                  className="alarm-card alarm-card-button is-active"
                  key={reminder.id}
                  type="button"
                  aria-label={`Open settings for ${reminder.reminderText}`}
                  onClick={() => onOpenAlarmSettings(reminder.id)}
                >
                  <div className="alarm-card-header">
                    <div className="alarm-time-group">
                      <div className="alarm-time">
                        <span>{alarmTime.time}</span>
                        <small>{alarmTime.period}</small>
                      </div>
                      <p>{getAlarmScheduleLabel(reminder)}</p>
                    </div>
                    <div className="alarm-enabled-indicator" aria-label="Alarm enabled">
                      <span aria-hidden="true" />
                    </div>
                  </div>

                  <p className="alarm-reminder-title">{reminder.reminderText}</p>

                  <div className="alarm-days" aria-label={`${reminder.reminderText} schedule`}>
                    {alarmChips.map((chip) => (
                      <span className="is-active" key={chip}>
                        {chip}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })
          ) : (
            <p className="alarm-empty-state">No alarms yet. Create one from a reminder when you are ready.</p>
          )}

          <button className="add-alarm-card" type="button">
            <PlusCircle aria-hidden="true" size={38} />
            <span>Add New Alarm</span>
          </button>
        </div>
      </section>
    </main>
  );
}

function AlarmSettingsScreen({
  reminder,
  onBack,
  onDeleteAlarm,
}: {
  reminder: ReminderRecord | null;
  onBack: () => void;
  onDeleteAlarm: (reminderId: string) => Promise<void>;
}) {
  const alarmTime = reminder ? formatAlarmTimeParts(reminder) : null;
  const alarmDate = reminder ? formatReminderEventDate(reminder.dueDate, reminder.dueAt) : null;
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteAlarm() {
    if (!reminder || isDeleting) {
      return;
    }

    try {
      setIsDeleting(true);
      await onDeleteAlarm(reminder.id);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <main className="alarm-settings-page" aria-labelledby="alarm-settings-title">
      <header className="alarm-settings-topbar">
        <button type="button" aria-label="Back to alarms" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={22} />
        </button>
        <h2 id="alarm-settings-title">Alarm Settings</h2>
        <button type="button" aria-label="More alarm options">
          <MoreVertical aria-hidden="true" size={22} />
        </button>
      </header>

      {reminder && alarmTime && alarmDate ? (
        <>
          <section className="alarm-settings-card alarm-status-card">
            <div>
              <p>Status</p>
              <strong>Alarm Active</strong>
            </div>
            <span className="alarm-settings-toggle" aria-hidden="true">
              <span />
            </span>
          </section>

          <section className="alarm-settings-time" aria-label={`Alarm time ${alarmTime.time} ${alarmTime.period}`}>
            <div>
              <span>{alarmTime.time}</span>
              <small>{alarmTime.period}</small>
            </div>
            <p>{alarmDate}</p>
          </section>

          <section className="alarm-settings-section" aria-labelledby="snooze-frequency-title">
            <div className="alarm-settings-section-title">
              <Repeat aria-hidden="true" size={16} />
              <h3 id="snooze-frequency-title">Snooze Frequency</h3>
            </div>
            <div className="alarm-settings-options is-three">
              <button type="button">1 Time</button>
              <button className="is-selected" type="button">2 Times</button>
              <button type="button">3 Times</button>
            </div>
          </section>

          <section className="alarm-settings-section" aria-labelledby="snooze-duration-title">
            <div className="alarm-settings-section-title">
              <Clock aria-hidden="true" size={16} />
              <h3 id="snooze-duration-title">Snooze Duration</h3>
            </div>
            <div className="alarm-settings-options">
              {["1 min", "2 mins", "5 mins", "10 mins", "15 mins", "30 mins"].map((duration) => (
                <button className={duration === "5 mins" ? "is-selected" : ""} type="button" key={duration}>
                  {duration}
                </button>
              ))}
            </div>
          </section>

          <section className="alarm-visualizer" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </section>

          <section className="alarm-settings-card">
            <div className="alarm-settings-row-title">
              <Vibrate aria-hidden="true" size={22} />
              <strong>Vibrate</strong>
            </div>
            <span className="alarm-settings-toggle" aria-hidden="true">
              <span />
            </span>
          </section>

          <section className="alarm-settings-card alarm-sound-card">
            <div className="alarm-settings-row-title">
              <Volume2 aria-hidden="true" size={22} />
              <div>
                <strong>Alarm Sound</strong>
                <p>Early Riser</p>
              </div>
            </div>
            <ChevronDown aria-hidden="true" size={20} />
          </section>

          <button className="delete-alarm-button" type="button" onClick={deleteAlarm} disabled={isDeleting}>
            <Trash2 aria-hidden="true" size={20} />
            {isDeleting ? "Deleting..." : "Delete Alarm"}
          </button>
          <button className="save-alarm-button" type="button" onClick={onBack}>
            <CheckCircle2 aria-hidden="true" size={20} />
            Save Alarm
          </button>
        </>
      ) : (
        <section className="alarm-settings-card alarm-settings-empty">
          <p>This alarm is no longer available.</p>
          <button type="button" onClick={onBack}>
            Back to Alarms
          </button>
        </section>
      )}
    </main>
  );
}

function formatAlarmTimeParts(reminder: ReminderRecord) {
  const formattedTime = formatReminderEventTime(reminder.dueTime, reminder.dueAt);
  const timeParts = formattedTime.match(/^(.+?)\s*([AP]M)$/i);

  if (!timeParts) {
    return {
      time: formattedTime,
      period: "",
    };
  }

  return {
    time: timeParts[1],
    period: timeParts[2].toUpperCase(),
  };
}

function getAlarmScheduleLabel(reminder: ReminderRecord) {
  if (reminder.dateResolution === "rescheduled_daily") {
    return "Repeat every day";
  }

  if (reminder.dateResolution === "rescheduled_weekly") {
    return "Weekly recurrence";
  }

  if (reminder.dateResolution === "rescheduled_monthly") {
    return "Monthly recurrence";
  }

  return formatReminderEventDate(reminder.dueDate, reminder.dueAt);
}

function getAlarmChips(reminder: ReminderRecord) {
  if (reminder.dateResolution === "rescheduled_daily") {
    return ["Daily"];
  }

  if (reminder.dateResolution === "rescheduled_weekly") {
    return parseWeeklyScheduleIndexes(reminder.datePhrase).map(getShortWeekdayName);
  }

  if (reminder.dateResolution === "rescheduled_monthly") {
    return ["Monthly", formatReminderEventDate(reminder.dueDate, reminder.dueAt)];
  }

  return [getReminderTag(reminder), formatReminderEventDate(reminder.dueDate, reminder.dueAt)];
}

function parseWeeklyScheduleIndexes(datePhrase: string | null) {
  const encodedDays = datePhrase?.match(/^weekly schedule:([\d,]+)$/)?.[1];
  const weekdays =
    encodedDays
      ?.split(",")
      .map(Number)
      .filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) ?? [];

  return weekdays.length > 0 ? weekdays : [1];
}

function getShortWeekdayName(index: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index] ?? "Day";
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
              This reminder will be updated globally. You'll receive a push notification at the scheduled time.
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
      <a
        className={`toolbar-item ${activeView === "alarm" ? "is-active" : ""}`}
        href="#alarm-title"
        aria-current={activeView === "alarm" ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          onChangeView("alarm");
        }}
      >
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
