import { describe, expect, it, vi } from "vitest";
import { runRecoverableTrashAction } from "./TrashPage";

describe("runRecoverableTrashAction", () => {
  it("completes only after the action and its refresh succeed", async () => {
    const events: string[] = [];
    const onError = vi.fn();

    const succeeded = await runRecoverableTrashAction(async () => {
      events.push("restore");
      await Promise.resolve();
      events.push("refresh");
    }, onError);

    expect(succeeded).toBe(true);
    expect(events).toEqual(["restore", "refresh"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the action retryable when restore or refresh fails", async () => {
    const failure = new Error("restore conflict");
    const reported: unknown[] = [];

    const succeeded = await runRecoverableTrashAction(
      async () => {
        throw failure;
      },
      async (caught) => {
        await Promise.resolve();
        reported.push(caught);
      },
    );

    expect(succeeded).toBe(false);
    expect(reported).toEqual([failure]);
  });

  it("does not leak a second rejection from failure reporting", async () => {
    const succeeded = await runRecoverableTrashAction(
      async () => {
        throw new Error("restore failed");
      },
      async () => {
        throw new Error("reconciliation failed");
      },
    );

    expect(succeeded).toBe(false);
  });
});
