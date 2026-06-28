export type TranscriptStatus = "completed" | "empty" | "not_supported" | "failed";

export interface TranscriptSnapshot {
  text: string | null;
  status: TranscriptStatus;
  error: string | null;
  transcribedAt: string | null;
}

export interface SpeechRecognitionSession {
  start: () => TranscriptSnapshot;
  stop: () => TranscriptSnapshot;
  getSnapshot: () => TranscriptSnapshot;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error?: string;
  message?: string;
}

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionResultList {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserWindowWithSpeechRecognition extends Window {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
}

export function createSpeechRecognitionSession(): SpeechRecognitionSession {
  const SpeechRecognitionConstructor =
    (window as BrowserWindowWithSpeechRecognition).SpeechRecognition ??
    (window as BrowserWindowWithSpeechRecognition).webkitSpeechRecognition;

  if (!SpeechRecognitionConstructor) {
    return createStaticSession({
      text: null,
      status: "not_supported",
      error: "Speech recognition is not supported in this browser.",
      transcribedAt: null,
    });
  }

  const recognition = new SpeechRecognitionConstructor();
  const finalSegments: string[] = [];
  let started = false;
  let failed = false;
  let errorMessage: string | null = null;

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript.trim();

      if (result.isFinal && transcript) {
        finalSegments.push(transcript);
      }
    }
  };

  recognition.onerror = (event) => {
    failed = true;
    errorMessage = event.message || event.error || "Speech recognition failed.";
  };

  function getSnapshot(): TranscriptSnapshot {
    const text = finalSegments.join(" ").trim();

    if (failed) {
      return {
        text: text || null,
        status: "failed",
        error: errorMessage,
        transcribedAt: text ? new Date().toISOString() : null,
      };
    }

    if (!text) {
      return {
        text: null,
        status: "empty",
        error: null,
        transcribedAt: null,
      };
    }

    return {
      text,
      status: "completed",
      error: null,
      transcribedAt: new Date().toISOString(),
    };
  }

  return {
    start() {
      try {
        recognition.start();
        started = true;
      } catch (error) {
        failed = true;
        errorMessage = getErrorMessage(error);
      }

      return getSnapshot();
    },
    stop() {
      if (started) {
        try {
          recognition.stop();
        } catch (error) {
          failed = true;
          errorMessage = getErrorMessage(error);
        }
      }

      started = false;
      return getSnapshot();
    },
    getSnapshot,
  };
}

function createStaticSession(snapshot: TranscriptSnapshot): SpeechRecognitionSession {
  return {
    start: () => snapshot,
    stop: () => snapshot,
    getSnapshot: () => snapshot,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Speech recognition failed.";
}
