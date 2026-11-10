/** "1 invoice", "2 invoices": the word in its singular or plural form for a count. Pure; irregular words pass `many`. */
export const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
