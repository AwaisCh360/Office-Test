import type { Vulnerability } from "@/types/issues";
import {
  parseRunJson,
  parseVulnerabilitiesJson,
  type ParsedRunSummary,
} from "@/lib/local-run-parser";

/**
 * Data seam for the local viewer: fetches against the local Python server's
 * JSON endpoints (same origin, relative URLs), producing the in-memory
 * `LoadedRun` shape the UI renders plus a `finished` flag driving live polling.
 *
 * The server serves a live in-progress run and a finished one identically; the
 * only signal is `run.finished`.
 */

/** A transcript agent as emitted by GET /api/transcript (already parsed). */
export interface TranscriptAgent {
  id: string;
  name: string;
  parent_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Chat/tool event data as emitted by GET /api/transcript. */
export interface TranscriptEvent {
  id: string;
  type: "chat" | "tool";
  agent_id: string;
  timestamp: string;
  version: number;
  data: Record<string, unknown>;
}

export interface Transcript {
  agents: TranscriptAgent[];
  events: TranscriptEvent[];
}

export interface LoadedRun {
  summary: ParsedRunSummary;
  /** Whole raw run record (for llm_usage, targets_info details, etc.). */
  raw: Record<string, unknown>;
  finished: boolean;
  vulnerabilities: Vulnerability[];
  reportMarkdown: string | null;
  transcript: Transcript;
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("strix_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path, { cache: "no-store", headers: getAuthHeader() });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

/** Build a ``?run=<name>`` suffix for run-scoped data endpoints. */
function runQuery(runName?: string | null): string {
  return runName ? `?run=${encodeURIComponent(runName)}` : "";
}

export async function fetchRunSummary(runName?: string | null): Promise<{
  summary: ParsedRunSummary;
  raw: Record<string, unknown>;
  finished: boolean;
}> {
  const raw = (await getJson("/api/run" + runQuery(runName))) as Record<string, unknown>;
  // parseRunJson tolerates extra keys and takes raw TEXT.
  const summary = parseRunJson(JSON.stringify(raw));
  const finished = raw.finished === true;
  return { summary, raw, finished };
}

export async function fetchVulnerabilities(
  runId: string | null,
  runName?: string | null
): Promise<Vulnerability[]> {
  const arr = await getJson("/api/vulnerabilities" + runQuery(runName));
  return parseVulnerabilitiesJson(JSON.stringify(arr), runId);
}

export async function fetchReportMarkdown(runName?: string | null): Promise<string | null> {
  const obj = (await getJson("/api/report" + runQuery(runName))) as { markdown?: string };
  return obj?.markdown ?? null;
}

export async function fetchTranscript(runName?: string | null): Promise<Transcript> {
  const obj = (await getJson("/api/transcript" + runQuery(runName))) as Partial<Transcript>;
  return {
    agents: Array.isArray(obj?.agents) ? obj.agents : [],
    events: Array.isArray(obj?.events) ? obj.events : [],
  };
}

export async function deleteRun(runName: string): Promise<void> {
  const res = await fetch("/api/run/delete", {
    method: "POST",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ run: runName }),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || `Failed to delete run: ${res.status}`);
  }
}

/** One-shot fetch of every endpoint (used on mount and on final settle). */
export async function fetchAll(runName?: string | null): Promise<LoadedRun> {
  const { summary, raw, finished } = await fetchRunSummary(runName);
  const [vulnerabilities, reportMarkdown, transcript] = await Promise.all([
    fetchVulnerabilities(summary.runId, runName).catch(() => [] as Vulnerability[]),
    fetchReportMarkdown(runName).catch(() => null),
    fetchTranscript(runName).catch(() => ({ agents: [], events: [] }) as Transcript),
  ]);
  return { summary, raw, finished, vulnerabilities, reportMarkdown, transcript };
}

// ---------------------------------------------------------------------------
// Run history + email auth + report send
//
// These endpoints back the "Your runs" sidebar section. Auth and report-send
// responses carry a meaningful JSON body on non-2xx statuses (an ``error``
// code), so they read the body regardless of status rather than throwing.
// ---------------------------------------------------------------------------

export interface RunSeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface RunListEntry {
  name: string;
  target: string | null;
  scan_mode: string | null;
  status: string | null;
  start_time: string | null;
  end_time: string | null;
  finished: boolean;
  severity_counts: RunSeverityCounts;
}

export interface RunsPayload {
  locked: boolean;
  count: number;
  runs: RunListEntry[];
}

export interface AuthStatus {
  verified: boolean;
  email: string | null;
  is_admin?: boolean;
}

export type OtpStartResult = { ok: true } | { ok: false; error: string };
export type OtpVerifyResult =
  | { verified: true; email: string }
  | { verified: false; error: string };
export type ReportSendResult =
  | { ok: true; password: string; filename: string; pdf_b64?: string }
  | { ok: false; error: string };

async function postJson(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: Record<string, unknown> = {};
  try {
    const parsed = await res.json();
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    /* empty or non-JSON body */
  }
  return { ok: res.ok, status: res.status, data };
}

export async function fetchRuns(): Promise<RunsPayload> {
  const obj = (await getJson("/api/runs")) as Partial<RunsPayload>;
  return {
    locked: obj?.locked ?? true,
    count: typeof obj?.count === "number" ? obj.count : 0,
    runs: Array.isArray(obj?.runs) ? (obj.runs as RunListEntry[]) : [],
  };
}

export interface Capabilities {
  can_steer: boolean;
}

export type SteerResult = { ok: true } | { ok: false; error: string };

/** GET /api/capabilities. can_steer is true only inside a live in-TUI scan. */
export async function fetchCapabilities(): Promise<Capabilities> {
  const obj = (await getJson("/api/capabilities")) as Partial<Capabilities>;
  return { can_steer: obj?.can_steer === true };
}

/** POST /api/agents/steer. Sends a steering instruction to a running agent. */
export async function steerAgent(runName: string, agentId: string, message: string): Promise<SteerResult> {
  const { ok, data } = await postJson("/api/agents/steer", {
    run_name: runName,
    agent_id: agentId,
    message,
  });
  if (ok && data.ok === true) return { ok: true };
  return { ok: false, error: String(data.error ?? "unavailable") };
}

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

/**
 * POST /api/feedback. Sends a feedback message plus a work email (no
 * verification) to the local server, which relays it to Strix.
 */
export async function submitFeedback(
  message: string,
  email: string
): Promise<SubmitFeedbackResult> {
  const { ok, data } = await postJson("/api/feedback", { message, email });
  if (ok && data.ok === true) return { ok: true };
  return { ok: false, error: String(data.error ?? "unavailable") };
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const obj = (await getJson("/api/auth/status")) as Partial<AuthStatus>;
  return { verified: obj?.verified === true, email: obj?.email ?? null, is_admin: obj?.is_admin };
}

export async function otpStart(email: string): Promise<OtpStartResult> {
  const { ok, data } = await postJson("/api/auth/otp/start", { email });
  if (ok && data.ok === true) return { ok: true };
  return { ok: false, error: String(data.error ?? "unavailable") };
}

export async function otpVerify(email: string, code: string): Promise<OtpVerifyResult> {
  const { ok, data } = await postJson("/api/auth/otp/verify", { email, code });
  if (ok && data.verified === true) {
    return { verified: true, email: String(data.email ?? email) };
  }
  return { verified: false, error: String(data.error ?? "invalid_code") };
}

export async function forgetAuth(): Promise<void> {
  await postJson("/api/auth/forget", {});
}

export async function sendReport(runName?: string | null): Promise<ReportSendResult> {
  const { ok, data } = await postJson("/api/report/send", runName ? { run: runName } : {});
  if (ok && data.ok === true) {
    return {
      ok: true,
      password: String(data.password ?? ""),
      filename: String(data.filename ?? "report.pdf"),
      pdf_b64: typeof data.pdf_b64 === "string" ? data.pdf_b64 : undefined,
    };
  }
  return { ok: false, error: String(data.error ?? "unavailable") };
}

export interface FilePayload {
  name: string;
  content_b64: string;
}

export interface StartRunConfig {
  targets: string[];
  instruction?: string;
  scan_mode?: string;
  scope_mode?: string;
  diff_base?: string;
  target_list_file?: FilePayload;
  instruction_file?: FilePayload;
  workspace_files?: FilePayload[];
  max_budget?: number;
  max_turns?: number;
  config_file?: FilePayload;
}

export type StartRunResult =
  | { ok: true; run_name: string }
  | { ok: false; error: string };

export async function startScan(config: StartRunConfig): Promise<StartRunResult> {
  const { ok, data } = await postJson("/api/run/start", config as Record<string, unknown>);
  if (ok && data.ok === true) {
    return { ok: true, run_name: String(data.run_name ?? "") };
  }
  return { ok: false, error: String(data.error ?? "unavailable") };
}
export async function checkSession(): Promise<boolean> {
  try {
    console.log("checkSession: fetching /api/session");
    const res = await fetch("/api/session", { cache: "no-store", headers: getAuthHeader() });
    console.log("checkSession: response ok?", res.ok);
    return res.ok;
  } catch (e) {
    console.error("checkSession: error", e);
    return false;
  }
}

export async function login(email: string, password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("strix_token", data.token);
        return true;
      }
    }
  } catch {
    // fallthrough
  }
  return false;
}

