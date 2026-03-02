import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap, User, Mail, Phone, Bell, Shield, ChevronRight } from "lucide-react";

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."];

export default function Onboarding() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [salutation, setSalutation] = useState("");
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async (data: {
      salutation: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      smsConsent: boolean;
      emailConsent: boolean;
    }) => {
      const res = await apiRequest("POST", "/api/onboarding", data);
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Welcome aboard!", description: "Your profile has been set up successfully." });
      navigate("/");
    },
    onError: (err: any) => {
      toast({ title: "Something went wrong", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!salutation) newErrors.salutation = "Please select a salutation";
    if (!firstName.trim()) newErrors.firstName = "First name is required";
    if (!lastName.trim()) newErrors.lastName = "Last name is required";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = "Valid email is required";
    if (!phone.trim() || phone.replace(/\D/g, "").length < 7) newErrors.phone = "Valid phone number is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    mutation.mutate({ salutation, firstName, lastName, email, phone, smsConsent, emailConsent });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-dark)] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
            <Zap className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight" data-testid="onboarding-title">
            Welcome to EliteLineup AI
          </h1>
          <p className="text-slate-400 mt-2">
            Let's set up your profile to get started
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-sm text-slate-500 hover:text-slate-300 mt-3 transition-colors"
            data-testid="button-skip-onboarding"
          >
            Skip for now
          </button>
        </div>

        <Card className="bg-slate-800/60 border-slate-700/50 p-6" data-testid="onboarding-card">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex items-center gap-2 mb-4 pb-4 border-b border-slate-700/50">
              <User className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-bold text-white">Personal Information</span>
            </div>

            <div>
              <Label htmlFor="salutation" className="text-sm font-bold text-slate-300 mb-1.5 block">
                Salutation
              </Label>
              <Select value={salutation} onValueChange={setSalutation}>
                <SelectTrigger
                  id="salutation"
                  className="bg-slate-900/60 border-slate-700 text-white"
                  data-testid="input-salutation"
                >
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {SALUTATIONS.map(s => (
                    <SelectItem key={s} value={s} className="text-white hover:bg-slate-700">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.salutation && <p className="text-red-400 text-xs mt-1">{errors.salutation}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="firstName" className="text-sm font-bold text-slate-300 mb-1.5 block">
                  First Name
                </Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  className="bg-slate-900/60 border-slate-700 text-white placeholder:text-slate-500"
                  data-testid="input-first-name"
                />
                {errors.firstName && <p className="text-red-400 text-xs mt-1">{errors.firstName}</p>}
              </div>
              <div>
                <Label htmlFor="lastName" className="text-sm font-bold text-slate-300 mb-1.5 block">
                  Last Name
                </Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  className="bg-slate-900/60 border-slate-700 text-white placeholder:text-slate-500"
                  data-testid="input-last-name"
                />
                {errors.lastName && <p className="text-red-400 text-xs mt-1">{errors.lastName}</p>}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 pb-2 border-b border-slate-700/50">
              <Mail className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-bold text-white">Contact Details</span>
            </div>

            <div>
              <Label htmlFor="email" className="text-sm font-bold text-slate-300 mb-1.5 block">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                className="bg-slate-900/60 border-slate-700 text-white placeholder:text-slate-500"
                data-testid="input-email"
              />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <Label htmlFor="phone" className="text-sm font-bold text-slate-300 mb-1.5 block">
                Phone Number
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="bg-slate-900/60 border-slate-700 text-white placeholder:text-slate-500 pl-10"
                  data-testid="input-phone"
                />
              </div>
              {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
            </div>

            <div className="flex items-center gap-2 pt-2 pb-2 border-b border-slate-700/50">
              <Bell className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-bold text-white">Alert Preferences</span>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/40 border border-slate-700/40 cursor-pointer hover:border-emerald-500/30 transition-colors">
                <Checkbox
                  checked={smsConsent}
                  onCheckedChange={(checked) => setSmsConsent(checked === true)}
                  className="mt-0.5 border-slate-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                  data-testid="checkbox-sms-consent"
                />
                <div>
                  <span className="text-sm font-bold text-white block">SMS Alerts</span>
                  <span className="text-xs text-slate-400">Receive text message alerts for lineup updates, injury news, and prop picks</span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/40 border border-slate-700/40 cursor-pointer hover:border-emerald-500/30 transition-colors">
                <Checkbox
                  checked={emailConsent}
                  onCheckedChange={(checked) => setEmailConsent(checked === true)}
                  className="mt-0.5 border-slate-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                  data-testid="checkbox-email-consent"
                />
                <div>
                  <span className="text-sm font-bold text-white block">Email Alerts</span>
                  <span className="text-xs text-slate-400">Receive email notifications for daily picks, slate updates, and special offers</span>
                </div>
              </label>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-900/30 border border-slate-700/30">
              <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Your information is secure and will never be sold to third parties. You can update your preferences at any time.
              </p>
            </div>

            <Button
              type="submit"
              disabled={mutation.isPending}
              size="lg"
              className="w-full bg-emerald-500 text-black font-bold"
              data-testid="button-complete-onboarding"
            >
              {mutation.isPending ? (
                "Setting up..."
              ) : (
                <>
                  Get Started <ChevronRight className="w-5 h-5 ml-1" />
                </>
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
