import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeReminder, deleteReminder, rescheduleReminder } from "./reminderStorage";
import { getSupabaseClient } from "./supabaseClient";

vi.mock("./supabaseClient", () => ({
  getSupabaseClient: vi.fn(),
}));

const getSupabaseClientMock = vi.mocked(getSupabaseClient);

describe("reminderStorage", () => {
  const fromMock = vi.fn();
  const storageFromMock = vi.fn();
  const storageRemoveMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storageRemoveMock.mockResolvedValue({ data: [{ name: "audio/audio-1.webm" }], error: null });
    storageFromMock.mockReturnValue({ remove: storageRemoveMock });
    getSupabaseClientMock.mockReturnValue({
      from: fromMock,
      storage: {
        from: storageFromMock,
      },
    } as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it("deletes the reminder, linked storage file, and linked audio row", async () => {
    const reminderMaybeSingleMock = vi.fn().mockResolvedValue({ data: { audio_id: "audio-1" }, error: null });
    const reminderEqMock = vi.fn().mockReturnValue({ maybeSingle: reminderMaybeSingleMock });
    const reminderSelectMock = vi.fn().mockReturnValue({ eq: reminderEqMock });
    const reminderDeleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const reminderDeleteMock = vi.fn().mockReturnValue({ eq: reminderDeleteEqMock });

    const audioMaybeSingleMock = vi.fn().mockResolvedValue({ data: { storage_path: "audio/audio-1.webm" }, error: null });
    const audioEqMock = vi.fn().mockReturnValue({ maybeSingle: audioMaybeSingleMock });
    const audioSelectMock = vi.fn().mockReturnValue({ eq: audioEqMock });
    const audioDeleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const audioDeleteMock = vi.fn().mockReturnValue({ eq: audioDeleteEqMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "reminders") {
        return {
          delete: reminderDeleteMock,
          select: reminderSelectMock,
        };
      }

      return {
        delete: audioDeleteMock,
        select: audioSelectMock,
      };
    });

    await deleteReminder("reminder-1");

    expect(reminderSelectMock).toHaveBeenCalledWith("audio_id");
    expect(reminderEqMock).toHaveBeenCalledWith("id", "reminder-1");
    expect(audioSelectMock).toHaveBeenCalledWith("storage_path");
    expect(audioEqMock).toHaveBeenCalledWith("id", "audio-1");
    expect(reminderDeleteEqMock).toHaveBeenCalledWith("id", "reminder-1");
    expect(storageFromMock).toHaveBeenCalledWith("audio-reminders");
    expect(storageRemoveMock).toHaveBeenCalledWith(["audio/audio-1.webm"]);
    expect(audioDeleteEqMock).toHaveBeenCalledWith("id", "audio-1");
    expect(storageRemoveMock.mock.invocationCallOrder[0]).toBeLessThan(reminderDeleteEqMock.mock.invocationCallOrder[0]);
  });

  it("does not delete table rows when storage deletion does not remove a file", async () => {
    const reminderMaybeSingleMock = vi.fn().mockResolvedValue({ data: { audio_id: "audio-1" }, error: null });
    const reminderEqMock = vi.fn().mockReturnValue({ maybeSingle: reminderMaybeSingleMock });
    const reminderSelectMock = vi.fn().mockReturnValue({ eq: reminderEqMock });
    const reminderDeleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const reminderDeleteMock = vi.fn().mockReturnValue({ eq: reminderDeleteEqMock });

    const audioMaybeSingleMock = vi.fn().mockResolvedValue({ data: { storage_path: "audio/audio-1.webm" }, error: null });
    const audioEqMock = vi.fn().mockReturnValue({ maybeSingle: audioMaybeSingleMock });
    const audioSelectMock = vi.fn().mockReturnValue({ eq: audioEqMock });
    const audioDeleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const audioDeleteMock = vi.fn().mockReturnValue({ eq: audioDeleteEqMock });

    storageRemoveMock.mockResolvedValue({ data: [], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "reminders") {
        return {
          delete: reminderDeleteMock,
          select: reminderSelectMock,
        };
      }

      return {
        delete: audioDeleteMock,
        select: audioSelectMock,
      };
    });

    await expect(deleteReminder("reminder-1")).rejects.toThrow("Audio file was not deleted from storage.");

    expect(reminderDeleteEqMock).not.toHaveBeenCalled();
    expect(audioDeleteEqMock).not.toHaveBeenCalled();
  });

  it("deletes only the reminder when no audio is linked", async () => {
    const reminderMaybeSingleMock = vi.fn().mockResolvedValue({ data: { audio_id: null }, error: null });
    const reminderEqMock = vi.fn().mockReturnValue({ maybeSingle: reminderMaybeSingleMock });
    const reminderSelectMock = vi.fn().mockReturnValue({ eq: reminderEqMock });
    const reminderDeleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const reminderDeleteMock = vi.fn().mockReturnValue({ eq: reminderDeleteEqMock });

    fromMock.mockReturnValue({
      delete: reminderDeleteMock,
      select: reminderSelectMock,
    });

    await deleteReminder("reminder-1");

    expect(reminderDeleteEqMock).toHaveBeenCalledWith("id", "reminder-1");
    expect(storageRemoveMock).not.toHaveBeenCalled();
  });

  it("marks a reminder complete without deleting linked audio", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "reminder-1",
        audio_id: "audio-1",
        reminder_text: "dry clothes",
        category: "Personal",
        original_transcript: "dry clothes tomorrow at 7 PM",
        due_date: "2099-01-01",
        due_time: "10:30:00",
        due_at: "2099-01-01T10:30:00.000Z",
        date_phrase: "tomorrow",
        time_phrase: "at 10:30",
        date_resolution: "relative_day",
        status: "pending",
        created_at: "2026-06-28T00:00:00.000Z",
        updated_at: "2026-06-28T00:00:00.000Z",
      },
      error: null,
    });
    const selectEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });
    const completeEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: completeEqMock });

    fromMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    });

    const completedReminder = await completeReminder("reminder-1");

    expect(fromMock).toHaveBeenCalledWith("reminders");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        updated_at: expect.any(String),
      }),
    );
    expect(completeEqMock).toHaveBeenCalledWith("id", "reminder-1");
    expect(completedReminder).toBeNull();
    expect(storageRemoveMock).not.toHaveBeenCalled();
  });

  it("advances a daily recurring reminder instead of completing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T20:00:00.000Z"));

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "reminder-1",
        audio_id: "audio-1",
        reminder_text: "dry clothes",
        category: "Personal",
        original_transcript: "dry clothes tomorrow at 7 PM",
        due_date: "2026-07-09",
        due_time: "10:30:00",
        due_at: "2026-07-09T10:30:00.000Z",
        date_phrase: "daily schedule",
        time_phrase: "at 10:30 am",
        date_resolution: "rescheduled_daily",
        status: "pending",
        created_at: "2026-06-28T00:00:00.000Z",
        updated_at: "2026-06-28T00:00:00.000Z",
      },
      error: null,
    });
    const selectEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: "reminder-1",
        audio_id: "audio-1",
        reminder_text: "dry clothes",
        category: "Personal",
        original_transcript: "dry clothes tomorrow at 7 PM",
        due_date: "2026-07-10",
        due_time: "10:30:00",
        due_at: "2026-07-10T10:30:00.000Z",
        date_phrase: "daily schedule",
        time_phrase: "at 10:30 am",
        date_resolution: "rescheduled_daily",
        status: "pending",
        created_at: "2026-06-28T00:00:00.000Z",
        updated_at: "2026-07-09T20:00:00.000Z",
      },
      error: null,
    });
    const updateSelectMock = vi.fn().mockReturnValue({ single: singleMock });
    const completeEqMock = vi.fn().mockReturnValue({ select: updateSelectMock });
    const updateMock = vi.fn().mockReturnValue({ eq: completeEqMock });

    fromMock.mockReturnValue({
      select: selectMock,
      update: updateMock,
    });

    const reminder = await completeReminder("reminder-1");

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: "2026-07-10",
        status: "pending",
        updated_at: expect.any(String),
      }),
    );
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(completeEqMock).toHaveBeenCalledWith("id", "reminder-1");
    expect(updateSelectMock).toHaveBeenCalled();
    expect(reminder?.dueDate).toBe("2026-07-10");
    expect(reminder?.dateResolution).toBe("rescheduled_daily");

    vi.useRealTimers();
  });

  it("updates and returns a rescheduled reminder", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: "reminder-1",
        audio_id: "audio-1",
        reminder_text: "dry clothes",
        category: "Personal",
        original_transcript: "dry clothes tomorrow at 7 PM",
        due_date: "2099-01-01",
        due_time: "10:30:00",
        due_at: "2099-01-01T10:30:00.000Z",
        date_phrase: "daily schedule",
        time_phrase: "at 10:30",
        date_resolution: "rescheduled_daily",
        status: "pending",
        created_at: "2026-06-28T00:00:00.000Z",
        updated_at: "2026-06-28T00:00:00.000Z",
      },
      error: null,
    });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const eqMock = vi.fn().mockReturnValue({ select: selectMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

    fromMock.mockReturnValue({
      update: updateMock,
    });

    const reminder = await rescheduleReminder("reminder-1", {
      dueDate: "2099-01-01",
      dueTime: "10:30:00",
      dueAt: "2099-01-01T10:30:00.000Z",
      datePhrase: "daily schedule",
      timePhrase: "at 10:30",
      dateResolution: "rescheduled_daily",
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: "2099-01-01",
        due_time: "10:30:00",
        due_at: "2099-01-01T10:30:00.000Z",
        date_phrase: "daily schedule",
        time_phrase: "at 10:30",
        date_resolution: "rescheduled_daily",
        updated_at: expect.any(String),
      }),
    );
    expect(eqMock).toHaveBeenCalledWith("id", "reminder-1");
    expect(reminder.dueTime).toBe("10:30:00");
  });
});
