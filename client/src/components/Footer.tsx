export function Footer() {
  return (
    <footer className="bg-[var(--bg-dark)] border-t border-slate-800 py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-[var(--primary)] rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">E</span>
              </div>
              <span className="text-xl font-bold text-white">EliteLineup AI</span>
            </div>
            <p className="text-slate-400 max-w-sm mb-6">
              Empowering DFS players and sports bettors with AI-driven insights and real-time data analysis for smarter decisions.
            </p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">Product</h4>
            <ul className="space-y-2">
              <li><a href="#" className="nav-link text-sm">Lineup Builder</a></li>
              <li><a href="#" className="nav-link text-sm">Prop Insights</a></li>
              <li><a href="#" className="nav-link text-sm">Pricing</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">Company</h4>
            <ul className="space-y-2">
              <li><a href="#" className="nav-link text-sm">About Us</a></li>
              <li><a href="#" className="nav-link text-sm">Terms of Service</a></li>
              <li><a href="#" className="nav-link text-sm">Privacy Policy</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center text-slate-400 text-sm">
          <p>© 2024 EliteLineup AI. All rights reserved.</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-white">Twitter</a>
            <a href="#" className="hover:text-white">Discord</a>
            <a href="#" className="hover:text-white">Support</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
