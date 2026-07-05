import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeReminder, deleteReminder } from "./reminderStorage";
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
    const completeEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: completeEqMock });

    fromMock.mockReturnValue({
      update: updateMock,
    });

    await completeReminder("reminder-1");

    expect(fromMock).toHaveBeenCalledWith("reminders");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        updated_at: expect.any(String),
      }),
    );
    expect(completeEqMock).toHaveBeenCalledWith("id", "reminder-1");
    expect(storageRemoveMock).not.toHaveBeenCalled();
  });
});
