import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../lib/api";

import AgentGraph from "../components/AgentGraph";
import AgentTerminal from "../components/AgentTerminal";

type Tab = "overview" | "issues" | "graph" | "terminal";

interface StatusData {
  run_name: string | null;
  status: string;
  targets_info?: any[];
  scan_mode?: string;
  scope_mode?: string;
  instruction?: string;
  non_interactive?: boolean;
  cost?: number;
  llm_usage?: {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_input_tokens?: number;
    reasoning_tokens?: number;
    cost?: number;
    agents?: any[];
  };
  start_time?: string;
  end_time?: string;
  agents?: any[];
}

interface Issue {
  title: string;
  severity: string;
  description?: string;
}

export default function LiveScan() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [transcript, setTranscript] = useState<any>(null);
  
  const [steerMessage, setSteerMessage] = useState("");
  const [sendingSteer, setSendingSteer] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  
  // Auto-scroll logic
  const terminalRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    // Disable auto-scroll if user scrolled up more than 50px from bottom
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript]);

  // Poll data
  useEffect(() => {
    async function fetchData() {
      try {
        const [statusRes, vulnRes, transRes] = await Promise.all([
          api.get(`/strix/scan/${id}/status`),
          api.get(`/strix/scan/${id}/vulnerabilities`),
          api.get(`/strix/scan/${id}/transcript`)
        ]);
        
        setStatusData(statusRes.data);
        if (vulnRes.data.vulnerabilities) {
          setIssues(vulnRes.data.vulnerabilities);
        }
        if (transRes.data.events || transRes.data.agents) {
          setTranscript(transRes.data);
        }
      } catch (err) {
        console.error("Failed to poll scan data", err);
      }
    }

    fetchData(); // initial fetch
    const interval = setInterval(() => {
      if (statusData?.status !== "completed" && statusData?.status !== "failed") {
        fetchData();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [id, statusData?.status]);

  // Scroll to bottom of chat when new messages arrive
  useEffect(() => {
    if (activeTab === "agents") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, activeTab]);

  const handleSteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerMessage.trim() || !transcript?.agents?.length) return;

    setSendingSteer(true);
    try {
      // Send to the first agent for now
      const agentId = transcript.agents[0].id;
      await api.post(`/strix/scan/${id}/steer`, {
        agent_id: agentId,
        message: steerMessage
      });
      setSteerMessage("");
    } catch (err) {
      console.error("Failed to steer agent", err);
    } finally {
      setSendingSteer(false);
    }
  };

  const getSeverityColor = (sev: string) => {
    switch (sev.toLowerCase()) {
      case 'high':
      case 'critical': return 'bg-red-50 text-red-700 border-red-200';
      case 'medium': return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'low': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      default: return 'bg-blue-50 text-blue-700 border-blue-200';
    }
  };

  const getRunTime = () => {
    if (!statusData?.start_time) return "0s";
    const startTime = new Date(statusData.start_time).getTime();
    const endTime = statusData.end_time ? new Date(statusData.end_time).getTime() : Date.now();
    const diff = Math.max(0, endTime - startTime);
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="h-full flex flex-col bg-surface border border-line rounded-card shadow-raised overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-inset">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="p-1.5 hover:bg-hover rounded-md text-ink-3 hover:text-ink transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </Link>
          <h1 className="text-lg font-bold text-ink flex items-center gap-2">
            Scan #{id}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              statusData?.status === "running" ? "bg-accent-tint text-accent-ink" : 
              statusData?.status === "completed" ? "bg-green-50 text-green-700" : 
              "bg-ink-3 text-white"
            }`}>
              {statusData?.status || "Starting..."}
            </span>
          </h1>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Inner Sidebar */}
        <div className="w-56 border-r border-line bg-inset p-3 flex flex-col gap-1">
          <div className="px-2 pb-2 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
            Scan Details
          </div>
          <button 
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-2 px-3 py-2 rounded-control text-sm font-medium transition-colors ${
              activeTab === "overview" ? "bg-surface text-ink shadow-sm border border-line" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
            Pentest Overview
          </button>
          
          <button 
            onClick={() => setActiveTab("issues")}
            className={`flex items-center gap-2 px-3 py-2 rounded-control text-sm font-medium transition-colors justify-between ${
              activeTab === "issues" ? "bg-surface text-ink shadow-sm border border-line" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              Issues
            </div>
            {issues.length > 0 && (
              <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{issues.length}</span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab("graph")}
            className={`flex items-center gap-2 px-3 py-2 rounded-control text-sm font-medium transition-colors justify-between ${
              activeTab === "graph" ? "bg-surface text-ink shadow-sm border border-line" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
              Agent Graph
            </div>
            {transcript?.agents?.length > 0 && (
              <span className="bg-line text-ink-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{transcript.agents.length}</span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab("terminal")}
            className={`flex items-center gap-2 px-3 py-2 rounded-control text-sm font-medium transition-colors ${
              activeTab === "terminal" ? "bg-surface text-ink shadow-sm border border-line" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
            Agent Terminal
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-surface overflow-y-auto">
          
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="p-8 max-w-4xl mx-auto space-y-6">
              
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-ink mb-1">{statusData?.targets_info?.[0]?.details?.target_url || statusData?.run_name || "Waiting for initialization..."}</h2>
                <div className="flex items-center gap-2 text-sm text-ink-3">
                  <span className="capitalize">{statusData?.scan_mode || "Quick"}</span>
                  <span className="w-1 h-1 rounded-full bg-line" />
                  <span>{getRunTime()}</span>
                  <span className="w-1 h-1 rounded-full bg-line" />
                  <span className="capitalize">{statusData?.status || "Starting"}</span>
                </div>
              </div>

              <div className="border border-line rounded-card overflow-hidden bg-surface">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2 font-semibold text-ink">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  Run details
                </div>
                
                <div className="grid grid-cols-2 divide-x divide-line text-sm">
                  
                  {/* Configuration Column */}
                  <div className="p-5 space-y-4">
                    <div className="text-[11px] font-bold text-ink-3 tracking-wider mb-2">CONFIGURATION</div>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Targets</div>
                      <div className="col-span-2 text-ink font-mono">{statusData?.targets_info?.[0]?.details?.target_url || "n/a"}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Instruction</div>
                      <div className="col-span-2 text-ink">{statusData?.instruction || "None"}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Pentest Mode</div>
                      <div className="col-span-2 text-ink capitalize">{statusData?.scan_mode || "n/a"}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Scope</div>
                      <div className="col-span-2 text-ink capitalize">{statusData?.scope_mode || "n/a"}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Mode</div>
                      <div className="col-span-2 text-ink">{statusData?.non_interactive ? "Non-interactive" : "Interactive"}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Status</div>
                      <div className="col-span-2 text-ink capitalize">{statusData?.status || "n/a"}</div>
                    </div>
                  </div>

                  {/* Usage Column */}
                  <div className="p-5 space-y-4">
                    <div className="text-[11px] font-bold text-ink-3 tracking-wider mb-2">USAGE & COST</div>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Model</div>
                      <div className="col-span-2 text-ink">{statusData?.llm_usage?.agents?.[0]?.model || statusData?.agents?.[0]?.model || "n/a"}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Run Time</div>
                      <div className="col-span-2 text-ink">{getRunTime()}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Requests</div>
                      <div className="col-span-2 text-ink">{statusData?.llm_usage?.requests?.toLocaleString() || 0}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Input Tokens</div>
                      <div className="col-span-2 text-ink">
                        {statusData?.llm_usage?.input_tokens?.toLocaleString() || 0}
                        {!!statusData?.llm_usage?.cache_read_input_tokens && (
                          <span className="text-ink-3"> ({statusData.llm_usage.cache_read_input_tokens.toLocaleString()} cached)</span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Output Tokens</div>
                      <div className="col-span-2 text-ink">
                        {statusData?.llm_usage?.output_tokens?.toLocaleString() || 0}
                        {statusData?.llm_usage?.reasoning_tokens !== undefined && (
                          <span className="text-ink-3"> ({statusData.llm_usage.reasoning_tokens.toLocaleString()} reasoning)</span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Total Tokens</div>
                      <div className="col-span-2 text-ink">{statusData?.llm_usage?.total_tokens?.toLocaleString() || 0}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Cost</div>
                      <div className="col-span-2 text-ink">${(statusData?.llm_usage?.cost || statusData?.cost || 0).toFixed(4)}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-ink-3">Agents</div>
                      <div className="col-span-2 text-ink">{statusData?.llm_usage?.agents?.length || statusData?.agents?.length || transcript?.agents?.length || 0}</div>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          )}

          {/* Issues Tab */}
          {activeTab === "issues" && (
            <div className="p-8">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-ink mb-1">Discovered Issues</h2>
                <p className="text-ink-3">Vulnerabilities found by the AI agents.</p>
              </div>
              
              {issues.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-line rounded-card">
                  <div className="text-ink-3 mb-2">No issues found yet.</div>
                  <div className="text-sm text-ink-3/70">The agents are still analyzing the target.</div>
                </div>
              ) : (
                <div className="space-y-4">
                  {issues.map((issue, idx) => (
                    <div key={idx} className="border border-line rounded-card p-5 bg-surface shadow-sm">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-bold text-ink text-lg">{issue.title}</h3>
                        <span className={`px-2.5 py-1 rounded-control text-xs font-bold uppercase tracking-wider border ${getSeverityColor(issue.severity)}`}>
                          {issue.severity}
                        </span>
                      </div>
                      <p className="text-ink-2 text-sm whitespace-pre-wrap">{issue.description || "No detailed description provided."}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Graph Tab */}
          {activeTab === "graph" && (
            <div className="h-full flex flex-col p-8 relative">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-ink mb-1">Agent Graph</h2>
                <p className="text-ink-3">Visual map of spawned agents and their relationships.</p>
              </div>
              <div className="flex-1 bg-page rounded-card overflow-hidden">
                {transcript?.agents?.length > 0 ? (
                  <AgentGraph 
                    agents={transcript.agents} 
                    onNodeClick={(id) => setSelectedAgentId(id)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center border border-dashed border-line rounded-card text-ink-3">
                    Waiting for agents...
                  </div>
                )}
              </div>

              {/* Agent Detail Popup Modal */}
              {selectedAgentId && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-page/80 backdrop-blur-sm p-8 animate-in fade-in duration-200">
                  <div className="w-full max-w-4xl h-full max-h-[80vh] bg-surface border border-line rounded-card shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                    <div className="px-6 py-4 border-b border-line flex justify-between items-center bg-inset">
                      <div className="min-w-0">
                        <h3 className="font-bold text-ink text-lg truncate">
                          {transcript.agents?.find((a: any) => a.id === selectedAgentId)?.name || "Agent"} Details
                        </h3>
                        <div className="text-xs text-ink-3 font-mono mt-0.5">{selectedAgentId}</div>
                      </div>
                      <button 
                        onClick={() => setSelectedAgentId(null)}
                        className="p-2 hover:bg-hover rounded-md text-ink-3 hover:text-ink transition-colors"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 bg-page">
                      <AgentTerminal 
                        events={transcript?.events?.filter((e: any) => e.agent_id === selectedAgentId) || []} 
                        agents={transcript?.agents || []} 
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Terminal Tab */}
          {activeTab === "terminal" && (
            <div className="h-full flex flex-col">
              <div className="px-6 py-4 border-b border-line bg-surface flex items-center justify-between">
                <h2 className="font-bold text-ink">Agent Terminal & Steering</h2>
              </div>
              
              <div className="flex-1 overflow-hidden bg-inset flex flex-col">
                <div 
                  ref={terminalRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto p-6 font-sans bg-page"
                >
                  <AgentTerminal events={transcript?.events || []} agents={transcript?.agents || []} />
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-4 border-t border-line bg-surface shrink-0">
                  <form onSubmit={handleSteer} className="flex gap-2">
                    <input 
                      type="text" 
                      value={steerMessage}
                      onChange={(e) => setSteerMessage(e.target.value)}
                      placeholder="Steer the agent..."
                      className="flex-1 rounded-control border border-line bg-inset px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent"
                      disabled={statusData?.status !== "running" || transcript?.agents?.length === 0}
                    />
                    <button 
                      type="submit"
                      disabled={sendingSteer || !steerMessage.trim() || statusData?.status !== "running"}
                      className="px-5 rounded-control bg-accent text-sm font-semibold text-white transition-colors hover:bg-accent-ink disabled:opacity-70"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
