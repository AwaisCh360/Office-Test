import { useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const ITEMS = [
  { key: "dashboard", label: "Dashboard", section: "Workspace", path: "/dashboard" },
  { key: "history", label: "Scan History", section: "Workspace", path: "/history" },
  { key: "settings", label: "Settings", section: "Workspace", path: "/settings" },
];

function Icon({ kind }: { kind: string }) {
  const p: Record<string, React.ReactNode> = {
    dashboard: <g><path d="M20 5H4a1.5 1.5 0 0 0-1.5 1.5V9h19V6.5A1.5 1.5 0 0 0 20 5Z" /><path d="M21.5 9v8.5A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5V9M8.5 12.5h7" /></g>,
    history: <g><path d="M4 11.4 12 5l8 6.4" /><path d="M6 10v8.2c0 .72.58 1.3 1.3 1.3h9.4c.72 0 1.3-.58 1.3-1.3V10" /></g>,
    settings: <g><path d="M12 3.2 4 7v10l8 3.8 8-3.8V7l-8-3.8Z" /><path d="M4 7l8 3.8L20 7M12 20.6V10.8" /></g>,
  };
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {p[kind]}
    </svg>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const currentKey = ITEMS.find(item => location.pathname.startsWith(item.path))?.key || "dashboard";
  
  const [active, setActive] = useState(currentKey);
  const [hovered, setHovered] = useState<string | null>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useLayoutEffect(() => {
    setActive(currentKey);
  }, [currentKey]);

  useLayoutEffect(() => {
    const container = navRef.current;
    const target = itemRefs.current[hovered ?? active];
    if (!container || !target) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setBox({
      top: targetRect.top - containerRect.top,
      height: targetRect.height,
    });
  }, [hovered, active]);

  return (
    <div className="w-64 h-screen border-r border-line bg-surface p-4 shadow-raised flex flex-col">
      {/* workspace row */}
      <button
        type="button"
        className="mb-6 flex w-full items-center gap-2.5 rounded-control p-1.5 text-left
          transition-[background-color,transform] duration-100 hover:bg-hover active:scale-[0.96]"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]" style={{ background: "linear-gradient(155deg,#5aa2ff,#1f3fb0)" }}>
          S
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-tight text-ink">Strix UI</span>
          <span className="block truncate text-[11px] leading-tight text-ink-3">AI Penetration Testing</span>
        </span>
      </button>

      {/* accent action */}
      <Link
        to="/dashboard"
        className="mb-4 flex w-full items-center gap-2 rounded-control px-2 py-2 text-[13px]
          font-medium text-accent transition-[background-color,transform] duration-100 hover:bg-accent-tint active:scale-[0.96]"
      >
        <span className="min-w-0 flex-1 truncate text-left">New Scan</span>
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </Link>

      {/* items */}
      <div
        ref={navRef}
        onMouseLeave={() => setHovered(null)}
        className="relative flex flex-col gap-2 flex-1"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 rounded-[7px] bg-hover"
          style={{
            top: box?.top ?? 0,
            height: box?.height ?? 0,
            opacity: box ? 1 : 0,
            transition:
              "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
          }}
        />
        {["Workspace"].map((section) => (
          <div key={section}>
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
              {section}
            </div>
            <div className="flex flex-col gap-px mt-1">
              {ITEMS.filter((item) => item.section === section).map((item) => {
                const isActive = item.key === active;
                return (
                  <Link
                    to={item.path}
                    key={item.key}
                    ref={(el) => {
                      itemRefs.current[item.key] = el;
                    }}
                    onMouseEnter={() => setHovered(item.key)}
                    onFocus={() => setHovered(item.key)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setActive(item.key)}
                    aria-current={isActive ? "page" : undefined}
                    className="group relative z-10 flex w-full items-center gap-2.5 rounded-[7px] px-2 py-2 text-left
                      transition-[color,transform] duration-150 active:scale-[0.96]"
                  >
                    <span className={isActive ? "text-accent" : "text-ink-3 group-hover:text-ink-2"}>
                      <Icon kind={item.key} />
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-[14px] transition-colors duration-150
                        ${isActive ? "font-semibold text-ink" : "font-medium text-ink-2 group-hover:text-ink"}`}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      
      {/* Footer link / logout area can go here */}
      <div className="mt-auto pt-4 border-t border-line px-2 pb-2">
         <button onClick={() => {
            localStorage.removeItem("token");
            window.location.href = "/login";
         }} className="flex items-center gap-2 text-sm font-medium text-ink-3 hover:text-ink transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Sign out
         </button>
      </div>
    </div>
  );
}
