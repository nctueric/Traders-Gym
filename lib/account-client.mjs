export function createSessionScope(sessionId, fetcher = globalThis.fetch) {
  let controller = new AbortController();
  const assertActive = () => { if (controller.signal.aborted) throw Object.assign(new Error("登入工作階段已結束"), { status: 401, retryable: false }); };
  return {
    stop: () => controller.abort(), assertActive,
    activate: () => { if (controller.signal.aborted) controller = new AbortController(); },
    async fetch(input, init = {}) {
      assertActive();
      const captured = controller;
      let response;
      try {
        response = await fetcher(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-workspace-session": sessionId }, signal: init.signal ? AbortSignal.any([init.signal, captured.signal]) : captured.signal });
      } catch (error) {
        if (captured.signal.aborted) throw Object.assign(new Error("登入工作階段已結束，請重新登入"), { status: 401, retryable: false });
        throw error;
      }
      if (captured.signal.aborted) throw Object.assign(new Error("登入工作階段已結束"), { status: 401, retryable: false });
      assertActive();
      if (response.status === 401 || response.status === 403) {
        controller.abort();
        throw Object.assign(new Error("登入已到期或帳號已變更，請重新登入"), { status: response.status, retryable: false });
      }
      return response;
    },
  };
}
