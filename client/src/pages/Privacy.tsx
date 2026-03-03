import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-300">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link href="/" className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 mb-8" data-testid="link-back-home">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </Link>

        <h1 className="text-4xl font-bold text-white mb-2" data-testid="text-privacy-title">Privacy Policy</h1>
        <p className="text-slate-400 mb-10" data-testid="text-privacy-updated">Last updated: January 1, 2025</p>

        <div className="space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Information We Collect</h2>
            <p className="mb-3">
              EliteLineup AI collects information to provide and improve our services. The types of information we collect include:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li><span className="text-white font-medium">Account Information:</span> When you create an account, we collect your name, email address, and authentication credentials.</li>
              <li><span className="text-white font-medium">Profile Information:</span> Sport preferences, favorite teams, and optimizer settings you configure.</li>
              <li><span className="text-white font-medium">Usage Data:</span> Information about how you interact with the platform, including lineups generated, pages visited, and features used.</li>
              <li><span className="text-white font-medium">Payment Information:</span> If you subscribe to a paid plan, payment details are collected and processed by our third-party payment processor. We do not store full credit card numbers.</li>
              <li><span className="text-white font-medium">Device & Technical Data:</span> Browser type, IP address, device identifiers, operating system, and referring URLs.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. How We Use Information</h2>
            <p className="mb-3">We use the information we collect for the following purposes:</p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>Providing, maintaining, and improving our DFS lineup optimization and prop analysis services.</li>
              <li>Personalizing your experience, including sport-specific recommendations and optimizer configurations.</li>
              <li>Processing transactions and managing your subscription.</li>
              <li>Sending service-related communications such as account verification, security alerts, and feature updates.</li>
              <li>Analyzing usage patterns to improve platform performance and develop new features.</li>
              <li>Preventing fraud, abuse, and unauthorized access to our services.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. Data Storage & Security</h2>
            <p className="mb-3">
              We take the security of your data seriously. EliteLineup AI implements industry-standard security measures to protect your personal information, including:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li>Encryption of data in transit using TLS/SSL protocols.</li>
              <li>Secure storage of sensitive data using encryption at rest.</li>
              <li>Regular security audits and vulnerability assessments.</li>
              <li>Access controls limiting employee access to personal data on a need-to-know basis.</li>
            </ul>
            <p className="mt-3">
              While we strive to protect your information, no method of electronic transmission or storage is 100% secure. We cannot guarantee absolute security but are committed to continuous improvement of our safeguards.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. Cookies</h2>
            <p className="mb-3">
              EliteLineup AI uses cookies and similar tracking technologies to enhance your experience. These include:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li><span className="text-white font-medium">Essential Cookies:</span> Required for basic platform functionality, such as authentication and session management.</li>
              <li><span className="text-white font-medium">Analytics Cookies:</span> Help us understand how users interact with our platform to improve features and performance.</li>
              <li><span className="text-white font-medium">Preference Cookies:</span> Store your settings and preferences, such as theme selection and sport filters.</li>
            </ul>
            <p className="mt-3">
              You can manage cookie preferences through your browser settings. Disabling essential cookies may affect your ability to use certain features of the platform.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">5. Third-Party Services</h2>
            <p className="mb-3">
              EliteLineup AI integrates with and references data from third-party services to power our optimization tools. These include:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li><span className="text-white font-medium">DraftKings:</span> We reference publicly available player salaries, contest structures, and scoring rules to generate optimized lineups. We are not affiliated with or endorsed by DraftKings.</li>
              <li><span className="text-white font-medium">PrizePicks:</span> We reference publicly available player projections and prop lines to power our PrizePicks builder tools. We are not affiliated with or endorsed by PrizePicks.</li>
              <li><span className="text-white font-medium">Sports Data Providers:</span> We use third-party APIs to obtain player statistics, injury reports, and game schedules.</li>
              <li><span className="text-white font-medium">Payment Processors:</span> Subscription payments are handled by trusted third-party payment processors that maintain their own privacy and security practices.</li>
              <li><span className="text-white font-medium">Analytics Providers:</span> We may use third-party analytics services to understand platform usage patterns.</li>
            </ul>
            <p className="mt-3">
              These third-party services have their own privacy policies. We encourage you to review them independently.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">6. SMS/Email Communications</h2>
            <p className="mb-3">
              By providing your email address or phone number, you may receive the following types of communications:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li><span className="text-white font-medium">Transactional:</span> Account verification, password resets, subscription confirmations, and security alerts.</li>
              <li><span className="text-white font-medium">Service Updates:</span> New feature announcements, slate notifications, and platform maintenance notices.</li>
              <li><span className="text-white font-medium">Marketing:</span> Promotional content, special offers, and tips for improving your DFS strategy (with your opt-in consent).</li>
            </ul>
            <p className="mt-3">
              You can opt out of marketing communications at any time by using the unsubscribe link in any email or by contacting us directly. Transactional messages related to your account and service cannot be opted out of while maintaining an active account.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. User Rights</h2>
            <p className="mb-3">
              Depending on your jurisdiction, you may have the following rights regarding your personal data:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-4">
              <li><span className="text-white font-medium">Access:</span> Request a copy of the personal data we hold about you.</li>
              <li><span className="text-white font-medium">Correction:</span> Request correction of inaccurate or incomplete data.</li>
              <li><span className="text-white font-medium">Deletion:</span> Request deletion of your personal data, subject to legal retention requirements.</li>
              <li><span className="text-white font-medium">Portability:</span> Request transfer of your data in a machine-readable format.</li>
              <li><span className="text-white font-medium">Restriction:</span> Request restriction of processing of your personal data under certain circumstances.</li>
              <li><span className="text-white font-medium">Objection:</span> Object to the processing of your personal data for marketing purposes.</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, please contact us at privacy@elitelineupai.com. We will respond to your request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">8. Children's Privacy</h2>
            <p>
              EliteLineup AI is not intended for use by individuals under the age of 18. We do not knowingly collect personal information from minors. If we become aware that we have collected data from a user under 18, we will take steps to delete that information promptly. If you are a parent or guardian and believe your child has provided us with personal information, please contact us at privacy@elitelineupai.com.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make material changes, we will notify you by posting the updated policy on this page and updating the "Last updated" date above. We encourage you to review this policy periodically. Your continued use of EliteLineup AI after any changes constitutes your acceptance of the updated Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">10. Contact Us</h2>
            <p className="mb-3">
              If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
            </p>
            <ul className="space-y-2 pl-4">
              <li><span className="text-white font-medium">Email:</span> privacy@elitelineupai.com</li>
              <li><span className="text-white font-medium">Support:</span> support@elitelineupai.com</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}