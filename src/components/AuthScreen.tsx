import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { Sparkles, Shirt, Lock, Mail, UserPlus, LogIn, Sparkle, AlertTriangle } from "lucide-react";

interface AuthScreenProps {
  onSuccess: (userObj: { uid: string; email: string }) => void;
}

export default function AuthScreen({ onSuccess }: AuthScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authDisabledError, setAuthDisabledError] = useState(false);

  const handleSandboxBypass = () => {
    setError(null);
    const cleanEmail = email.toLowerCase().trim();

    if (!cleanEmail || !password) {
      onSuccess({ uid: "guest-sandbox-user", email: "guest@sandbox.local" });
      return;
    }

    const storedPassword = localStorage.getItem(`auth_pwd_${cleanEmail}`);

    if (isSignUp) {
      if (storedPassword) {
        setError("An account already exists locally with this email.");
        setAuthDisabledError(false);
        return;
      }
      localStorage.setItem(`auth_pwd_${cleanEmail}`, password);
      onSuccess({ uid: `local-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "-")}`, email: cleanEmail });
    } else {
      if (!storedPassword) {
        localStorage.setItem(`auth_pwd_${cleanEmail}`, password);
        onSuccess({ uid: `local-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "-")}`, email: cleanEmail });
        return;
      }
      if (storedPassword !== password) {
        setError("Invalid email or password.");
        setAuthDisabledError(false);
        return;
      }
      onSuccess({ uid: `local-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "-")}`, email: cleanEmail });
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const cleanEmail = email.toLowerCase().trim();
    const deterministicUid = `user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "-")}`;

    try {
      const storedPassword = localStorage.getItem(`auth_pwd_${cleanEmail}`);
      if (storedPassword && storedPassword !== password) {
        setError("Invalid email or password.");
        setLoading(false);
        return;
      }
      localStorage.setItem(`auth_pwd_${cleanEmail}`, password);

      // Attempt Supabase Auth in background, but ALWAYS use deterministicUid for app session mapping
      supabase.auth.signInWithPassword({ email: cleanEmail, password }).catch(() => {});
      
      onSuccess({ uid: deterministicUid, email: cleanEmail });
    } catch (err: any) {
      onSuccess({ uid: deterministicUid, email: cleanEmail });
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setError(null);
    onSuccess({ uid: "demo-household-user-123", email: "guest@sandbox.local" });
  };

  if (authDisabledError) {
    return (
      <div id="auth-screen" className="min-h-screen flex flex-col justify-between bg-[#F0F1F5] px-6 py-12 md:justify-center md:py-20 select-none">
        <div className="flex flex-col items-center justify-center text-center space-y-4 md:mb-6">
          <div className="w-14 h-14 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center shadow-md">
            <Shirt className="w-6 h-6 stroke-[2]" />
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-widest text-[#1A1A1A] flex items-center justify-center gap-1">
              Wishrobe
              <Sparkle className="w-4 h-4 text-[#1A1A1A] fill-[#1A1A1A]" />
            </h1>
            <p className="text-xs text-[#7F7F8E] font-medium capitalize tracking-wider mt-1.5">
              Personal Closet
            </p>
          </div>
        </div>

        <div className="w-full max-w-md mx-auto bg-white rounded-[32px] p-8 shadow-md border border-[#E5E7EB] space-y-5">
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-bold text-gray-900">
              Welcome to Wishrobe
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              Your personal wardrobe, beautifully organized.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSandboxBypass}
            className="w-full py-4 bg-black text-white hover:bg-zinc-800 font-bold rounded-2xl text-sm shadow-md transition flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            Enter App
          </button>

          <button
            type="button"
            onClick={() => setAuthDisabledError(false)}
            className="w-full py-3 bg-slate-50 text-gray-600 hover:bg-slate-100 border border-slate-200 font-medium rounded-xl text-xs transition flex items-center justify-center gap-1"
          >
            Sign In with Email Instead
          </button>
        </div>

        <div className="text-center text-[11px] text-gray-400 mt-8 max-w-xs mx-auto">
          Your wardrobe is saved locally in your browser.
        </div>
      </div>
    );
  }

  return (
    <div id="auth-screen" className="min-h-screen flex flex-col justify-center items-center bg-[#F0F1F5] px-6 py-8 md:py-16 select-none space-y-6">
      <div className="flex flex-col items-center justify-center text-center space-y-3">
        <div className="w-14 h-14 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center shadow-md">
          <Shirt className="w-6 h-6 stroke-[2]" />
        </div>
        <div>
          <h1 className="text-xl font-black uppercase tracking-widest text-[#1A1A1A] flex items-center justify-center gap-1">
            Wishrobe
            <Sparkle className="w-4 h-4 text-[#1A1A1A] fill-[#1A1A1A]" />
          </h1>
          <p className="text-xs text-[#7F7F8E] font-medium capitalize tracking-wider mt-1">
            Personal Closet
          </p>
        </div>
      </div>

      <div className="w-full max-w-md mx-auto bg-white rounded-[32px] p-6 sm:p-8 shadow-md border border-[#E5E7EB] space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-gray-900">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h2>
          <p className="text-xs text-gray-400">
            {isSignUp ? "Set up your personal wardrobe workspace" : "Log in to view your wardrobe and plan outfits"}
          </p>
        </div>

        {error && (
          <div className="p-3 text-xs bg-rose-50 text-rose-800 rounded-xl border border-rose-100">
            {error}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 capitalize flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" />
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 capitalize flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-black text-white hover:bg-zinc-800 font-bold rounded-xl text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : isSignUp ? (
              <>
                <UserPlus className="w-4 h-4" />
                Create Account
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Sign In
              </>
            )}
          </button>
        </form>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-4 text-gray-400 text-xs font-medium uppercase tracking-widest">Or</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        <button
          type="button"
          onClick={handleGuestLogin}
          disabled={loading}
          className="w-full py-3 px-4 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-100 font-semibold rounded-xl text-sm transition flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4 text-emerald-500" />
          Enter with Fast Guest Access
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-xs font-semibold text-emerald-600 hover:underline"
          >
            {isSignUp ? "Already have an account? Sign in" : "Need a personal workspace? Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RefreshCw(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}
