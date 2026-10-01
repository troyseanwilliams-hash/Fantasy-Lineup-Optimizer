import { Link } from "wouter";
import { LogoBanner } from "@/components/Logo";
import { Mail, Zap } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative mt-20 border-t border-white/[0.07] bg-[#05080F]/90 backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />
      <div className="container mx-auto px-4 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-4">
              <LogoBanner height={35} />
            </div>
            <p className="text-slate-400 max-w-sm mb-5 text-[15px] leading-relaxed">
              AI-driven lineup optimization, props, and projections for DraftKings, FanDuel, and Yahoo — built for DFS players who want an edge.
            </p>
            <a
              href="mailto:support@elitelineupai.com"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-emerald-300 hover:text-emerald-200 hover:border-emerald-400/40 hover:bg-emerald-500/15 text-sm font-semibold transition-all"
              data-testid="footer-support-email"
            >
              <Mail className="w-4 h-4" />
              support@elitelineupai.com
            </a>
          </div>
          <div>
            <h4 className="text-white font-display font-bold mb-4 text-sm uppercase tracking-widest text-slate-300" data-testid="footer-product-heading">Product</h4>
            <ul className="space-y-2.5">
              <li><Link href="/lineup-builder" className="text-slate-400 hover:text-emerald-300 text-sm transition-colors inline-flex items-center gap-1.5 group" data-testid="footer-link-lineup-builder"><Zap className="w-3 h-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all text-emerald-400" />Lineup Builder</Link></li>
              <li><Link href="/prop-insights" className="text-slate-400 hover:text-emerald-300 text-sm transition-colors inline-flex items-center gap-1.5 group" data-testid="footer-link-prop-insights"><Zap className="w-3 h-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all text-emerald-400" />Prop Insights</Link></li>
              <li><Link href="/pricing" className="text-slate-400 hover:text-emerald-300 text-sm transition-colors inline-flex items-center gap-1.5 group" data-testid="footer-link-pricing"><Zap className="w-3 h-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all text-emerald-400" />Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-display font-bold mb-4 text-sm uppercase tracking-widest text-slate-300" data-testid="footer-company-heading">Company</h4>
            <ul className="space-y-2.5">
              <li><Link href="/about" className="text-slate-400 hover:text-emerald-300 text-sm transition-colors inline-flex items-center gap-1.5 group" data-testid="footer-link-about"><Zap className="w-3 h-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all text-emerald-400" />About Us</Link></li>
              <li><Link href="/support" className="text-slate-400 hover:text-emerald-300 text-sm transition-colors inline-flex items-center gap-1.5 group" data-testid="footer-link-contact"><Zap className="w-3 h-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all text-emerald-400" />Contact Support</Link></li>
              <li><Link href="/terms" className="text-slate-400 hover:text-emerald-300 text-sm transition-colors inline-flex items-center gap-1.5 group" data-testid="footer-link-terms"><Zap className="w-3 h-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all text-emerald-400" />Terms of Service</Link></li>
              <li><Link href="/privacy" className="text-slate-400 hover:text-emerald-300 text-sm transition-colors inline-flex items-center gap-1.5 group" data-testid="footer-link-privacy"><Zap className="w-3 h-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all text-emerald-400" />Privacy Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/[0.07] pt-8 flex flex-col md:flex-row justify-between items-center text-slate-500 text-sm">
          <p data-testid="footer-copyright">&copy; 2026 EliteLineup AI. All rights reserved.</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-emerald-300 transition-colors" data-testid="footer-link-twitter">Twitter</a>
            <a href="#" className="hover:text-emerald-300 transition-colors" data-testid="footer-link-discord">Discord</a>
            <Link href="/support" className="hover:text-emerald-300 transition-colors" data-testid="footer-link-support">Support</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
