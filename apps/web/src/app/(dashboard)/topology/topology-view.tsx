"use client";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  Handle, Position, MarkerType, type Edge, type Node, type NodeProps, type NodeMouseHandler,
} from "@xyflow/react";
import { Cloud, Cpu, HelpCircle, Laptop, Maximize2, Network as NetIcon, RadioTower, RefreshCw, RotateCcw, Router as RouterIcon, Server, Smartphone, Waypoints } from "lucide-react";
import { api } from "@/lib/fetcher";
import type { Topology, TopoEdge, TopoNode } from "@/services/topology";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { ago } from "@/components/status-dot";
import { cn } from "@/lib/utils";

const ICONS = { internet: Cloud, router: RouterIcon, network: NetIcon, collector: RadioTower, computer: Laptop, phone: Smartphone, iot: Cpu, switch: Server, unknown: HelpCircle } as const;
const KIND_LABEL = { internet: "Internet", router: "Router", network: "Network segment", collector: "Collector", computer: "Computer", phone: "Phone / tablet", iot: "IoT / media", switch: "Switch / AP", unknown: "Unknown device" } as const;
const EVIDENCE_STYLE: Record<TopoEdge["evidence"], { stroke: string; dash?: string; width: number; label: string; desc: string }> = {
  VERIFIED: { stroke: "var(--success)", width: 2, label: "Verified", desc: "Reported directly by a router or collector" },
  CONFIGURED: { stroke: "var(--primary)", dash: "8 4", width: 1.75, label: "Configured", desc: "Relationship set up by an administrator" },
  INFERRED: { stroke: "var(--warning)", dash: "2 5", width: 1.5, label: "Inferred", desc: "Derived from IP addressing — not a confirmed cable" },
  UNKNOWN: { stroke: "var(--muted-foreground)", dash: "1 6", width: 1, label: "Unknown", desc: "Stale or missing evidence" },
};
const CATEGORY_FILTERS = [["all", "All devices"], ["computer", "Computers"], ["phone", "Phones / tablets"], ["iot", "IoT / media"], ["switch", "Switches / APs"], ["unknown", "Unknown"]] as const;

type NodeData = TopoNode & Record<string, unknown>;

function TopoNodeView({ data, selected }: NodeProps<Node<NodeData>>) {
  const Icon = ICONS[data.kind];
  const big = data.kind === "router" || data.kind === "internet" || data.kind === "network";
  const statusColor = data.status === "ONLINE" || data.status === "CONNECTED" ? "bg-success" : data.status === "OFFLINE" || data.status === "DISCONNECTED" ? "bg-destructive" : "bg-muted-foreground";
  return (
    <div className={cn("rounded-md border bg-card text-left shadow-sm", big ? "min-w-[170px] px-3 py-2" : "min-w-[130px] px-2 py-1.5",
      data.kind === "router" && "border-primary", data.kind === "network" && "border-dashed bg-muted", data.kind === "internet" && "rounded-full border-primary",
      data.kind === "collector" && "border-warning", data.status === "OFFLINE" && "opacity-60", selected && "ring-2 ring-primary")}
      title={`${KIND_LABEL[data.kind]}${data.status ? ` · ${data.status.toLowerCase()}` : ""}`}>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
      <div className="flex items-center gap-2">
        <Icon className={cn("shrink-0", big ? "h-4 w-4" : "h-3.5 w-3.5", data.kind === "router" || data.kind === "internet" ? "text-primary" : data.kind === "collector" ? "text-warning" : "text-muted-foreground")} />
        <div className="min-w-0">
          <div className={cn("truncate font-medium", big ? "text-sm" : "text-xs")}>{data.label}</div>
          {data.sublabel && <div className="truncate font-mono text-[10px] text-muted-foreground">{data.sublabel}</div>}
        </div>
        {data.status && <span className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", statusColor)} aria-label={data.status.toLowerCase()} />}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
    </div>
  );
}
const nodeTypes = { topo: TopoNodeView };

/** Tiered automatic layout: Internet → main routers → segments → secondary routers/collectors → devices under their parent. */
function autoLayout(t: Topology): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const parentOf = new Map<string, string>();
  for (const e of t.edges) if (!parentOf.has(e.target)) parentOf.set(e.target, e.source);
  const byTier = new Map<number, TopoNode[]>();
  for (const n of t.nodes) { const a = byTier.get(n.tier) ?? []; a.push(n); byTier.set(n.tier, a); }
  const Y = [0, 130, 260, 400, 530, 690];
  const W = 220;
  for (const tier of [0, 1, 2, 3, 4]) {
    const list = (byTier.get(tier) ?? []).sort((a, b) => String(a.networkId).localeCompare(String(b.networkId)));
    list.forEach((n, i) => {
      const p = parentOf.get(n.id); const px = p ? pos[p]?.x : undefined;
      pos[n.id] = { x: px !== undefined && tier >= 2 ? px + (i % 3) * 30 : (i - (list.length - 1) / 2) * W * 1.4, y: Y[tier]! };
    });
    // spread nodes that ended up overlapping
    const sorted = list.map((n) => n.id).sort((a, b) => pos[a]!.x - pos[b]!.x);
    for (let i = 1; i < sorted.length; i++) if (pos[sorted[i]!]!.x - pos[sorted[i - 1]!]!.x < W) pos[sorted[i]!]!.x = pos[sorted[i - 1]!]!.x + W;
  }
  const groups = new Map<string, TopoNode[]>();
  for (const n of byTier.get(5) ?? []) { const p = parentOf.get(n.id) ?? "none"; const g = groups.get(p) ?? []; g.push(n); groups.set(p, g); }
  let cursor = Math.min(0, ...Object.values(pos).map((p) => p.x));
  for (const [p, list] of groups) {
    const cols = Math.min(4, Math.ceil(Math.sqrt(list.length)));
    const parent = pos[p];
    const parentTier = t.nodes.find((n) => n.id === p)?.tier ?? 2;
    const startX = Math.max(cursor, (parent?.x ?? cursor) - ((cols - 1) * 160) / 2);
    const baseY = (Y[parentTier] ?? 280) + 150;
    list.forEach((n, i) => { pos[n.id] = { x: startX + (i % cols) * 160, y: baseY + Math.floor(i / cols) * 70 }; });
    cursor = startX + cols * 160 + 60;
  }
  return pos;
}