export async function signup(
  email: string,
  password: string,
  first_name: string,
  last_name: string,
  company: string
): Promise<{ok: boolean, error?: string}> {
  try {
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, first_name, last_name, company }),
    });
    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem("strix_token", data.token);
      return { ok: true };
    }
    return { ok: false, error: data.error || "Signup failed" };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/logout", {
      method: "POST",
      headers: getAuthHeader(),
    });
  } catch {
    // ignore
  } finally {
    localStorage.removeItem("strix_token");
    window.location.reload();
  }
}

export interface AdminUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  phone: string;
  timezone: string;
  is_admin: boolean;
  is_suspended: boolean;
  admin_notes: string;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const obj = (await getJson("/api/admin/users")) as { users: AdminUser[] };
  return obj.users || [];
}

export async function deleteAdminUser(email: string): Promise<void> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete user: ${res.status}`);
  }
}

export async function addAdminUser(data: Partial<AdminUser> & { password?: string }): Promise<void> {
  const res = await fetch("/api/admin/users/add", {
    method: "POST",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to add user: ${res.status}`);
  }
}

export async function editAdminUser(email: string, isAdmin: boolean): Promise<void> {
  const res = await fetch("/api/admin/users/edit", {
    method: "POST",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ email, is_admin: isAdmin }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to edit user: ${res.status}`);
  }
}

export async function getProfile(): Promise<AdminUser> {
  const obj = (await getJson("/api/profile")) as { profile: AdminUser };
  return obj.profile;
}

export async function updateProfile(data: Partial<AdminUser> & { password?: string; old_password?: string }): Promise<void> {
  const { ok, data: resData } = await postJson("/api/profile", { profile: data });
  if (!ok) {
    throw new Error(String(resData.error || "Failed to update profile"));
  }
}

// --- Super Admin Extensions ---

export async function suspendUser(userId: number, suspend: boolean): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}/suspend`, {
    method: "POST",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ suspend })
  });
  if (!res.ok) throw new Error("Failed to suspend user");
}



