const STORAGE_KEY = "editflow_work_mode";
const EVENT_NAME = "editflow:work-mode";

export const WORK_MODES = Object.freeze({ BASIC: "basic", PRO: "pro" });

export function normalizeWorkMode(value) {
  return value === WORK_MODES.PRO ? WORK_MODES.PRO : WORK_MODES.BASIC;
}

export function getWorkMode() {
  if (typeof window === "undefined") return WORK_MODES.BASIC;
  return normalizeWorkMode(window.localStorage.getItem(STORAGE_KEY));
}

export function setWorkMode(value) {
  const mode = normalizeWorkMode(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mode }));
  }
  return mode;
}

export function subscribeWorkMode(listener) {
  if (typeof window === "undefined") return () => {};
  const onMode = (event) => listener(normalizeWorkMode(event.detail));
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY) listener(normalizeWorkMode(event.newValue));
  };
  window.addEventListener(EVENT_NAME, onMode);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onMode);
    window.removeEventListener("storage", onStorage);
  };
}
