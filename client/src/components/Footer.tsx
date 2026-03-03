import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-[#0F172A] border-t border-border py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-[#10B981] rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">E</span>
              </div>
              <span className="text-xl font-bold text-white">EliteLineup AI</span>
            </div>
            <p className="text-slate-400 max-w-sm mb-6">
              Empowering DFS players and sports bettors with AI-driven insights and real-time data analysis for smarter decisions.
            </p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4" data-testid="footer-product-heading">Product</h4>
            <ul className="space-y-2">
              <li><Link href="/lineup-builder" className="text-slate-400 hover:text-white text-sm transition-colors" data-testid="footer-link-lineup-builder">Lineup Builder</Link></li>
              <li><Link href="/prop-insights" className="text-slate-400 hover:text-white text-sm transition-colors" data-testid="footer-link-prop-insights">Prop Insights</Link></li>
              <li><Link href="/pricing" className="text-slate-400 hover:text-white text-sm transition-colors" data-testid="footer-link-pricing">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4" data-testid="footer-company-heading">Company</h4>
            <ul className="space-y-2">
              <li><Link href="/about" className="text-slate-400 hover:text-white text-sm transition-colors" data-testid="footer-link-about">About Us</Link></li>
              <li><Link href="/terms" className="text-slate-400 hover:text-white text-sm transition-colors" data-testid="footer-link-terms">Terms of Service</Link></li>
              <li><Link href="/privacy" className="text-slate-400 hover:text-white text-sm transition-colors" data-testid="footer-link-privacy">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border pt-8 flex flex-col md:flex-row justify-between items-center text-slate-400 text-sm">
          <p data-testid="footer-copyright">&copy; 2026 EliteLineup AI. All rights reserved.</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-white" data-testid="footer-link-twitter">Twitter</a>
            <a href="#" className="hover:text-white" data-testid="footer-link-discord">Discord</a>
            <a href="mailto:support@elitelineupai.com" className="hover:text-white" data-testid="footer-link-support">Support</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
