// Support page — file a ticket (works logged-in or logged-out).

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, LifeBuoy, CheckCircle2 } from "lucide-react";

const CATEGORIES = [
  { value: "general", label: "General question" },
  { value: "billing", label: "Billing / subscription" },
  { value: "bug", label: "Something's broken" },
  { value: "data", label: "Projections / data issue" },
  { value: "feature", label: "Feature request" },
];

export default function Support() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false });

  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/support", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, subject, message, category }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Failed to submit");
      setTicketId(data.ticketId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (ticketId != null) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
        <h1 className="text-2xl font-black text-white mb-2">Ticket #{ticketId} received</h1>
        <p className="text-slate-400 text-sm mb-6">
          We'll get back to you at <span className="text-white">{email}</span> — usually within 24 hours.
        </p>
        <Button
          variant="outline"
          className="border-slate-700 text-slate-300"
          onClick={() => { setTicketId(null); setSubject(""); setMessage(""); }}
        >
          Submit another ticket
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-14">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <LifeBuoy className="w-5 h-5 text-emerald-400" />
        </div>
        <h1 className="text-3xl font-black text-white">Support</h1>
      </div>
      <p className="text-slate-400 text-sm mb-8">
        Billing problem, broken page, weird projection — tell us and we'll fix it. Prefer email?{" "}
        <a href="mailto:support@elitelineupai.com" className="text-emerald-400 hover:underline">support@elitelineupai.com</a>
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="support-email" className="text-slate-300">Your email</Label>
          <Input
            id="support-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            data-testid="support-email"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-slate-300">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger data-testid="support-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="support-subject" className="text-slate-300">Subject</Label>
          <Input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            minLength={3}
            maxLength={150}
            placeholder="Short summary"
            data-testid="support-subject"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="support-message" className="text-slate-300">What's going on?</Label>
          <Textarea
            id="support-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={10}
            maxLength={4000}
            className="min-h-[140px]"
            placeholder="Include the sport, slate, and what you expected to happen — the more detail the faster we can fix it."
            data-testid="support-message"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11"
          data-testid="support-submit"
        >
          {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</> : "Submit ticket"}
        </Button>
      </form>
    </div>
  );
}
