/** One operator line for a setting problem; the person sees plain words, the log names the setting. */
export function logSettingProblem(at: string, message: string, householdId?: string) {
  console.error(JSON.stringify({ at, householdId, message }));
}
