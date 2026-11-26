/** Saves a JSON document as a file on the user's device. */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A file name from a person's or campaign's name. */
export const fileSafe = (name: string, fallback: string) => name.replace(/[^\w -]+/g, "").trim() || fallback;
