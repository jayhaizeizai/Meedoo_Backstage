export function safeReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/") || /[\\\x00-\x20\x7f]/.test(value))
    return "/upload";
  try {
    const url = new URL(value, "https://meedoo.invalid");
    return url.origin === "https://meedoo.invalid"
      ? url.pathname + url.search + url.hash
      : "/upload";
  } catch {
    return "/upload";
  }
}
