import React, { useState, useEffect } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { auth } from "../firebase";
import { Sparkles, Shirt, Lock, Mail, UserPlus, LogIn, Sparkle, AlertTriangle, Database } from "lucide-react";

interface AuthScreenProps {
  onSuccess: (uid: string) => void;
}

export default function AuthScreen({ onSuccess }: AuthScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authDisabledError, setAuthDisabledError] = useState(false);
  const [hasSupabase, setHasSupabase] = useState<boolean>(false);
  const [supabaseUrl, setSupabaseUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((res) => res.json())
      .then((data) => {
        setHasSupabase(data.hasSupabase);
        setSupabaseUrl(data.supabaseUrl);
      })
      .catch((err) => console.error("Failed to check Supabase config:", err));
  }, []);

  const handleSandboxBypass = () => {
    setError(null);
    const cleanEmail = email.toLowerCase().trim();

    // If no credentials provided (e.g. called from Firebase error screen), use guest session
    if (!cleanEmail || !password) {
      onSuccess("guest-sandbox-user");
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
      onSuccess(`local-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "-")}`);
    } else {
      if (!storedPassword) {
        // Auto-create the local account so first-time users don't get stuck
        localStorage.setItem(`auth_pwd_${cleanEmail}`, password);
        onSuccess(`local-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "-")}`);
        return;
      }
      if (storedPassword !== password) {
        setError("Invalid email or password.");
        setAuthDisabledError(false);
        return;
      }
      onSuccess(`local-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "-")}`);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (hasSupabase) {
      try {
        const endpoint = isSignUp ? "/api/auth/signup" : "/api/auth/login";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const errText = await res.text();
          let message = "Authentication failed.";
          try {
            const parsed = JSON.parse(errText);
            message = parsed.error || message;
          } catch {
            message = errText || message;
          }
          throw new Error(message);
        }
        const data = await res.json();
        localStorage.setItem("supabase_user", JSON.stringify({ uid: data.uid, email: data.email }));
        onSuccess(data.uid);
      } catch (err: any) {
        setError(err.message || "An unexpected error occurred during Supabase authentication.");
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      if (isSignUp) {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          onSuccess(userCredential.user.uid);
        } catch (signUpErr: any) {
          if (signUpErr.code === "auth/email-already-in-use") {
            try {
              const userCredential = await signInWithEmailAndPassword(auth, email, password);
              onSuccess(userCredential.user.uid);
            } catch (signInErr: any) {
              if (signInErr.code === "auth/wrong-password" || signInErr.code === "auth/invalid-credential") {
                setError("This email is already registered. Please enter the correct password to sign in.");
                setLoading(false);
                return;
              }
              throw signUpErr;
            }
          } else {
            throw signUpErr;
          }
        }
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        onSuccess(userCredential.user.uid);
      }
    } catch (err: any) {
      // Check if Firebase Auth is not configured or disabled in the console
      const isAuthDisabled = 
        err.code === "auth/operation-not-allowed" || 
        err.code === "auth/admin-restricted-operation" ||
        err.message?.includes("operation-not-allowed") ||
        err.message?.includes("not allowed") ||
        err.message?.includes("restricted");

      const isValidationError = 
        err.code === "auth/wrong-password" || 
        err.code === "auth/user-not-found" || 
        err.code === "auth/invalid-credential" ||
        err.code === "auth/email-already-in-use" ||
        err.code === "auth/weak-password" ||
        err.code === "auth/invalid-email";

      if (isValidationError) {
        console.warn("User validation during auth:", err.code || err.message);
      } else if (isAuthDisabled) {
        console.warn("Firebase Auth not enabled in console. Triggering instructions banner.");
      } else {
        console.error("Auth error:", err);
      }
      
      if (isAuthDisabled) {
        setAuthDisabledError(true);
      } else {
        let friendlyMessage = "Authentication failed. Please try again.";
        if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
          friendlyMessage = "Invalid email or password.";
        } else if (err.code === "auth/email-already-in-use") {
          friendlyMessage = "An account already exists with this email.";
        } else if (err.code === "auth/weak-password") {
          friendlyMessage = "Password should be at least 6 characters.";
        } else if (err.code === "auth/invalid-email") {
          friendlyMessage = "Please enter a valid email address.";
        }
        setError(friendlyMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  if (authDisabledError) {
    return (
      <div id="auth-screen" className="min-h-screen flex flex-col justify-between bg-[#F0F1F5] px-6 py-12 md:justify-center md:py-20 select-none">
        {/* Brand Header */}
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

        {/* Info Card */}
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

          <details className="text-xs text-gray-400 leading-relaxed">
            <summary className="cursor-pointer font-semibold text-gray-500 hover:text-gray-700 transition">Firebase setup required for email sign-in ▾</summary>
            <ol className="list-decimal list-inside space-y-1.5 mt-2 text-gray-500">
              <li>Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline font-semibold">Firebase Console</a>.</li>
              <li>Navigate to <strong className="text-gray-700">Build &gt; Authentication &gt; Sign-in method</strong>.</li>
              <li>Enable <strong className="text-gray-700">Email/Password</strong> and save.</li>
            </ol>
          </details>
        </div>

        <div className="text-center text-[11px] text-gray-400 mt-8 max-w-xs mx-auto">
          Your wardrobe is saved locally in your browser.
        </div>
      </div>
    );
  }

  const handleGuestLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const userCredential = await signInAnonymously(auth);
      onSuccess(userCredential.user.uid);
    } catch (err: any) {
      console.warn("Anonymous login error, trying guest email fallback:", err);
      try {
        const guestEmail = "guest@wardrobe.com";
        const guestPassword = "guestpassword123";
        try {
          const userCredential = await signInWithEmailAndPassword(auth, guestEmail, guestPassword);
          onSuccess(userCredential.user.uid);
        } catch (signInErr: any) {
          if (signInErr.code === "auth/user-not-found" || signInErr.code === "auth/invalid-credential") {
            const userCredential = await createUserWithEmailAndPassword(auth, guestEmail, guestPassword);
            onSuccess(userCredential.user.uid);
          } else {
            throw signInErr;
          }
        }
      } catch (fallbackErr: any) {
        console.warn("Guest login fallback triggered:", fallbackErr.message || fallbackErr);
        onSuccess("demo-household-user-123");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="auth-screen" className="min-h-screen flex flex-col justify-between bg-[#F0F1F5] px-6 py-12 md:justify-center md:py-20 select-none">
      {/* Brand Header */}
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

      {/* Main card */}
      <div className="w-full max-w-md mx-auto bg-white rounded-[32px] p-8 shadow-md border border-[#E5E7EB] space-y-6">
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

        {/* Guest / Fast login options */}
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

// Inline loader icon
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