export async function updateUserNotes(userId: number, notes: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}/notes`, {
    method: "PUT",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ notes })
  });
  if (!res.ok) throw new Error("Failed to update notes");
}

export async function fetchGlobalRuns(): Promise<any[]> {
  const res = await fetch("/api/admin/global-runs", { headers: getAuthHeader() });
  if (!res.ok) throw new Error("Failed to fetch global runs");
  const data = await res.json();
  return data.runs;
}

export async function killGlobalRun(runName: string): Promise<void> {
  const res = await fetch(`/api/admin/global-runs/${runName}/kill`, {
    method: "POST",
    headers: getAuthHeader()
  });
  if (!res.ok) throw new Error("Failed to kill run");
}

export async function fetchAdminSettings(): Promise<{ maintenance_mode: boolean }> {
  const res = await fetch("/api/admin/settings", { headers: getAuthHeader() });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function toggleMaintenanceMode(enable: boolean): Promise<void> {
  const res = await fetch("/api/admin/maintenance", {
    method: "POST",
    headers: { ...getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ enable })
  });
  if (!res.ok) throw new Error("Failed to toggle maintenance mode");
}

export async function updateNucleiTemplates(): Promise<void> {
  const res = await fetch("/api/admin/nuclei/update", {
    method: "POST",
    headers: getAuthHeader()
  });
  if (!res.ok) throw new Error("Failed to trigger update");
}

export async function fetchAuditLogs(): Promise<any[]> {
  const res = await fetch("/api/admin/audit-logs", { headers: getAuthHeader() });
  if (!res.ok) throw new Error("Failed to fetch audit logs");
  const data = await res.json();
  return data.logs;
}
