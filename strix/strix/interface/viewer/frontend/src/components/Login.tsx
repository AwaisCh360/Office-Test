import React, { useState } from "react";
import { Lock, ArrowRight, Loader2, UserPlus, LogIn } from "lucide-react";
import { login, signup } from "@/data/serverSource";

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (!isLoginMode && (!firstName.trim() || !lastName.trim())) return;
    
    setLoading(true);
    setErrorMsg("");
    
    if (isLoginMode) {
      const success = await login(email, password);
      if (success) {
        onSuccess();
      } else {
        setErrorMsg("Invalid email or password");
        setLoading(false);
        setPassword("");
      }
    } else {
      const res = await signup(email, password, firstName, lastName, company);
      if (res.ok) {
        onSuccess();
      } else {
        setErrorMsg(res.error || "Failed to create account");
        setLoading(false);
      }
    }
  };

  const inputClass = "w-full rounded-lg border border-[#222] bg-black px-4 py-3 text-sm text-[#ededed] placeholder:text-zinc-600 focus:outline-none focus:border-[#444] transition-colors";

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-8">
        {/* Logo and branding */}
        <div className="mb-8 flex flex-col items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#2a2a2a] bg-[rgba(255,255,255,0.04)]">
            {isLoginMode ? (
              <Lock className="h-6 w-6 text-[#888]" />
            ) : (
              <UserPlus className="h-6 w-6 text-[#888]" />
            )}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white mt-2">
            {isLoginMode ? "Sign in to Strix" : "Create a Strix Account"}
          </h1>
          <p className="text-sm text-[#888] text-center">
            {isLoginMode 
              ? "Access your dashboard and run history."
              : "Register to unlock the full pentest workspace."}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!isLoginMode && (
            <div className="flex gap-4">
              <div className="w-1/2">
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First Name"
                  className={inputClass}
                  disabled={loading}
                  required
                />
              </div>
              <div className="w-1/2">
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last Name"
                  className={inputClass}
                  disabled={loading}
                  required
                />
              </div>
            </div>
          )}

          {!isLoginMode && (
            <div>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company (Optional)"
                className={inputClass}
                disabled={loading}
              />
            </div>
          )}

          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMsg) setErrorMsg("");
              }}
              placeholder="Email address"
              className={inputClass}
              autoFocus
              disabled={loading}
              required
            />
          </div>

          <div className="relative">
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMsg) setErrorMsg("");
              }}
              placeholder="Password"
              className={inputClass}
              disabled={loading}
              required
            />
          </div>

          {errorMsg && (
            <div className="text-xs font-medium text-red-400 text-center">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={!email || !password || (!isLoginMode && (!firstName || !lastName)) || loading}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {isLoginMode ? "Sign In" : "Sign Up"}
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            type="button"
            onClick={() => {
              setIsLoginMode(!isLoginMode);
              setErrorMsg("");
              setPassword("");
            }}
            className="text-xs text-[#666] hover:text-[#aaa] transition-colors cursor-pointer"
          >
            {isLoginMode ? "Don't have an account? Sign up" : "Already have an account? Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}
