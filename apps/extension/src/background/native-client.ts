import type { NativeRequest, NativeResponse } from "../shared/types";

const HOST_NAME = "com.autoscale.fragment";

export function sendNativeMessage(request: NativeRequest): Promise<NativeResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, request, (response: NativeResponse | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve(errorResponse(request, "native_host_unavailable", lastError.message ?? "Fragment native host is unavailable"));
        return;
      }

      if (!response) {
        resolve(errorResponse(request, "native_host_empty_response", "Fragment native host returned no response"));
        return;
      }

      resolve(response);
    });
  });
}

function errorResponse(
  request: NativeRequest,
  code: string,
  message: string
): NativeResponse {
  const requestId = "requestId" in request ? request.requestId : undefined;
  return {
    type: "error",
    ...(requestId ? { requestId } : {}),
    ok: false,
    error: { code, message }
  };
}
