import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";

export default function Dashboard() {
  const [targets, setTargets] = useState("");
  const [instruction, setInstruction] = useState("");
  const [scanMode, setScanMode] = useState("quick");
  const [scopeMode, setScopeMode] = useState("auto");
  const [diffBase, setDiffBase] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleStartScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetList = targets.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
    if (targetList.length === 0) return;

    setLoading(true);
    setError("");

    try {
      const payload: any = {
        targets: targetList,
        instruction: instruction || null,
        scan_mode: scanMode,
      };
      if (scopeMode !== "auto") payload.scope_mode = scopeMode;
      if (scopeMode === "diff" && diffBase) payload.diff_base = diffBase;
      if (maxBudget) payload.max_budget_usd = parseFloat(maxBudget);
      if (maxTurns) payload.max_turns = parseInt(maxTurns, 10);

      const res = await api.post("/strix/scan", payload);
      
      // Redirect to the new native Live Scan dashboard
      navigate(`/scan/${res.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to start scan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-ink mb-2">New Security Scan</h1>
        <p className="text-ink-3">Launch autonomous AI agents to discover vulnerabilities in your application.</p>
      </div>

      {error && (
        <div className="mb-6 rounded-control bg-red-500/10 p-4 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}

      <div className="bg-[#09090b] rounded-xl p-8 shadow-2xl border border-white/10">
        <form onSubmit={handleStartScan} className="space-y-8">
          
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-ink-3">Targets</label>
            <textarea
              required
              placeholder="https://example.com&#10;https://github.com/user/repo&#10;192.168.1.42"
              rows={4}
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent focus:bg-white/10 resize-none font-mono leading-relaxed"
            />
            <div className="text-[11.5px] text-ink-3/90 bg-white/5 p-3.5 rounded border border-white/10 leading-relaxed">
              <span className="font-semibold text-ink-2 mb-1 block">Supported Target Types:</span>
              <ul className="space-y-1 mt-2">
                <li>• <span className="text-white">Web App:</span> <code className="text-accent bg-accent/10 px-1 py-0.5 rounded">https://example.com</code></li>
                <li>• <span className="text-white">GitHub Repo:</span> <code className="text-accent bg-accent/10 px-1 py-0.5 rounded">https://github.com/user/repo</code></li>
                <li>• <span className="text-white">Local Source:</span> <code className="text-accent bg-accent/10 px-1 py-0.5 rounded">./my-project</code></li>
                <li>• <span className="text-white">API Specs:</span> <code className="text-accent bg-accent/10 px-1 py-0.5 rounded">./openapi.yaml</code> or <code className="text-accent bg-accent/10 px-1 py-0.5 rounded">postman://&lt;id&gt;</code></li>
                <li>• <span className="text-white">Network/IP:</span> <code className="text-accent bg-accent/10 px-1 py-0.5 rounded">192.168.1.42</code> or <code className="text-accent bg-accent/10 px-1 py-0.5 rounded">example.com</code></li>
              </ul>
              <p className="mt-3 text-ink-3/70 italic">Enter multiple targets separated by commas or newlines for multi-target scans (e.g. white-box testing with source and deployed app).</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-ink-3">Scan Mode</label>
              <select
                value={scanMode}
                onChange={(e) => setScanMode(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent focus:bg-white/10 appearance-none"
              >
                <option value="quick">Quick (Default)</option>
                <option value="standard">Standard</option>
                <option value="deep">Deep</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-ink-3">Scope Mode</label>
              <select
                value={scopeMode}
                onChange={(e) => setScopeMode(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent focus:bg-white/10 appearance-none"
              >
                <option value="auto">Auto (Default)</option>
                <option value="diff">Diff</option>
                <option value="full">Full</option>
              </select>
            </div>
          </div>

          {scopeMode === "diff" && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
              <label className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center justify-between">
                <span>Diff Base</span>
                <span className="text-ink-3/50 normal-case font-normal">Required for Diff mode</span>
              </label>
              <input
                type="text"
                required
                placeholder="Commit hash, branch name, or folder path"
                value={diffBase}
                onChange={(e) => setDiffBase(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent focus:bg-white/10 font-mono"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center justify-between">
                <span>Max Budget (USD)</span>
                <span className="text-ink-3/50 normal-case font-normal">Optional</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                placeholder="e.g. 5.00"
                value={maxBudget}
                onChange={(e) => setMaxBudget(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent focus:bg-white/10"
              />
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center justify-between">
                <span>Max Agent Turns</span>
                <span className="text-ink-3/50 normal-case font-normal">Optional</span>
              </label>
              <input
                type="number"
                min="1"
                placeholder="e.g. 100"
                value={maxTurns}
                onChange={(e) => setMaxTurns(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent focus:bg-white/10"
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center justify-between">
              <span>Custom Instructions</span>
              <span className="text-ink-3/50 normal-case font-normal">Optional</span>
            </label>
            <textarea
              placeholder="E.g., Focus specifically on authentication bypass or SQL injection vulnerabilities..."
              rows={4}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent focus:bg-white/10 resize-none"
            />
          </div>

          <div className="pt-4 flex items-center gap-4 border-t border-white/10 mt-8">
            <button
              type="submit"
              disabled={loading || !targets}
              className="flex-1 rounded-md bg-accent py-3.5 text-sm font-bold text-white transition-colors hover:bg-accent-ink shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Initializing Agents..." : "Launch Penetration Test"}
            </button>
            <Link 
              to="/settings"
              className="px-8 py-3.5 text-sm font-bold text-ink-3 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 hover:text-white transition-colors shadow-sm"
            >
              Configure API Keys
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
