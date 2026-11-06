# Keeping the assistant on money, and how it should talk

Research date: 2026-11-06. Web research only. It adds to [ai-money-assistants.md](ai-money-assistants.md) (what assistants do and what needs approval) and [../users/questions-people-ask.md](../users/questions-people-ask.md) (what people ask).

Evidence key: **[V]** read on the vendor's or regulator's own page. **[S]** secondary source (press, course, third-party guide). **(unverified)** weak source or a page that would not load. **[our note]** our own reading.

## Summary

1. Products keep an assistant on topic with layers, never one fix: a scope in the system prompt, a check on what comes in, a check on what goes out, and one fixed sentence for everything out of scope. [S]
2. Prompt rules reduce off-topic answers and cannot remove them. Every source that says how says to add a check outside the prompt. [S][V]
3. A second model call that classifies each question is the common outside check. It costs two to three times the model spend on that endpoint and adds delay. [S]
4. The largest bank assistant avoids the problem by not letting a generative model write the answer at all: fixed topics, fixed answers, a hand-off when it cannot answer. [S]
5. Money apps that do use a language model ground it in the user's own data, send only the data a question needs, tell users to check anything important, say it is not financial advice, and offer thumbs up and down. [S][V]
6. A company is responsible for what its chatbot says. A regulator names wrong answers and no way out as the two main harms. [S][V]
7. Text that comes from documents or other people must reach the model only as data inside a tool result, encoded, with the rule stated in the system prompt. Our agent already does this. [V]

## 1. How products keep an assistant on topic

