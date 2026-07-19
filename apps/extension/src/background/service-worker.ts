import { captureFragmentRequestSchema } from "@fragment/shared";
import { sendNativeMessage } from "./native-client";
import type { BackgroundMessage, BackgroundReply } from "../shared/messages";
import type { CaptureFragmentRequest } from "../shared/types";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "fragment.capture.toggle" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/capture-mode.js"]
    });
    await chrome.tabs.sendMessage(tab.id, { type: "fragment.capture.toggle" });
  }
});

chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, _sender, sendResponse: (reply: BackgroundReply) => void) => {
    if (message.type === "fragment.frames.list") {
      void sendNativeMessage({
        type: "frames.list",
        requestId: message.requestId
      }).then((response) => {
        if (response.type === "frames.list.result" && response.ok) {
          sendResponse({ ok: true, payload: response.frames });
        } else {
          sendResponse({
            ok: false,
            error: response.type === "error" ? response.error : {
              code: "frames_list_failed",
              message: "Could not load Frames"
            }
          });
        }
      });
      return true;
    }

    if (message.type === "fragment.capture.save") {
      const parsed = captureFragmentRequestSchema.safeParse(message.payload);
      if (!parsed.success) {
        sendResponse({
          ok: false,
          error: {
            code: "invalid_capture_request",
            message: "Capture payload was invalid"
          }
        });
        return false;
      }

      void sendNativeMessage(parsed.data as CaptureFragmentRequest).then((response) => {
        if (response.type === "capture.fragment.result") {
          if (response.ok) {
            sendResponse({ ok: true, payload: response });
          } else {
            sendResponse({
              ok: false,
              error: response.error ?? {
                code: "capture_failed",
                message: "Could not save Fragment"
              }
            });
          }
        } else {
          sendResponse({
            ok: false,
            error: response.type === "error" ? response.error : {
              code: "capture_failed",
              message: "Could not save Fragment"
            }
          });
        }
      });
      return true;
    }

    return false;
  }
);
