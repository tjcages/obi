import { useCallback, useMemo, useState } from "react";
import { cn, type MemoryState, type PromptSnapshot } from "../../lib";
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  Handle,
  Position,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NodeDetails, type PipelineNodeId } from "./_node-details";

const STAGE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  input:    { bg: "bg-blue-50 dark:bg-blue-950/40",   border: "border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-300" },
  memory:   { bg: "bg-purple-50 dark:bg-purple-950/40", border: "border-purple-200 dark:border-purple-800", text: "text-purple-700 dark:text-purple-300" },
  process:  { bg: "bg-amber-50 dark:bg-amber-950/40",  border: "border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-300" },
  ai:       { bg: "bg-green-50 dark:bg-green-950/40",  border: "border-green-200 dark:border-green-800", text: "text-green-700 dark:text-green-300" },
  output:   { bg: "bg-rose-50 dark:bg-rose-950/40",    border: "border-rose-200 dark:border-rose-800", text: "text-rose-700 dark:text-rose-300" },
};

type PipelineNodeData = {
  label: string;
  subtitle: string;
  category: string;
};

function PipelineNode({ data }: NodeProps<Node<PipelineNodeData>>) {
  const colors = STAGE_COLORS[data.category] ?? STAGE_COLORS.process;
  return (
    <>
      <Handle type="target" position={Position.Left} className="h-2! w-2! border-2! border-background-100! bg-foreground-300!" />
      <div className={cn("cursor-pointer rounded-xl border-2 px-5 py-3 shadow-sm transition-shadow hover:shadow-md", colors.border, colors.bg)}>
        <div className={cn("text-sm font-semibold", colors.text)}>{data.label}</div>
        <div className="mt-0.5 text-xs text-foreground-300">{data.subtitle}</div>
      </div>
      <Handle type="source" position={Position.Right} className="h-2! w-2! border-2! border-background-100! bg-foreground-300!" />
    </>
  );
}

const nodeTypes: NodeTypes = {
  pipeline: PipelineNode as NodeTypes["pipeline"],
};

const NODES: Node<PipelineNodeData>[] = [
  { id: "user-message",     type: "pipeline", position: { x: 0,   y: 120 }, data: { label: "User Message",      subtitle: "Chat input",         category: "input" } },
  { id: "load-memory",      type: "pipeline", position: { x: 220, y: 40 },  data: { label: "Load Memory",       subtitle: "DO Storage",         category: "memory" } },
  { id: "build-prompt",     type: "pipeline", position: { x: 220, y: 200 }, data: { label: "Build Prompt",      subtitle: "Base + facts + ctx", category: "process" } },
  { id: "compact-messages", type: "pipeline", position: { x: 440, y: 120 }, data: { label: "Compact Messages",  subtitle: ">16 → summarize",    category: "memory" } },
  { id: "stream-text",      type: "pipeline", position: { x: 660, y: 120 }, data: { label: "streamText",        subtitle: "LLM + tools",        category: "ai" } },
  { id: "on-finish",        type: "pipeline", position: { x: 880, y: 120 }, data: { label: "onFinish",          subtitle: "Post-response",      category: "output" } },
  { id: "extract-facts",    type: "pipeline", position: { x: 1100, y: 40 }, data: { label: "Extract Facts",     subtitle: "Durable user info",  category: "memory" } },
  { id: "generate-summary", type: "pipeline", position: { x: 1100, y: 200 }, data: { label: "Gen Summary",      subtitle: "Conv summary",       category: "memory" } },
];

const EDGES: Edge[] = [
  { id: "e1", source: "user-message",     target: "load-memory",      animated: true, style: { stroke: "var(--color-foreground-300)" } },
  { id: "e2", source: "user-message",     target: "build-prompt",     animated: true, style: { stroke: "var(--color-foreground-300)" } },
  { id: "e3", source: "load-memory",      target: "compact-messages", animated: true, style: { stroke: "var(--color-foreground-300)" } },
  { id: "e4", source: "build-prompt",     target: "compact-messages", animated: true, style: { stroke: "var(--color-foreground-300)" } },
  { id: "e5", source: "compact-messages", target: "stream-text",      animated: true, style: { stroke: "var(--color-foreground-300)" } },
  { id: "e6", source: "stream-text",      target: "on-finish",        animated: true, style: { stroke: "var(--color-foreground-300)" } },
  { id: "e7", source: "on-finish",        target: "extract-facts",    animated: true, style: { stroke: "var(--color-foreground-300)" } },
  { id: "e8", source: "on-finish",        target: "generate-summary", animated: true, style: { stroke: "var(--color-foreground-300)" } },
];

interface PipelineFlowProps {
  memory: MemoryState | null;
  promptSnapshot: PromptSnapshot | null;
}

export function PipelineFlow({ memory, promptSnapshot }: PipelineFlowProps) {
  const [selectedNode, setSelectedNode] = useState<PipelineNodeId | null>(null);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id as PipelineNodeId);
  }, []);

  const nodes = useMemo(() => NODES, []);
  const edges = useMemo(() => EDGES, []);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.5}
        className="rounded-xl"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-foreground-300)" className="opacity-30" />
      </ReactFlow>

      {selectedNode && (
        <div className="absolute bottom-4 left-4 right-4 z-10 max-w-lg">
          <NodeDetails
            nodeId={selectedNode}
            memory={memory}
            promptSnapshot={promptSnapshot}
            onClose={() => setSelectedNode(null)}
          />
        </div>
      )}
    </div>
  );
}
