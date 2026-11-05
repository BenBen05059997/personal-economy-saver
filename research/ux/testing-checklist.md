# UX testing checklist

What this list is for: a standing, hand-checkable list of what usability reviewers look at in personal-finance and budgeting apps, and what users of those apps complain about most (bank-sync breakage, overwhelming day-one setup, unclear numbers, early requests for sensitive data, unreadable small controls). Run it at 375px and at desktop width, in light and dark, on the Try it household and on a blank one. Items marked ★ are the ten that matter most when a judge sees the app for about three minutes. Evidence quality: the NN/g, Baymard and W3C items are primary sources; the complaint themes about YNAB, Monarch, Copilot, Zaim and MoneyForward come from third-party review summaries and are directional only.

Each item: Check — Why (source id, listed at the end).

## First run and onboarding

1. ★ Check: a first-time visitor with no sign-in sees the Home sentence with a date and a client name within one screen, before any form or sign-up — Why: reviewers judge value before effort; fintech drop-off is tied to asking for data before value is shown (S6)
2. Check: the first screen does not ask for card numbers, bank logins or identity documents; anything sensitive is asked later, at the moment it is needed, with one line saying why — Why: early high-risk requests are a leading cause of abandonment (S6)
3. Check: a new blank household can reach one useful number (safe to spend) after entering at most three things — Why: budgeting apps lose people when day one demands linking accounts, building categories and learning a method (S2)
4. Check: the Try it demo is visibly labelled as sample data with fictional names, and leaving it leads somewhere obvious (sign-in or Start blank) — Why: visibility of system status; users must know whose money they are looking at (S1)
5. ★ Check: the one PayPal action (invoice or nudge) is reachable in two taps from Home and the result is visible on Home afterwards (the sentence changes) — Why: feedback must follow every consequential action immediately (S1)
6. Check: magic-link sign-in says what was sent and to where, offers resend, and handles an expired or reused link with a plain message and a way forward — Why: error states need a specific cause and a next step (S1, S4)
7. Check: no onboarding step requires the user to learn a budgeting method or vocabulary (no unexplained "envelope", "runway", "pot") — Why: method-heavy setup is a stated churn point in YNAB-style apps (S2)

## Reading money: numbers, dates, currencies, safe to spend

8. ★ Check: "safe to spend" shows what it excludes or includes (upcoming bills, unbilled card spend, late clients) in one tap or one line, and the number matches the Plan screen — Why: an unexplained headline number is the main trust failure in budgeting apps; visible system state builds trust (S1)
9. ★ Check: the Home sentence names both outcomes (clients pay as usual / clients late) with a currency symbol and a day, and the two amounts differ by the stated shortfall — Why: a figure without its condition cannot be checked by a reader (S1)
10. Check: every amount shows its currency (¥ or $) wherever USD and JPY can appear together; USD amounts show two decimals, JPY none — Why: JPY has no minor unit; a bare number is ambiguous (S7, S5)
11. Check: thousands separators on every amount of four or more digits, in lists, forms and the assistant's replies — Why: grouping makes magnitude readable and is a standard numeric-field rule (S5, S7)
12. Check: when a USD amount is converted to JPY, the rate and its date are visible or one tap away — Why: invoices in one currency and spending in another is the case where users distrust a silent conversion (S1)
13. Check: dates are unambiguous (month name or year shown, not 03/04), the weekday or relative day appears where timing matters, and "today" matches the household clock — Why: date format ambiguity across locales causes misreads (S7)
14. Check: negative or short amounts are not signalled by colour alone; they carry a sign or word ("short", "over") — Why: colour-only meaning fails colour-blind users (S3)
15. Check: events (Activity, To check) are in date order, with past and future clearly separated and the next event easy to find — Why: orientation in time is the core of a cash-flow view (S1)

## Forms and input

16. ★ Check: every amount field opens a numeric keypad on a phone, has a visible label and currency, and accepts pasted values with commas, ¥, $ or full-width digits — Why: numeric keyboards cut typos; 54% of mobile sites fail to invoke them (S4)
17. Check: error messages name the specific problem ("amount must be under ¥100,000,000"), sit next to the field, and never clear what the user typed — Why: adaptive messages beat generic ones; wiped input on error is a serious failure (S4)
18. Check: validation fires after the user leaves a field, not on the first keystroke, and the error disappears as soon as the field is fixed — Why: premature inline validation annoys; timely clearing speeds correction (S4)
19. Check: amount limits, date limits (two years) and zero or negative entries are refused with the limit stated in the message — Why: error prevention beats error messages (S1)
20. ★ Check: any destructive or outward action (send invoice, nudge, remove person, delete bill) shows exactly what will happen and to whom before the tap, and offers Cancel; removals have a confirm step or an undo — Why: error prevention and user control and freedom (S1)
21. Check: after adding or editing something, the user lands where the change is visible, with a confirmation that names the thing changed — Why: visibility of system status (S1)
22. Check: a double tap on Approve or Save does not create two invoices or two bills — Why: money actions must be safe against repeated taps (S1)

