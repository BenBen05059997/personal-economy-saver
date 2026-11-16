// The words a person reads while Ask works: one fixed line per tool (`words` on the tool), words only, never an amount, an argument or a result.
import { tools } from "./tools";

export const THINKING_WORDS = "Thinking about your question";
const WORKING_WORDS = "Working on it";

/** The line for a tool name. A name outside the catalogue (the model made it up) gets the plain line. */
export function toolWords(name: string): string {
  return tools.find(tool => tool.name === name)?.words ?? WORKING_WORDS;
}
