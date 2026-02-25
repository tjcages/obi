import type { MemoryState, PromptSnapshot } from "../../lib";

export type PipelineNodeId =
  | "user-message"
  | "load-memory"
  | "build-prompt"
  | "compact-messages"
  | "stream-text"
  | "on-finish"
  | "extract-facts"
  | "generate-summary";

interface NodeDetailsProps {
  nodeId: PipelineNodeId;
  memory: MemoryState | null;
  promptSnapshot: PromptSnapshot | null;
  onClose: () => void;
}

const NODE_INFO: Record<PipelineNodeId, { title: string; description: string }> = {
  "user-message": {
    title: "User Message",
    description: "The incoming chat message from the user. This is appended to the conversation history and triggers the AI pipeline.",
  },
  "load-memory": {
    title: "Load Memory",
    description: "Loads persistent memory from Durable Object storage: compaction summary, user facts, and conversation summaries.",
  },
  "build-prompt": {
    title: "Build System Prompt",
    description: "Constructs the full system prompt by combining the base prompt template with known user facts and recent conversation summaries.",
  },
  "compact-messages": {
    title: "Compact Messages",
    description: "When conversation exceeds 16 messages, older messages are summarized by the LLM into a compaction summary. The 10 most recent messages are kept.",
  },
  "stream-text": {
    title: "streamText + Tools",
    description: "Calls the LLM with the constructed prompt, conversation history, and available tools (codemode for Gmail API). Stops after 6 tool-use steps.",
  },
  "on-finish": {
    title: "onFinish Callback",
    description: "Fires after the stream completes. Checks for substantive content before triggering background memory extraction.",
  },
  "extract-facts": {
    title: "Extract User Facts",
    description: "Uses the LLM to identify durable facts about the user from the conversation. Deduplicates and consolidates when the list exceeds 30 facts.",
  },
  "generate-summary": {
    title: "Generate Summary",
    description: "Produces a one-sentence conversation summary (max 15 words) for use in future conversations' context.",
  },
};

export function NodeDetails({ nodeId, memory, promptSnapshot, onClose }: NodeDetailsProps) {
  const info = NODE_INFO[nodeId];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-100 bg-background-100 p-5 shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground-100">{info.title}</h3>
          <p className="mt-1 text-sm text-foreground-300">{info.description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="border-t border-border-100 pt-3">
        {nodeId === "load-memory" && memory && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-300">User facts</span>
              <span className="font-mono text-foreground-100">{memory.userFacts.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-300">Conversation summaries</span>
              <span className="font-mono text-foreground-100">{memory.conversationSummaries.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-300">Has compaction</span>
              <span className="font-mono text-foreground-100">{memory.compactionSummary ? "Yes" : "No"}</span>
            </div>
          </div>
        )}

        {nodeId === "build-prompt" && promptSnapshot && (
          <div className="max-h-64 overflow-y-auto rounded-lg bg-background-200 p-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-foreground-200">
              {promptSnapshot.prompt}
            </pre>
          </div>
        )}

        {nodeId === "compact-messages" && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-300">Threshold</span>
              <span className="font-mono text-foreground-100">16 messages</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-300">Keep recent</span>
              <span className="font-mono text-foreground-100">10 messages</span>
            </div>
            {memory?.compactionSummary && (
              <div className="mt-2">
                <span className="text-xs text-foreground-300">Current compaction:</span>
                <p className="mt-1 rounded bg-background-200 p-2 font-mono text-xs text-foreground-200">
                  {memory.compactionSummary.slice(0, 300)}
                  {memory.compactionSummary.length > 300 && "..."}
                </p>
              </div>
            )}
          </div>
        )}

        {nodeId === "stream-text" && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-300">Model</span>
              <span className="font-mono text-foreground-100">@cf/zai-org/glm-4.7-flash</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-300">Max steps</span>
              <span className="font-mono text-foreground-100">6</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-300">Tools</span>
              <span className="font-mono text-foreground-100">codemode (Gmail API)</span>
            </div>
          </div>
        )}

        {nodeId === "extract-facts" && memory && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-300">Current facts</span>
              <span className="font-mono text-foreground-100">{memory.userFacts.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-300">Max facts</span>
              <span className="font-mono text-foreground-100">50</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-300">Consolidation threshold</span>
              <span className="font-mono text-foreground-100">30</span>
            </div>
          </div>
        )}

        {nodeId === "generate-summary" && memory && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-300">Total summaries</span>
              <span className="font-mono text-foreground-100">{memory.conversationSummaries.length}</span>
            </div>
            {memory.conversationSummaries.length > 0 && (
              <div className="mt-2">
                <span className="text-xs text-foreground-300">Recent:</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {memory.conversationSummaries.slice(-3).reverse().map((s) => (
                    <li key={s.id} className="rounded bg-background-200 px-2 py-1 text-xs text-foreground-200">
                      <span className="text-foreground-300">{s.date}:</span> {s.summary}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {(nodeId === "user-message" || nodeId === "on-finish") && (
          <p className="text-sm text-foreground-300">
            {nodeId === "user-message"
              ? "Each user message flows through the full pipeline, from memory loading through response generation and back to memory extraction."
              : "The onFinish callback checks hasSubstantiveContent() — requires either an assistant message > 20 chars or at least one tool call. Trivial exchanges are skipped."}
          </p>
        )}
      </div>
    </div>
  );
}
