import React, { useState, useEffect } from "react";
import { User, Loader2, AlertCircle, Save, Lock, Building, CheckCircle2 } from "lucide-react";
import { getProfile, updateProfile } from "@/data/serverSource";

export function ProfileView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await getProfile();
      setEmail(p.email || "");
      setFirstName(p.first_name || "");
      setLastName(p.last_name || "");
      setCompany(p.company || "");
      setJobTitle(p.job_title || "");
      setPhone(p.phone || "");
      setTimezone(p.timezone || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const payload: any = {
        first_name: firstName,
        last_name: lastName,
        company: company,
        job_title: jobTitle,
        phone: phone,
        timezone: timezone,
      };
      if (password.trim()) {
        payload.password = password;
        payload.old_password = oldPassword;
      }
      await updateProfile(payload);
      setSuccess(true);
      setPassword(""); 
      setOldPassword(""); 
      
      // Auto-hide success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <User className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">Your Profile</h1>
            <p className="text-sm text-[#888] mt-1">{email}</p>
          </div>
        </div>
        
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start border border-emerald-500/30 bg-emerald-500/5">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-400" />
          <p className="text-sm text-emerald-300">Profile updated successfully.</p>
        </div>
      )}

      <div className="space-y-6">
        {/* Basic Information */}
        <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#222] bg-[#111]/50 flex items-center gap-2">
            <User className="w-4 h-4 text-[#888]" />
            <h2 className="text-sm font-semibold text-white">Basic Information</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="e.g. John"
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="e.g. Doe"
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">Email Address</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-4 py-2.5 text-sm text-[#888] outline-none cursor-not-allowed"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +1 234 567 890"
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Work & Location */}
        <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#222] bg-[#111]/50 flex items-center gap-2">
            <Building className="w-4 h-4 text-[#888]" />
            <h2 className="text-sm font-semibold text-white">Work & Location</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">Company Name</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">Job Title</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="e.g. Security Engineer"
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white outline-none focus:border-[#555] transition-colors"
                >
                  <option value="" className="text-[#888]">Select Timezone</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">Eastern Time (US & Canada)</option>
                  <option value="America/Chicago">Central Time (US & Canada)</option>
                  <option value="America/Denver">Mountain Time (US & Canada)</option>
                  <option value="America/Los_Angeles">Pacific Time (US & Canada)</option>
                  <option value="Europe/London">London / GMT</option>
                  <option value="Europe/Paris">Central European Time</option>
                  <option value="Asia/Dubai">Dubai</option>
                  <option value="Asia/Karachi">Pakistan Standard Time</option>
                  <option value="Asia/Kolkata">India Standard Time</option>
                  <option value="Asia/Singapore">Singapore</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                  <option value="Australia/Sydney">Sydney</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#222] bg-[#111]/50 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#888]" />
            <h2 className="text-sm font-semibold text-white">Security</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5 md:col-span-1">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">Current Password</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Required if setting a new password"
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                />
              </div>
              <div className="space-y-1.5 md:col-span-1">
                <label className="text-xs font-semibold text-[#888] uppercase tracking-wider">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  className="w-full rounded-lg border border-[#333] bg-[#0a0a0b] px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                />
              </div>
              <div className="md:col-span-2">
                <p className="text-xs text-[#666]">
                  Changing your password will take effect immediately. You will not be logged out.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
