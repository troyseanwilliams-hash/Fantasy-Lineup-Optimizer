import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { usePageMeta } from "@/hooks/use-page-meta";
import {
  Eye, EyeOff, Loader2, UserPlus, LogIn, Phone,
  Zap, TrendingUp, Trophy, Target, Bell, BarChart3, Sparkles, ShieldCheck,
} from "lucide-react";
import { LogoBanner } from "@/components/Logo";

// Marketing panel content — shown beside the form so every visitor sees what
// the product does before they type a character.
const FEATURES = [
  { icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/25", title: "AI Lineup Optimizer", desc: "LP-solved lineups with Monte Carlo simulation for DraftKings, FanDuel & Yahoo." },
  { icon: TrendingUp, color: "text-purple-400", bg: "bg-purple-500/15 border-purple-500/25", title: "Prop Betting Picks", desc: "Sportsbook prop lines analyzed and graded across every active sport." },
  { icon: Trophy, color: "text-amber-400", bg: "bg-amber-500/15 border-amber-500/25", title: "Live Draft Hub", desc: "Live ESPN-ranked fantasy draft board, Mock Draft Simulator & cheat sheets." },
  { icon: Target, color: "text-cyan-400", bg: "bg-cyan-500/15 border-cyan-500/25", title: "PrizePicks Builder", desc: "AI-built entries with correlation-aware pick combos and line movement." },
  { icon: Bell, color: "text-red-400", bg: "bg-red-500/15 border-red-500/25", title: "Real-Time Injury Alerts", desc: "Live statuses baked into every projection before lock." },
  { icon: BarChart3, color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/25", title: "Track Record Dashboard", desc: "Your results vs. optimal and the field — measured, not guessed." },
];

const MOBILE_PILLS = [
  { icon: Zap, label: "AI Optimizer" },
  { icon: Trophy, label: "Draft Hub" },
  { icon: Target, label: "PrizePicks" },
];

function TrialBadge() {
  return (
    <div
      className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2"
      data-testid="badge-free-trial"
    >
      <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      <span className="text-xs font-bold text-emerald-300">7-Day Free Trial · No Credit Card Required</span>
    </div>
  );
}

export default function Login() {
  usePageMeta({ title: "Sign In", description: "Sign in or create an account on EliteLineup AI to access DFS lineup optimization tools.", path: "/login" });
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
      const body: any = { email: email.trim().toLowerCase(), password };
      if (isRegister) {
        body.firstName = firstName.trim();
        body.lastName = lastName.trim();
        body.phone = phone.trim();
        body.smsConsent = smsConsent;
        body.emailConsent = emailConsent;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Something went wrong");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: isRegister ? "Registration Failed" : "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (isRegister && (!firstName || !lastName)) return;
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-[#0F172A] lg:grid lg:grid-cols-2">
      {/* ── Marketing panel (desktop) ─────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-slate-900 via-[#0F172A] to-slate-950 border-r border-slate-800/60 px-12 xl:px-16 py-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_20%_10%,rgba(16,185,129,0.07),transparent)] pointer-events-none" />

        <div className="relative z-10">
          <LogoBanner height={52} />
          <h1 className="text-4xl xl:text-5xl font-black text-white tracking-tight leading-tight mt-8 mb-3">
            Win More.<br />
            <span className="text-emerald-400">Every Night.</span>
          </h1>
          <p className="text-slate-400 text-sm max-w-md leading-relaxed">
            The AI edge for DFS, props, and fantasy drafts — projections sharpened by
            sportsbook markets, simulations calibrated on real results.
          </p>
        </div>

        <div className="relative z-10 space-y-3.5 my-8" data-testid="login-feature-list">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3.5">
              <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${f.bg}`}>
                <f.icon className={`w-[18px] h-[18px] ${f.color}`} />
              </div>
              <div>
                <div className="text-sm font-bold text-white leading-tight">{f.title}</div>
                <div className="text-xs text-slate-400 leading-snug mt-0.5">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Social proof strip */}
        <div className="relative z-10 rounded-xl bg-slate-900/70 border border-slate-800 px-5 py-4" data-testid="login-social-proof">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-sm font-black text-white">Trusted by thousands of DFS players</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            "The sim optimizer found leverage plays I never would have rostered — my first GPP
            cash over $1K came two weeks after signing up." — Champion member
          </p>
        </div>
      </div>

      {/* ── Form panel ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center px-4 py-8 lg:py-12">
        <div className="w-full max-w-md">
          {/* Mobile marketing banner (below lg) */}
          <div className="lg:hidden text-center mb-6" data-testid="login-mobile-banner">
            <div className="flex items-center justify-center mb-3">
              <LogoBanner height={56} />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mb-3">
              Win More. <span className="text-emerald-400">Every Night.</span>
            </h1>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {MOBILE_PILLS.map((p) => (
                <span
                  key={p.label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/80 border border-slate-700 px-3 py-1 text-[11px] font-bold text-slate-300"
                >
                  <p.icon className="w-3 h-3 text-emerald-400" />
                  {p.label}
                </span>
              ))}
            </div>
          </div>

          <div className="hidden lg:block text-center mb-6">
            <p className="text-slate-400 text-sm font-medium">
              {isRegister ? "Create your account to get started" : "Sign in to your account"}
            </p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl">
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="firstName" className="text-slate-300 text-sm font-medium">First Name</Label>
                    <Input
                      id="firstName"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Troy"
                      className="mt-1 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName" className="text-slate-300 text-sm font-medium">Last Name</Label>
                    <Input
                      id="lastName"
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Williams"
                      className="mt-1 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="email" className="text-slate-300 text-sm font-medium">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="mt-1 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                  data-testid="input-email"
                />
              </div>

              <div>
                <Label htmlFor="password" className="text-slate-300 text-sm font-medium">Password</Label>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20 pr-10"
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                    data-testid="toggle-password-visibility"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isRegister && (
                <>
                  <div>
                    <Label htmlFor="phone" className="text-slate-300 text-sm font-medium">Mobile Number</Label>
                    <div className="relative mt-1">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        autoComplete="tel"
                        className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20 pl-10"
                        data-testid="input-phone"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-1">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="smsConsent"
                        checked={smsConsent}
                        onCheckedChange={(checked) => setSmsConsent(checked === true)}
                        className="mt-0.5 border-slate-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                        data-testid="checkbox-sms-consent"
                      />
                      <Label htmlFor="smsConsent" className="text-slate-400 text-xs leading-relaxed cursor-pointer">
                        I agree to receive SMS notifications about lineup alerts, injury updates, and promotions.
                      </Label>
                    </div>
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="emailConsent"
                        checked={emailConsent}
                        onCheckedChange={(checked) => setEmailConsent(checked === true)}
                        className="mt-0.5 border-slate-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                        data-testid="checkbox-email-consent"
                      />
                      <Label htmlFor="emailConsent" className="text-slate-400 text-xs leading-relaxed cursor-pointer">
                        I agree to receive email updates about new features, daily picks, and special offers.
                      </Label>
                    </div>
                  </div>
                </>
              )}

              {isRegister && <TrialBadge />}

              <Button
                type="submit"
                disabled={loginMutation.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11 rounded-lg"
                data-testid="btn-submit-login"
              >
                {loginMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : isRegister ? (
                  <UserPlus className="w-4 h-4 mr-2" />
                ) : (
                  <LogIn className="w-4 h-4 mr-2" />
                )}
                {loginMutation.isPending
                  ? (isRegister ? "Creating Account..." : "Signing In...")
                  : (isRegister ? "Create Account" : "Sign In")}
              </Button>
            </form>

            <div className="mt-5 pt-5 border-t border-slate-800 text-center">
              <p className="text-slate-400 text-sm">
                {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => { setIsRegister(!isRegister); setEmail(""); setPassword(""); setFirstName(""); setLastName(""); setPhone(""); setSmsConsent(false); setEmailConsent(false); }}
                  className="text-emerald-400 hover:text-emerald-300 font-semibold"
                  data-testid="btn-toggle-auth-mode"
                >
                  {isRegister ? "Sign In" : "Sign Up"}
                </button>
              </p>
            </div>
          </div>

          {!isRegister && (
            <div className="mt-4">
              <TrialBadge />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
