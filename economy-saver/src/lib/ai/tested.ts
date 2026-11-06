/**
 * The models the project has run the full assistant evaluation against (D56, D60), with the day it did. Empty until that
 * evaluation fills it; Settings offers these as suggestions and shows "Tested" for them. Any other model is accepted, checked
 * on save, and shown as custom and untested.
 */
export const TESTED: readonly { provider: string; model: string; checkedOn: string }[] = [];

export const isTested = (provider: string, model: string) => TESTED.some(t => t.provider === provider && t.model === model);
