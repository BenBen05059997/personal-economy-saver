# fipa (Personal Economy Saver) — Devpost

**Pitch:** Know before the card bill does. fipa is a money agent for people paid through PayPal: it reads your bills, tells you whether to spend or hold off, and gets you paid through PayPal when you approve.

## Inspiration

Freelancers can have enough income on paper and still be short on the day a bill is due. The useful question is not "what is my balance?" It is "what changes if this client pays late, and what can I do now?"

fipa follows that question for one fictional person: Ben, a freelance designer in Tokyo, paid in US dollars through PayPal. His bills, card spend and expected client payments sit in one 30-day view.

## What it does

Home opens with one dated sentence: "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th." Below it are safe to spend (including card spend not yet billed), the events in date order, and one PayPal action Ben approves.

- **Getting paid.** For finished work, Ben taps "Approve and make payment link". fipa makes a PayPal sandbox payment link, and the client pays it. A signature-verified PayPal webhook marks it paid, and the sentence changes to "You're fine for the next 30 days". For a late client, the same action offers the link again. The browser never sets payment state.
- **Ask.** Ben asks in his own words. Ask opens with a greeting and suggestion buttons. Answers use the real numbers from the cash-flow engine. They can lay out a canvas of charts and tables whose blocks hold queries, never numbers, so a pinned canvas always shows today's figures. Every answer ends with "See it" buttons that open the right page and light up the row. Ask remembers what it is told, and Ben can see and delete every memory.
- **Bill photos and PDFs.** Attach a photo or PDF in Ask. fipa reads it into a card (amount, due date, category). Nothing is saved until Ben taps Confirm. The card then says where it was saved and links there. Bills can also be forwarded by email or typed in.
- **Family split.** Add a person, for example Aki, Ben's wife. Shares are equal by default. Say "split with Aki" or "this one is Aki's" in Ask. Spending and the Ask chart show the month by person. Home shows "Aki owes Ben ¥4,200", and **Request by PayPal** makes a sandbox payment link for Aki to pay, converted to USD at the household rate. The same verified webhook settles it.
- **Pots and planning.** Pots hold money for a reason, such as a tax percentage of each client payment. Money in a pot comes off safe to spend.
- **Your own model.** The household chooses the AI model, including its own key.
- **Other doors.** The same read and draft tools are an MCP server, so Claude Code or another MCP client can ask where Ben stands. Sending still needs the tap in the app.

## How we built it

The model only understands, picks tools and words the result. Code does every sum, every check and every write. So no model can send money, invent a number or save something unconfirmed.

- **A deterministic engine.** Integer minor-unit money, household-scoped queries and one pure cash-flow calculation behind every number on every screen.
- **One send path.** The agent and the MCP server get read and draft tools only. A payment link is made only on the Approve tap. Lint fails any other import of those calls.
- **Verified payments.** The webhook signature is checked before anything changes. A repeated delivery never applies a payment twice.
- **Checked reading.** A bill read by the model goes through fixed checks in code, then waits for Confirm.
- **Sandbox only.** The app refuses anything but `PAYPAL_ENVIRONMENT=SANDBOX` and the sandbox host. All data is fictional.

## Tools used

- **Anthropic Claude (claude-sonnet-5-5):** the server default for Ask (understanding the question, choosing tools, wording the result) and for reading bill photos and PDFs. A household can choose another model or bring its own key.
- **PayPal sandbox REST APIs:** Orders (the payment links), partner onboarding and seller status, balances and transaction search, and webhook signature verification.
- **Model Context Protocol:** the MCP server over the same read and draft tools.
- **Next.js 16 and TypeScript on Cloudflare Workers.**
- **Supabase:** Postgres, magic-link sign-in, private storage for uploads, and Vault for keys.

## Challenges

- Keeping the model useful without letting it near the money. Every number comes from code and every write waits for a tap.
- Making a canvas out of model output while keeping numbers out of it. Blocks hold queries and the engine fills them each time.
- Payment state that can be trusted: verified webhooks, no double counting, and a link that reopens if PayPal declines.
- Splitting a bill between two people and settling it through the same PayPal path.

## Accomplishments

- A full loop works in the sandbox: approve, a client pays, a verified webhook lands and the sentence changes.
- Ask answers from the household's own numbers and shows where to look.
- A bill photo becomes a checked card, and nothing is saved without Confirm.
- Household isolation is tested in both directions across every data function.

## What we learned

A money agent earns trust by what it cannot do. Putting the arithmetic and the writes in code, and the language in the model, made the product easier to build and easier to believe. One clear sentence with a date and a name worked better than a dashboard.

## What's next

- More ways in: banks and cards without handing over a login.
- Reminders and nudges that reach the person outside the app.
- Salaried households, once the freelance loop is proven.

## Try it

- Live demo: https://personal-economy-saver.globalperspectives-app.workers.dev. Tap "Try it" for a fresh fictional household. No sign-up.
- Code: https://github.com/BenBen05059997/personal-economy-saver
- Run it locally: see `economy-saver/README.md`.
- Demo video: owner to add the YouTube link.