- **Layers.** Input validation, output filtering and keeping the conversation in a defined scope; cheap pattern checks first, a model as classifier for unclear cases. [S](https://www.item.com/glossary/conversational-guardrail)
- **The system prompt is the base layer, and it leaks.** Define the topics the agent will discuss; this reduces unwanted answers and cannot eliminate them. Test with questions that must be turned away ("What is the weather today?") and keep watching in production. [V](https://meilisearch.com/docs/capabilities/agentic_search/how_to/configure_guardrails)
- **A topic classifier on every request.** A small, fast classifier is preferred to a large model because it runs each time. [S](https://learn.deeplearning.ai/courses/safe-and-reliable-ai-via-guardrails/lesson/7/keeping-a-chatbot-on-topic) A yes or no model check also works and needs its prompt tuned. [S](https://docs.qualcomm.com/bundle/publicresource/80-88545-1/topics/guarded_llm_example.md)
- **A fixed sentence when off topic.** "If off-topic, respond with a canned redirect." [S](https://www.item.com/glossary/conversational-guardrail)
- **Cost.** Over-tuned guards refuse real questions; model-based guards double or triple the bill for that endpoint and add delay. [S](https://www.item.com/vi/glossary/llm-guardrail)
- **Hosted guard services** take a list of denied topics (a name, a definition, example phrases), check both the question and the answer, and can score whether an answer is supported by the source it was given, blocking it under a threshold. [S](https://awsinsider.net/articles/2025/04/09/creating-ai-guardrails-for-amazon-bedrock-part-2.aspx) (the official AWS page was not in the results)

## 2. What the model vendor recommends (Anthropic's guide)

[V](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)

- Two different threats: the user tries to push the assistant off its rules; or the user is honest and a document, email or tool result carries hidden instructions.
- Against the first: a light model screens the question before the main call, answering with one boolean; pattern checks on input; a system prompt that says exactly how to refuse; slow down or block people who trigger the same refusal again and again.
- Against the second: third-party text goes only inside tool results, never the system prompt or the user's text; say what the content is and where it came from; state in the system prompt that tool content is data and never overrides the request; JSON-encode it; give the model the least access it needs; test with documents that contain injection attempts.
- Watch outputs over time, and combine the layers.
- Keeping a role: set it in the system prompt and list the situations it will meet with the exact reply for each. [V](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency)

## 3. What money assistants do

- **Bank of America's Erica:** about 50 million users and 3 billion interactions; "leans on deterministic AI, rather than generative AI"; the CEO: no room for an assistant to hallucinate with personal finances; about 700 topics; passes the conversation to a person when it cannot answer. [S](https://www.customerexperiencedive.com/news/bank-of-america-erica-virtual-assistants/758334/), [S](https://www.bankingdive.com/news/bank-of-america-erica-virtual-assistant-ai/758519/), [V](https://newsroom.bankofamerica.com/content/newsroom/press-releases/2025/08/a-decade-of-ai-innovation--bofa-s-virtual-assistant-erica-surpas.html.html)
- **Monarch:** answers from the user's own transactions; sends the model only the data a task needs; "Check anything important before you act on it"; thumbs up and down; the assistant can be switched off; a notice on first use that a third-party model is used. [S](https://help.monarch.com/hc/en-us/articles/37526856682260-AI-in-Monarch) (search snippet; the page returned 403)
- **Cleo:** terms say it does not give legal, tax or financial advice and cannot recommend an investment; its models "can't move money". [V](https://web.meetcleo.com/page/uk/term-conditions)
- None of them publishes how its chat is kept on topic. (not found)

## 4. Responsibility

- **Air Canada (2024, a Canadian small-claims tribunal):** the airline had to honour what its chatbot said; the chatbot is "part of Air Canada's website". Commentators said a warning that answers may be wrong might have changed the result. [S](https://ctvnews.ca/business/air-canada-chatbot-decision-a-reminder-of-company-liability-experts-1.6770729)
- **CFPB, "Chatbots in consumer finance" (June 2023):** risks are inaccurate information, no route to a person, disputes not recognised, and personal data; consumer finance law applies to what a chatbot says. I did not check whether the report was later changed. [V](https://files.consumerfinance.gov/f/documents/cfpb_chatbot-issue-spotlight_2023-06.pdf), [S](https://www.consumerfinancemonitor.com/2023/06/08/new-cfpb-report-highlights-concerns-with-growing-use-of-chatbots-by-financial-institutions/)

## 5. Payments by agents

- **Google's AP2 (announced 2025-09-16):** an agent proves a person authorised a purchase with signed "mandates" (intent, cart, payment); PayPal is listed among the partners. Secondary explainers only; PayPal's role and how it relates to OpenAI's protocol were not found. [S](https://venturebeat.com/ai/googles-new-agent-payments-protocol-ap2-allows-ai-agents-to-complete)

## 6. What this means for our app [our note]

Our agent has a property most chat products lack: every true answer comes from a tool over the engine. That lets scope be a rule in code, with no second model call:

- **Three kinds of reply, chosen by code.** An *answer* is shown only when the model used at least one tool in that question, every amount in it is found in the tool results, and it is short. A *clarifying question* comes with its choices as buttons. Everything else gets *one fixed sentence written by us*, with example questions. A model that writes text without using a tool has, by definition, left the app's data.
- **Two fixed sentences, not one.** Off topic altogether; and money questions the app must not answer (which investment, tax filing, legal), which is D7.
- **Follow-ups.** A short thread, so "which Acme?" and "and next month?" work. Earlier turns travel as quoted context, numbers are always read again from the tools.
- **Trust on the screen.** What the answer is based on, as links; thumbs up and down; a first-use line: a model words the answer, the numbers are the app's, check before acting, not financial advice, and which host the question goes to.
- **Slow down repeats.** Count out-of-scope outcomes per household and ask the person to wait after several in an hour.
- **A test set.** Off-topic, advice and jailbreak questions that must all end in the fixed sentence, run in the suite on both protocols and in the model check (D56).
- **Not adopted:** a second model as classifier (cost, delay, and with a household's own model it would be that same model), and answers written only by code (the engine's own sentences exist for three questions, `statusAnswer`, `dueAnswer`, `spendAnswer`; they are what the model quotes).
