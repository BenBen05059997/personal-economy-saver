import type { Formula } from "../types";
import { jpFormulas } from "./jp";
import { usFormulas } from "./us";

export const formulas: Record<string, Formula> = { ...jpFormulas, ...usFormulas };
