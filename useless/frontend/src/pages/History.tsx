import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";

interface Scan {
  id: number;
  targets: string;
  instruction: string | null;
  scan_mode: string;
  status: string;
  created_at: string;
}

export default function History() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await api.get("/strix/history");
        setScans(res.data);
      } catch (err) {
        console.error("Failed to load history", err);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, []);

  if (loading) {
    return <div className="text-ink-2">Loading scan history...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto pt-8">
      <div className="mb-8">
        <h1 className="text-[28px] font-bold text-ink mb-1">Scan History</h1>
        <p className="text-ink-3">A complete log of all penetration tests run from this workspace.</p>
      </div>

      <div className="bg-[#09090b] rounded-xl border border-white/10 overflow-hidden shadow-2xl">
        {scans.length === 0 ? (
          <div className="p-8 text-center text-ink-3 font-sans">
            No scans have been run yet. Head over to the Dashboard to launch your first test!
          </div>
        ) : (
          <table className="w-full text-left text-[13px] font-sans">
            <thead className="text-ink-3 uppercase tracking-wider text-[11px] font-bold border-b border-white/10">
              <tr>
                <th className="px-6 py-5">ID</th>
                <th className="px-6 py-5">Targets</th>
                <th className="px-6 py-5">Mode</th>
                <th className="px-6 py-5">Status</th>
                <th className="px-6 py-5 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-ink-2 font-medium">
              {scans.map((scan) => {
                let statusBg = "bg-white/10";
                let statusText = "text-white";
                
                if (scan.status === "completed") {
                  statusBg = "bg-[#1a3b2b]";
                  statusText = "text-[#4ade80]";
                } else if (scan.status === "running") {
                  statusBg = "bg-[#173554]";
                  statusText = "text-[#60a5fa]";
                } else if (scan.status === "failed" || scan.status === "error") {
                  statusBg = "bg-[#451a1e]";
                  statusText = "text-[#f87171]";
                }

                return (
                  <tr 
                    key={scan.id} 
                    className="hover:bg-white/[0.02] transition-colors cursor-pointer group"
                    onClick={() => window.location.href = `/scan/${scan.id}`}
                  >
                    <td className="px-6 py-4">
                      <span className="text-accent group-hover:underline font-bold">
                        #{scan.id}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white truncate max-w-xs" title={scan.targets}>
                      {JSON.parse(scan.targets).join(", ")}
                    </td>
                    <td className="px-6 py-4 capitalize">{scan.scan_mode || "Quick"}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.1em] ${statusBg} ${statusText}`}>
                        {scan.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-ink-3 whitespace-nowrap">
                      {new Date(scan.created_at).toLocaleString('en-GB')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
