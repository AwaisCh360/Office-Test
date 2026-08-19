import { useEffect, useRef, useState, useLayoutEffect } from "react";
import * as d3 from "d3-hierarchy";

const mix = (hue: string, pct: number, base = "var(--surface)") =>
  `color-mix(in srgb, ${hue} ${pct}%, ${base})`;

export type AgentNode = {
  id: string;
  name: string;
  parent_id: string | null;
  status: string;
};

export default function AgentGraph({ agents, onNodeClick }: { agents: AgentNode[], onNodeClick?: (id: string) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [initialized, setInitialized] = useState(false);
  
  // Pan state
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  
  // Node dragging state
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number, dy: number }>>({});
  const nodeDrag = useRef<{ id: string, startX: number, startY: number, baseDx: number, baseDy: number, moved: boolean } | null>(null);

  // Handle Panning
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".agent-node")) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  };

  const onPointerUp = () => {
    setIsDragging(false);
  };

  // Handle Node Dragging
  const onNodePointerDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const off = nodeOffsets[id];
    nodeDrag.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: off?.dx ?? 0,
      baseDy: off?.dy ?? 0,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onNodePointerMove = (id: string, e: React.PointerEvent) => {
    const d = nodeDrag.current;
    if (!d || d.id !== id) return;
    e.stopPropagation();
    const dx = d.baseDx + (e.clientX - d.startX) / zoom;
    const dy = d.baseDy + (e.clientY - d.startY) / zoom;
    if (!d.moved && Math.hypot(dx - d.baseDx, dy - d.baseDy) < 3) return;
    d.moved = true;
    setNodeOffsets(prev => ({ ...prev, [id]: { dx, dy } }));
  };

  const onNodePointerUp = (id: string, e: React.PointerEvent) => {
    const d = nodeDrag.current;
    if (d?.id === id) {
      e.stopPropagation();
      if (!d.moved && onNodeClick) {
        onNodeClick(id);
      }
      setTimeout(() => (nodeDrag.current = null), 0);
    }
  };

  // Build Hierarchy safely
  let root: d3.HierarchyPointNode<AgentNode> | null = null;
  try {
    // Ensure exactly 1 root by checking parent_ids
    const parentIds = new Set(agents.map(a => a.parent_id).filter(Boolean));
    const allIds = new Set(agents.map(a => a.id));
    
    // Some agents might have parents that don't exist yet, make them children of a dummy root or treat as root
    const safeAgents = agents.map(a => ({
      ...a,
      parent_id: (a.parent_id && allIds.has(a.parent_id)) ? a.parent_id : null
    }));

    // If multiple roots exist, stratify will fail. We need to create a dummy root if so.
    const roots = safeAgents.filter(a => !a.parent_id);
    let finalAgents = safeAgents;
    if (roots.length > 1) {
      finalAgents = [
        { id: "dummy-root", name: "System", parent_id: null, status: "completed" },
        ...safeAgents.map(a => !a.parent_id ? { ...a, parent_id: "dummy-root" } : a)
      ];
    }

    const stratData = d3.stratify<AgentNode>()
      .id(d => d.id)
      .parentId(d => d.parent_id)(finalAgents);

    const treeLayout = d3.tree<AgentNode>().nodeSize([250, 100]); // [dx, dy]
    root = treeLayout(stratData);
  } catch (e) {
    console.error("Tree layout error:", e);
  }

  if (!root) {
    return <div className="p-8 text-ink-3">Rendering graph...</div>;
  }

  const nodes = root.descendants().filter(n => n.data.id !== "dummy-root");
  const links = root.links().filter(l => l.source.data.id !== "dummy-root");

  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  });

  // Calculate canvas dimensions based on nodes
  const canvasW = Math.max((maxX - minX) + 500, 800);
  const canvasH = Math.max(maxY + 200, 400);

  const xOffset = canvasW / 2;
  const yOffset = 50;

  const bezier = (source: d3.HierarchyPointNode<AgentNode>, target: d3.HierarchyPointNode<AgentNode>) => {
    const sOff = nodeOffsets[source.data.id] || { dx: 0, dy: 0 };
    const tOff = nodeOffsets[target.data.id] || { dx: 0, dy: 0 };
    
    const sx = source.x + xOffset + sOff.dx;
    const sy = source.y + yOffset + 20 + sOff.dy; 
    const tx = target.x + xOffset + tOff.dx;
    const ty = target.y + yOffset - 20 + tOff.dy; 
    
    // Smooth bezier curve connecting nodes
    return `M ${sx} ${sy} C ${sx} ${(sy + ty) / 2}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`;
  };

  const getNodeColor = (status: string) => {
    if (status === "running") return "#3b82f6";
    if (status === "completed") return "#10b981";
    return "#64748b";
  };

  useEffect(() => {
    if (!initialized && canvasRef.current && canvasW > 0) {
      const containerW = canvasRef.current.clientWidth;
      const containerH = canvasRef.current.clientHeight;
      // Start slightly scaled out if it's very wide
      const initialZoom = canvasW > containerW ? Math.max(containerW / canvasW, 0.4) : 1;
      
      setZoom(initialZoom);
      setPan({
        x: (containerW - canvasW) / 2,
        y: (containerH - canvasH) / 2
      });
      setInitialized(true);
    }
  }, [canvasW, canvasH, initialized]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-card bg-[#09090b] border border-line">
      
      {/* Zoom Controls */}
      <div className="absolute right-6 bottom-6 flex flex-col bg-[#1a1a1a] rounded-lg border border-white/10 overflow-hidden shadow-lg z-50 w-10">
        <button onClick={() => setZoom(z => Math.min(z * 1.2, 3))} className="p-2 hover:bg-white/10 text-white border-b border-white/10 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
        </button>
        <button onClick={() => setZoom(z => Math.max(z / 1.2, 0.3))} className="p-2 hover:bg-white/10 text-white border-b border-white/10 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" x2="19" y1="12" y2="12"/></svg>
        </button>
        <button onClick={() => { 
          if (canvasRef.current) {
            const containerW = canvasRef.current.clientWidth;
            const containerH = canvasRef.current.clientHeight;
            const initialZoom = canvasW > containerW ? Math.max(containerW / canvasW, 0.4) : 1;
            setZoom(initialZoom);
            setPan({ 
              x: (containerW - canvasW) / 2, 
              y: (containerH - canvasH) / 2 
            });
          }
        }} className="p-2 hover:bg-white/10 text-white flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>
        </button>
      </div>

      <div
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className={`w-full h-full select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          backgroundPosition: `${pan.x}px ${pan.y}px`
        }}
      >
        <div 
          className="relative origin-center transition-transform duration-75"
          style={{ 
            width: canvasW, 
            height: canvasH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* Connectors */}
          <svg width={canvasW} height={canvasH} className="pointer-events-none absolute inset-0">
            {links.map((link, i) => (
              <path
                key={i}
                d={bezier(link.source, link.target)}
                fill="none"
                stroke="rgba(255,255,255,0.15)"
                strokeWidth="1.5"
              />
            ))}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const off = nodeOffsets[node.data.id] || { dx: 0, dy: 0 };
            const cx = node.x + xOffset + off.dx;
            const cy = node.y + yOffset + off.dy;
            const hue = getNodeColor(node.data.status);
            
            return (
              <div
                key={node.data.id}
                onPointerDown={(e) => onNodePointerDown(node.data.id, e)}
                onPointerMove={(e) => onNodePointerMove(node.data.id, e)}
                onPointerUp={(e) => onNodePointerUp(node.data.id, e)}
                className="agent-node absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center cursor-grab active:cursor-grabbing"
                style={{ left: cx, top: cy, width: 220, zIndex: nodeDrag.current?.id === node.data.id ? 10 : 1 }}
              >
                <div className="w-full rounded-md bg-black shadow-card border border-white/10 flex items-center px-3 py-2.5 gap-2 hover:border-white/30 transition-colors pointer-events-none">
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: hue }} />
                  <div className="text-[11px] font-bold text-white truncate min-w-0">{node.data.name}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
