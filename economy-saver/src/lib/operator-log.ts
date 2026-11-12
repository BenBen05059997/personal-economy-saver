/** One operator line for a setting problem; the person sees plain words, the log names the setting. A warning, not an error: a missing setting is a state the page reports, and Next's dev overlay counts every console error as an issue. */
export function logSettingProblem(at: string, message: string, householdId?: string) {
  console.warn(JSON.stringify({ at, householdId, message }));
}
