import React, { useMemo } from "react";
import { LayoutDashboard, AlertTriangle, ShieldCheck, Clock, Activity, Target, BarChart2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import type { RunsPayload, RunListEntry } from "@/data/serverSource";
import { SEVERITY_COLORS } from "@/types/issues";

interface AnalyticsDashboardProps {
  runs: RunsPayload | null;
  onNewScan: () => void;
  onViewRun: (runName: string) => void;
}

export default function AnalyticsDashboard({ runs, onNewScan, onViewRun }: AnalyticsDashboardProps) {
  const { totalRuns, totalCritical, totalHigh, totalMed, totalLow, avgTime } = useMemo(() => {
    if (!runs || !runs.runs) {
      return { totalRuns: 0, totalCritical: 0, totalHigh: 0, totalMed: 0, totalLow: 0, avgTime: "0s" };
    }
    const finishedRuns = runs.runs.filter((r) => r.finished);
    let crit = 0,
      hi = 0,
      med = 0,
      low = 0,
      totalTimeMs = 0;

    for (const r of runs.runs) {
      crit += r.severity_counts.critical;
      hi += r.severity_counts.high;
      med += r.severity_counts.medium;
      low += r.severity_counts.low;

      if (r.finished && r.start_time && r.end_time) {
        const start = typeof r.start_time === "number" ? r.start_time * 1000 : new Date(r.start_time).getTime();
        const end = typeof r.end_time === "number" ? r.end_time * 1000 : new Date(r.end_time).getTime();
        totalTimeMs += end - start;
      }
    }

    let avgStr = "0s";
    if (finishedRuns.length > 0) {
      const avgMs = totalTimeMs / finishedRuns.length;
      if (avgMs < 60000) avgStr = `${Math.round(avgMs / 1000)}s`;
      else avgStr = `${Math.round(avgMs / 60000)}m`;
    }

    return {
      totalRuns: runs.runs.length,
      totalCritical: crit,
      totalHigh: hi,
      totalMed: med,
      totalLow: low,
      avgTime: avgStr,
    };
  }, [runs]);

  const totalVuls = totalCritical + totalHigh + totalMed + totalLow;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-[#888]" aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        </div>
        <button
          onClick={onNewScan}
          className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          New Scan
        </button>
      </div>

      {/* High-level metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-card-in">
        <MetricCard title="Total Scans" value={totalRuns.toString()} icon={<Activity className="w-5 h-5 text-blue-400" />} />
        <MetricCard
          title="Critical Issues"
          value={totalCritical.toString()}
          icon={<AlertTriangle className="w-5 h-5" style={{ color: SEVERITY_COLORS.critical }} />}
        />
        <MetricCard
          title="High Issues"
          value={totalHigh.toString()}
          icon={<AlertTriangle className="w-5 h-5" style={{ color: SEVERITY_COLORS.high }} />}
        />
        <MetricCard title="Avg Scan Time" value={avgTime} icon={<Clock className="w-5 h-5 text-[#888]" />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-card-in" style={{ animationDelay: "50ms" }}>
        {/* Severity Distribution Chart */}
        <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#888]" />
            <h2 className="text-sm font-semibold text-white">Vulnerability Breakdown</h2>
          </div>
          {totalVuls === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-[#555]">No vulnerabilities found yet.</div>
          ) : (
            <div className="h-48 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Critical", value: totalCritical, color: SEVERITY_COLORS.critical },
                      { name: "High", value: totalHigh, color: SEVERITY_COLORS.high },
                      { name: "Medium", value: totalMed, color: SEVERITY_COLORS.medium },
                      { name: "Low", value: totalLow, color: SEVERITY_COLORS.low },
                    ].filter((d) => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {
                      [
                        { name: "Critical", value: totalCritical, color: SEVERITY_COLORS.critical },
                        { name: "High", value: totalHigh, color: SEVERITY_COLORS.high },
                        { name: "Medium", value: totalMed, color: SEVERITY_COLORS.medium },
                        { name: "Low", value: totalLow, color: SEVERITY_COLORS.low },
                      ]
                        .filter((d) => d.value > 0)
                        .map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))
                    }
                  </Pie>
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: "#111", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                    itemStyle={{ color: "#fff" }}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: "12px", color: "#888" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Recent Scans */}
        <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-[#888]" />
            <h2 className="text-sm font-semibold text-white">Recent Scans</h2>
          </div>
          {!runs?.runs?.length ? (
            <div className="h-40 flex items-center justify-center text-sm text-[#555]">No recent scans available.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {runs.runs.slice(0, 5).map((r) => (
                <button
                  key={r.name}
                  onClick={() => onViewRun(r.name)}
                  className="flex items-center justify-between rounded-lg border border-[#333] bg-transparent p-3 text-left transition-colors hover:border-[#555] hover:bg-white/5"
                >
                  <div className="flex flex-col truncate pr-4">
                    <span className="truncate text-sm font-medium text-white">{r.target || r.name}</span>
                    <span className="text-xs text-[#888]">
                      {r.finished ? "Completed" : "Running"} • {r.scan_mode}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 gap-1 text-xs font-medium">
                    {r.severity_counts.critical > 0 && <span style={{ color: SEVERITY_COLORS.critical }}>{r.severity_counts.critical} C</span>}
                    {r.severity_counts.high > 0 && <span style={{ color: SEVERITY_COLORS.high }}>{r.severity_counts.high} H</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 animate-card-in" style={{ animationDelay: "100ms" }}>
        {/* Issues by Scan BarChart */}
        <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[#888]" />
            <h2 className="text-sm font-semibold text-white">Issues by Scan</h2>
          </div>
          {!runs?.runs?.length ? (
            <div className="h-64 flex items-center justify-center text-sm text-[#555]">No scans available.</div>
          ) : (
            <div className="h-64 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={runs.runs.slice(0, 10).reverse().map(r => ({
                  name: r.target || r.name.substring(0, 10),
                  Critical: r.severity_counts.critical,
                  High: r.severity_counts.high,
                  Medium: r.severity_counts.medium,
                  Low: r.severity_counts.low
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="name" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "#111", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                    itemStyle={{ color: "#fff" }}
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: "12px", color: "#888" }} />
                  <Bar dataKey="Critical" stackId="a" fill={SEVERITY_COLORS.critical} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="High" stackId="a" fill={SEVERITY_COLORS.high} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Medium" stackId="a" fill={SEVERITY_COLORS.medium} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Low" stackId="a" fill={SEVERITY_COLORS.low} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[#888]">{title}</span>
        {icon}
      </div>
      <span className="text-2xl font-bold text-white">{value}</span>
    </div>
  );
}


