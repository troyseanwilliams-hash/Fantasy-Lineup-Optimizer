import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Terms() {
  return (
    <div className="bg-[#0F172A] min-h-screen text-slate-300">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" className="text-slate-400 mb-4" data-testid="link-back-home">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
          <h1 className="text-4xl font-bold text-white mb-2" data-testid="text-terms-title">Terms of Service</h1>
          <p className="text-slate-400" data-testid="text-terms-updated">Last updated: January 1, 2025</p>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the EliteLineup AI platform ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to all of these Terms, you may not access or use the Service. These Terms apply to all visitors, users, and others who access or use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">2. Description of Service</h2>
            <p>
              EliteLineup AI provides an AI-powered daily fantasy sports (DFS) lineup optimization platform. Our Service includes lineup generation tools for DraftKings contests, prop bet analysis, PrizePicks builder tools, and related sports analytics features across NFL, NBA, MLB, NHL, and golf. The Service is designed to assist users in making informed decisions for DFS contests and sports analysis.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">3. User Accounts</h2>
            <p className="mb-3">
              To access certain features of the Service, you may be required to create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>Provide accurate and complete information when creating your account</li>
              <li>Update your account information to keep it current</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
              <li>Not share your account credentials with any third party</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">4. Subscription & Payments</h2>
            <p className="mb-3">
              EliteLineup AI offers both free and paid subscription plans. By subscribing to a paid plan, you agree to the following:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>Subscription fees are billed in advance on a recurring basis (monthly or annually, depending on the plan selected)</li>
              <li>All fees are non-refundable unless otherwise stated or required by applicable law</li>
              <li>We reserve the right to change subscription pricing with advance notice to existing subscribers</li>
              <li>You may cancel your subscription at any time; cancellation takes effect at the end of the current billing period</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">5. Acceptable Use</h2>
            <p className="mb-3">
              You agree not to use the Service to:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>Violate any applicable laws, regulations, or third-party rights</li>
              <li>Reverse engineer, decompile, or attempt to extract the source code of our algorithms or software</li>
              <li>Use automated scripts, bots, or scrapers to access the Service</li>
              <li>Resell, redistribute, or commercially exploit any data or content from the Service without authorization</li>
              <li>Interfere with or disrupt the integrity or performance of the Service</li>
              <li>Attempt to gain unauthorized access to any part of the Service or its related systems</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">6. Intellectual Property</h2>
            <p>
              All content, features, and functionality of the Service, including but not limited to algorithms, software, text, graphics, logos, and trademarks, are the exclusive property of EliteLineup AI and are protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works based on any part of the Service without our prior written consent.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">7. Disclaimers</h2>
            <p className="mb-3 font-semibold text-slate-200">
              EliteLineup AI is NOT a gambling service and does NOT provide gambling advice.
            </p>
            <p className="mb-3">
              The Service provides data-driven analysis and optimization tools for daily fantasy sports contests. All projections, recommendations, and lineup suggestions are for informational and entertainment purposes only. We do not guarantee any specific results, winnings, or outcomes from using our Service.
            </p>
            <p>
              Users are solely responsible for their own decisions regarding participation in DFS contests and any associated financial risks. Past performance of our tools or projections does not guarantee future results. You should never risk more than you can afford to lose.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">8. Limitation of Liability</h2>
            <p className="mb-3">
              To the maximum extent permitted by applicable law, EliteLineup AI and its officers, directors, employees, and agents shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>Loss of profits, data, or other intangible losses</li>
              <li>Financial losses resulting from DFS contest participation</li>
              <li>Any damages arising from your use of or inability to use the Service</li>
              <li>Any unauthorized access to or alteration of your data</li>
            </ul>
            <p className="mt-3">
              Our total liability for any claims arising under these Terms shall not exceed the amount you paid us in the twelve (12) months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">9. Termination</h2>
            <p>
              We reserve the right to suspend or terminate your account and access to the Service at our sole discretion, without notice, for conduct that we believe violates these Terms or is harmful to other users, us, or third parties. Upon termination, your right to use the Service will immediately cease. All provisions of these Terms which by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, and limitations of liability.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">10. Changes to Terms</h2>
            <p>
              We reserve the right to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion. By continuing to access or use the Service after those revisions become effective, you agree to be bound by the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">11. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the United States, without regard to its conflict of law provisions. Any disputes arising from these Terms or the Service shall be resolved through binding arbitration in accordance with applicable rules.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">12. Contact</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at:
            </p>
            <p className="mt-3 text-emerald-400" data-testid="text-terms-contact-email">
              support@elitelineupai.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}