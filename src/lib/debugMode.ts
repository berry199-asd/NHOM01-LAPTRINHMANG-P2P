export function isDebugMode(): boolean {
  try {
    if (typeof window === "undefined") return false
    const params = new URLSearchParams(window.location.search)
    if (params.get("debug") === "1") return true
    if (typeof window.localStorage !== "undefined") {
      return window.localStorage.getItem("workchat.debug") === "1"
    }
  } catch {
    /* fallback an toàn */
  }
  return false
}