## Trust and privacy

23. ★ Check: the sandbox and fictional-data status is stated where payments happen (for example "PayPal sandbox, no real money") so a judge is not left wondering if it is live — Why: unclear system state erodes trust; honest labelling is a trust cue (S1, S6)
24. Check: the privacy page is linked from sign-in and Settings and says what is stored, who can see it, and how to delete it, in plain language under one screen — Why: privacy information is expected at the point of data entry (S6)
25. Check: when the app reads an uploaded document or forwarded email, it says what was extracted and lets the user correct it before anything is saved or acted on — Why: users distrust automatic categorisation they cannot see or fix (S2)
26. Check: the assistant states when it is only drafting versus sending, and never sends without an explicit approve tap — Why: no action with consequences should happen without informing the user (S1)
27. Check: no screen suggests a named financial product to buy, and nothing presents minimum payments or revolving credit as a solution — Why: suggestions are information, not advice; project rule D7 (project)

## Mobile (375px) and accessibility

28. ★ Check: at 375px no horizontal scroll, no clipped amounts, and Home, Plan, To check, Activity and Settings are all reachable from the bottom or top nav without a hidden gesture — Why: reflow without two-directional scrolling at a 320 CSS px width is a WCAG criterion (S3)
29. Check: every tap target is at least 24x24 CSS px (aim for 44x44) with spacing, especially Approve, Cancel, delete and list-row actions — Why: WCAG 2.5.8 is 24px; 44px is the AAA and platform guideline (S3)
30. Check: body text contrast is at least 4.5:1 and large text and control borders 3:1, in light and dark, including muted grey helper text and disabled buttons — Why: WCAG 1.4.3 and 1.4.11 (S3)
31. Check: browser text size at 200% and page zoom at 400% keep every amount, button and label visible and usable — Why: WCAG 1.4.4 and 1.4.10 (S3)
32. Check: the whole flow Home to Approve works by keyboard with a visible focus ring, and inputs have programmatic labels (not placeholder-only) — Why: unlabeled fields are ambiguous and inaccessible (S5, S3)

## Empty, loading and error states

33. ★ Check: each list (To check, Activity, Plan pots, people, cards) has an empty state that says what goes here and offers the one next action — Why: first-use empty states teach the product and prompt a first action (S6)
34. Check: loading shows a stable skeleton or text, not a blank screen, and a slow PayPal call (20 s timeout) ends in a message with a retry, not a spinner forever — Why: visibility of system status (S1)
35. Check: a failed or late webhook leaves the invoice as "sent, waiting" rather than guessing paid, and the user can see that state — Why: bank and payment sync failures are the top complaint category, and silence about them is what users resent (S2)
36. Check: offline, expired session and 500 pages use plain words, keep the user's place, and give a way back to Home — Why: error messages need a cause and a recovery path (S1)

## Family and shared use

37. ★ Check: a second person joining by link sees what is shared and what is private before accepting, and the Settings people list shows who can see what — Why: shared-finance apps are judged on whether each person understands exposure; privacy cues belong at the point of sharing (S6)
38. Check: split and "who owes whom" shows the direction in words ("Aiko owes Ben ¥4,200") with a total that reconciles to the month view — Why: ambiguous direction on shared balances is a common source of disputes (S1)
39. Check: removing a person or unlinking the family view states what happens to their entries before confirming — Why: error prevention before irreversible actions (S1)

## Sources

- S1 https://www.nngroup.com/articles/ten-usability-heuristics/ (also https://www.nngroup.com/articles/microinteractions/)
- S2 https://envelopebudgeting.com/articles/budgeting-app-syncing-problem, https://unstar.app/blog/tag/ynab, https://checkthat.ai/brands/monarch/reviews (third-party review summaries: directional)
- S3 https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html and https://www.w3.org/TR/WCAG22/ (criteria 1.4.3, 1.4.4, 1.4.10, 1.4.11, 2.5.8); secondary summary https://dequeuniversity.com/rules/axe/4.6/target-size
- S4 https://baymard.com/research-articles/mobile-touch-keyboards, https://baymard.com/research-articles/adaptive-validation-error-messages, https://baymard.com/research-articles/inline-form-validation, https://baymard.com/blog/input-masking-form-field
- S5 https://design.pega.com/components/form-controls/currency-input/, https://docs.guidewire.com/jutro/documentation/10.13/currency
- S6 https://smashingmagazine.com/2017/02/user-onboarding-empty-states-mobile-apps, https://dev.to/pocketportfolioapp/designing-trust-ux-principles-in-fintech-apps-2gfo (practitioner articles: directional)
- S7 https://www.w3.org/International/questions/qa-number-format, https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/NumberFormat
- Japan sync complaints (repeated linkage failures, slow support, fewer supported institutions for Zaim than MoneyForward ME): https://minhyo.jp/zaim-app, https://app-liv.jp/articles/153119/ (user-review sites: directional)
- project: AGENTS.md hard rule 7 and DECISIONS.md D7
