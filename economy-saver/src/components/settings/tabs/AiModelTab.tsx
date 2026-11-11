import { Suspense } from "react";
import type { McpTokenInfo } from "@/db/mcp-tokens";
import { McpTokens } from "@/components/mcp/McpTokens";
import { LoadingIndicator } from "@/components/ui/LoadingState";
import { AiModelPanel } from "../AiModelPanel";

/** Settings → Your AI model: the household's model and the keys other assistants connect with. A member sees only who may change them. */
export function AiModelTab({ canManage, demo, tokens }: { canManage: boolean; demo: boolean; tokens: McpTokenInfo[] }) {
  if (!canManage) return <section className="ui-panel" id="ai-model"><h2>Your AI model</h2>
    <p className="ui-hint">Only the household owner can choose the AI model or make keys for other assistants.</p></section>;
  return <>
    <Suspense fallback={<section className="ui-panel" id="ai-model"><h2>Your AI model</h2><LoadingIndicator label="Loading…" /></section>}>
      <AiModelPanel demo={demo} /></Suspense>
    <McpTokens tokens={tokens} />
  </>;
}