function toFlow(t: Topology): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const auto = autoLayout(t);
  return {
    nodes: t.nodes.map((n) => ({ id: n.id, type: "topo", position: t.positions[n.id] ?? auto[n.id] ?? { x: 0, y: 0 }, data: n as NodeData })),
    edges: t.edges.map((e) => {
      const s = EVIDENCE_STYLE[e.evidence];
      return {
        id: e.id, source: e.source, target: e.target, data: { ...e },
        style: { stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash },
        markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 14, height: 14 },
        label: e.evidence === "VERIFIED" && e.connectionType !== "LOGICAL" ? e.connectionType.toLowerCase() : e.evidence === "INFERRED" ? "inferred" : e.connectionType === "WIRELESS" ? "wireless" : undefined,
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 }, labelBgStyle: { fill: "var(--card)" },
        ariaLabel: `${s.label} ${e.connectionType.toLowerCase()} link: ${e.discoverySource}`,
      } satisfies Edge;
    }),
  };
}

export function TopologyView({ initial }: { initial: Topology }) {
  return <ReactFlowProvider><Inner initial={initial} /></ReactFlowProvider>;
}

function Inner({ initial }: { initial: Topology }) {
  const router = useRouter();
  const qc = useQueryClient();
  const rf = useReactFlow();
  const [networkId, setNetworkId] = useState("");
  const [category, setCategory] = useState("all");
  const [showOffline, setShowOffline] = useState(true);
  const params = `?showOffline=${showOffline}${networkId ? `&networkId=${networkId}` : ""}${category !== "all" ? `&category=${category}` : ""}`;
  const isDefault = !networkId && category === "all" && showOffline;
  const q = useQuery({ queryKey: ["topology", networkId, category, showOffline], queryFn: async () => (await api<Topology>(`/topology${params}`)).data, initialData: isDefault ? initial : undefined, staleTime: 30_000 });
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<{ node?: TopoNode; edge?: TopoEdge } | null>(null);
  const firstFit = useRef(true);

  useEffect(() => {
    if (!q.data) return;
    const f = toFlow(q.data);
    setNodes(f.nodes); setEdges(f.edges);
    if (firstFit.current) { firstFit.current = false; requestAnimationFrame(() => void rf.fitView({ padding: 0.15 })); }
  }, [q.data, setNodes, setEdges, rf]);

  const save = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDragStop = useCallback((_: unknown, _n: Node, moved: Node[]) => {
    if (save.current) clearTimeout(save.current);
    save.current = setTimeout(() => void api("/topology/layout", { method: "PUT", body: JSON.stringify({ positions: moved.map((m) => ({ id: m.id, x: m.position.x, y: m.position.y })) }) }), 400);
  }, []);
  const open = (n: TopoNode) => {
    if (n.kind === "router" && n.entityId) router.push(`/routers/${n.entityId}`);
    else if (n.id.startsWith("device:") && n.entityId) router.push(`/devices/${n.entityId}`);
    else if (n.kind === "collector") router.push("/collectors");
    else if (n.kind === "network") router.push("/networks");
  };
  const onNodeClick: NodeMouseHandler<Node<NodeData>> = (_, n) => setSelected({ node: n.data });
  const resetLayout = async () => { await api("/topology/layout", { method: "DELETE" }); await qc.invalidateQueries({ queryKey: ["topology"] }); firstFit.current = true; };

  const t = q.data;
  const counts = useMemo(() => {
    const c: Record<string, number> = { VERIFIED: 0, CONFIGURED: 0, INFERRED: 0, UNKNOWN: 0 };
    for (const e of t?.edges ?? []) c[e.evidence]!++;
    return c;
  }, [t]);

  return (
    <>
      <PageHeader title="Network Topology" description="Built from discovered devices, router reports and configured relationships. Line style shows how each link is known." />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Filter by network" value={networkId} onChange={(e) => setNetworkId(e.target.value)} className="rounded-md border bg-card px-2 py-1.5 text-sm">
          <option value="">All networks</option>
          {(t?.networks ?? initial.networks).map((n) => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
        </select>
        <select aria-label="Filter by device category" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border bg-card px-2 py-1.5 text-sm">
          {CATEGORY_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1.5 rounded-md border px-2 py-1.5"><input type="checkbox" checked={showOffline} onChange={(e) => setShowOffline(e.target.checked)} /> Show offline devices</label>
        <div className="ml-auto flex gap-2">
          <button onClick={() => void q.refetch()} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 hover:bg-accent"><RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} />Refresh</button>
          <button onClick={() => void rf.fitView({ padding: 0.15, duration: 300 })} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 hover:bg-accent"><Maximize2 className="h-3.5 w-3.5" />Fit to screen</button>
          <button onClick={() => void resetLayout()} title="Forget moved positions and use the automatic layout" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" />Reset layout</button>
        </div>
      </div>

      {t && t.nodes.length === 0 ? (
        <EmptyState icon={Waypoints} title="Nothing to draw yet" body="Add a network and run a discovery scan, or add a router. The map is built only from real records." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="panel h-[70vh] min-h-[480px] overflow-hidden">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onNodeDragStop={onDragStop} onNodeClick={onNodeClick} onNodeDoubleClick={(_, n) => open(n.data)} onEdgeClick={(_, e) => setSelected({ edge: e.data as unknown as TopoEdge })}
              nodesConnectable={false} edgesFocusable elementsSelectable minZoom={0.1} maxZoom={2.5} proOptions={{ hideAttribution: true }} colorMode="dark">
              <Background gap={24} color="var(--border)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(n) => ((n.data as NodeData).kind === "router" ? "var(--primary)" : (n.data as NodeData).status === "OFFLINE" ? "var(--destructive)" : "var(--muted-foreground)")} maskColor="rgba(0,0,0,0.5)" style={{ background: "var(--card)" }} />
            </ReactFlow>
          </div>
          <aside className="space-y-3">
            <div className="panel p-3">
              <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Link evidence</h2>
              <ul className="space-y-2 text-xs">
                {(Object.keys(EVIDENCE_STYLE) as TopoEdge["evidence"][]).map((k) => { const s = EVIDENCE_STYLE[k]; return (
                  <li key={k} className="flex items-start gap-2">
                    <svg width="34" height="10" className="mt-1 shrink-0" aria-hidden><line x1="0" y1="5" x2="34" y2="5" stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} /></svg>
                    <span><span className="font-medium">{s.label}</span> <span className="text-muted-foreground">({counts[k]})</span><br /><span className="text-muted-foreground">{s.desc}</span></span>
                  </li>); })}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">Devices linked to a network segment are shown as subnet members, not physical cables. Wired/wireless appears only when a router reports it.</p>
            </div>
            <div className="panel p-3 text-sm">
              <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Selection</h2>
              {!selected && <p className="text-xs text-muted-foreground">Click a node or link for details. Double-click a router or device to open it. Drag nodes to rearrange; positions are saved.</p>}
              {selected?.node && (
                <div className="space-y-1.5">
                  <div className="font-medium">{selected.node.label}</div>
                  <div className="text-xs text-muted-foreground">{KIND_LABEL[selected.node.kind]}{selected.node.status ? ` · ${selected.node.status.toLowerCase()}` : ""}</div>
                  {selected.node.sublabel && <div className="font-mono text-xs">{selected.node.sublabel}</div>}
                  {Object.entries(selected.node.detail ?? {}).filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-2 text-xs"><span className="text-muted-foreground">{k}</span><span className="truncate font-mono">{v}</span></div>)}
                  {(selected.node.kind === "router" || selected.node.id.startsWith("device:") || selected.node.kind === "network" || selected.node.kind === "collector") && (
                    <button onClick={() => open(selected.node!)} className="mt-2 w-full rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground">Open {selected.node.kind === "router" ? "router" : selected.node.kind === "network" ? "networks" : selected.node.kind === "collector" ? "collectors" : "device"} details</button>
                  )}
                </div>
              )}
              {selected?.edge && (
                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Evidence</dt><dd style={{ color: EVIDENCE_STYLE[selected.edge.evidence].stroke }}>{EVIDENCE_STYLE[selected.edge.evidence].label}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Connection</dt><dd>{selected.edge.connectionType.toLowerCase()}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Confidence</dt><dd>{selected.edge.confidence}%</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Last verified</dt><dd>{ago(selected.edge.lastVerifiedAt)}</dd></div>
                  <div><dt className="text-muted-foreground">Source</dt><dd className="mt-0.5">{selected.edge.discoverySource}</dd></div>
                </dl>
              )}
            </div>
            <p className="px-1 text-[11px] text-muted-foreground">Built {ago(t?.generatedAt)}{t?.truncated ? " · showing the first 2000 devices" : ""}</p>
          </aside>
        </div>
      )}
    </>
  );
}
