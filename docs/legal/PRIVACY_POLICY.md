# PnL Lens — Privacy Policy

**DRAFT v0.1 — 11 October 2026 — NOT IN FORCE.** For review by a qualified lawyer before publication.
Effective date: [EFFECTIVE DATE] · Last updated: [LAST UPDATED DATE]

> **How to read this draft**
> - **LAWYER CHECK** marks a legal point a lawyer must confirm or rewrite.
> - **BUILD CHECK** marks a statement about a feature that is planned (backend-v2) but not live yet. Do not publish the statement until the feature works as described.
> - Text in [SQUARE BRACKETS] is a detail you must fill in.
> - Remove this box, and every marker, before publishing.

---

## 1. Who we are

PnL Lens (pnllens.com) is operated by **[COMPANY LEGAL NAME]**, a company registered in India (CIN [CIN]), with its registered office at **[REGISTERED ADDRESS]** ("**PnL Lens**", "**we**", "**us**").

For your personal data, we are the **Data Fiduciary** under India's Digital Personal Data Protection Act, 2023 (the "**DPDP Act**"). Where the EU or UK General Data Protection Regulation (the "**GDPR**") applies, we are the **controller**.
**LAWYER CHECK:** confirm the GDPR applies to our Global site (we offer the service to people in the EU/UK, priced in USD). If so, confirm whether we must appoint an EU and/or UK representative under Article 27: [EU REPRESENTATIVE NAME AND ADDRESS] / [UK REPRESENTATIVE NAME AND ADDRESS].

Questions about privacy: **support@pnllens.com**. Our Grievance Officer is listed in section 11.

## 2. The short version

- You upload your broker statements. We read them on our servers and build your report.
- Your uploaded files are **encrypted** and **deleted automatically after 30 days**. **BUILT ✓** (Phases 4–5: per-file AES-256-GCM; nightly purge + sweep)
- Your reports, and the trades in them, stay in your account **until you delete them or close your account**.
- We do **not** sell your data, show ads, give trading tips, or connect to your broker account.
- Using your data to improve PnL Lens (research) is **off unless you switch it on**, and you can switch it off at any time.
- Your data is stored in **India** (DigitalOcean, Bengaluru).

## 3. What we collect

| Category | What exactly | Where it comes from |
|---|---|---|
| **Account** | Email address; name (if you sign in with Google); Google account ID; country; sign-in dates; account role; credits and plan balance | You, Google sign-in, Cloudflare (country) |
| **Sign-in codes** | One-time email codes, stored only as a hashed (scrambled) value, plus the IP address that asked for them | You |
| **Uploaded files** | The broker statements and tradebooks you upload (Excel, CSV, PDF, Word), with their file names and a fingerprint (SHA-256 hash). **Broker files often contain more than trades**, such as your name, client code, PAN or address. | You |
| **Trades** | The trades we read from your files: instrument, dates and times, quantities, prices, profit and loss, charges | Derived from your files |
| **Reports** | The analysis we produce: metrics, charts data, insights, behavioural patterns, progress scores | Derived from your trades |
| **Payments** | Plan bought, amount, currency, payment status, and Razorpay order and payment IDs. **We never see or store your card number, UPI PIN or bank login.** | You, Razorpay |
| **Consent records** | What you agreed to (processing, and the optional research use), the version of the wording, the time, your IP address and browser type | You |
| **Usage and security logs** | IP address; browser type; pages and app actions (for example "upload started", "report viewed", "tab viewed"); error reports from the app (error message, page, technical trace); daily activity; a record of important account actions (audit log); a log of every access to your uploaded files | Your device, our servers |
| **Support messages** | What you write to support@pnllens.com and our notes on the request | You |

**What we do not collect:** broker passwords, broker API keys or access to your broker account; your full card or bank details; precise location (we only infer your country, from your network address).

**Please upload only your own statements**, or statements you have the account holder's permission to upload (for example, as their coach). Where possible, use the broker's "P&L" or "tradebook" export rather than a full contract note, as it carries less personal detail.

## 4. Why we use it, and on what basis

| Purpose | Data used | DPDP Act basis | GDPR basis (where it applies) |
|---|---|---|---|
| Create and run your account; sign you in | Account, sign-in codes | Consent (s. 6) / legitimate use for a service you requested (s. 7(a)) **LAWYER CHECK** | Contract (Art. 6(1)(b)) |
| Read your files and produce your reports | Uploaded files, trades, reports | Consent given at upload (s. 6) | Contract (Art. 6(1)(b)) |
| Take payment and apply your plan | Payments, account | Consent / legitimate use (s. 7(a)) | Contract (Art. 6(1)(b)) |
| Keep the service secure, prevent abuse, fix errors | Usage and security logs | Legitimate use **LAWYER CHECK** (confirm which s. 7 ground, if any, covers security logging) | Legitimate interests (Art. 6(1)(f)) |
| Keep tax and accounting records | Payments, account | Compliance with law (s. 7(c)/(d)) **LAWYER CHECK** | Legal obligation (Art. 6(1)(c)) |
| Improve PnL Lens (research), **only if you opt in** | Trades and reports, pseudonymised (see section 5) | Separate consent (s. 6) | Consent (Art. 6(1)(a)) |
| Answer support requests | Support messages, account | Consent / legitimate use | Contract / legitimate interests |

**Automated analysis.** Your report is produced automatically from your own trades. It describes what already happened and has no legal or similarly significant effect on you, so it is not "automated decision-making" in the GDPR Article 22 sense. **LAWYER CHECK**

## 5. Your choices at upload: consent and the research opt-in

Before your first analysis, the upload page asks you to tick:

1. **Required:** *"I agree to PnL Lens processing these files to build my report."* Without this, we cannot read your files.
2. **Optional, unticked by default:** *"Also let PnL Lens use my data, anonymised, to improve its analysis. Optional — you can change this anytime."*

**BUILT ✓:** both checkboxes and the consent record (Phases 4 and 6); research choice changeable on Dashboard → Your data (Phase 7).

**If you opt in to research:**
- We use your trades and reports to improve PnL Lens's analysis. In future this may include building and testing new features, such as statistical or machine-learning models. We will update this policy before any such use.
- Before research use, we replace your account ID with a code and remove your email, name and file names. Raw uploaded files are never used for research.
- We never sell research data or share it outside PnL Lens.
- You can switch research off at any time. Data from your account then stops being used for new research.

**LAWYER CHECK: "anonymised" vs "pseudonymised".** The approved checkbox wording says "anonymised". The planned design replaces your ID with a code (pseudonymisation). Under the GDPR, and probably the DPDP Act, pseudonymised data is still personal data. Either change the checkbox wording to "with your name and email removed" (or "pseudonymised"), or confirm that the research data set is truly anonymous.

**LAWYER CHECK:** state what happens to research results (for example, aggregate statistics or trained models) already produced before a user withdraws.

**Withdrawing consent** for processing is always possible: delete your reports or your account (section 9). Withdrawal does not affect processing that took place before it.

## 6. Where your data is stored and how we protect it

**Location.** Our servers, database and file storage run in a **DigitalOcean data centre in Bengaluru, India**. Encrypted backups are kept at **[BACKUP LOCATION — e.g. DigitalOcean Spaces, Bengaluru]**. **BUILD CHECK** (VM and backups arrive in Phase 8.)

Some of our service providers (section 8) process limited data outside India, for example email delivery and Google sign-in.
**LAWYER CHECK:**
- Confirm that DPDP s. 16 allows these transfers (no restricted countries notified as of [DATE]).
- For EU/UK users, confirm the transfer mechanism for data stored in India, which has no EU adequacy decision (for example Standard Contractual Clauses).

**Encryption.**
- **In transit:** all traffic between your browser and PnL Lens uses HTTPS.
- **Uploaded files:** each file is encrypted with its own key (AES-256-GCM) before it is stored. The storage system only ever holds the encrypted version. **BUILT ✓**
- **Backups:** encrypted. **BUILD CHECK** (restic encryption in Phase 8 `backup.sh`; true once backups run in production)
- **Database:** private network only, with separate least-privilege accounts for each part of the system.
  **BUILD CHECK:** say "stored on an encrypted disk" only if disk encryption is enabled on the production server.

**Who can access what.**
- **You:** your own reports only. Every request is checked against your account.
- **Our systems:**
  - The upload service can store files but cannot read them back.
  - Only the analysis worker can read your files, and only to build your report.
  - The worker runs on an isolated network with no internet access.
  - Every access to an uploaded file is logged. **BUILT ✓** (`file_access_log`)
- **Our staff:**
  - Staff use role-based access, checked on every request: owner, admin, support, finance, analyst.
  - Support staff can see your account details, plan and an activity timeline to help you. Finance staff see payment records.
  - **Staff have no tool to open your uploaded files or the contents of your reports.**
  - **BUILD CHECK:** keep this true as the admin console grows. If support ever needs to view a report, ask the user's permission first, and update this policy.
- **Nobody else**, except as described in section 8, or where the law requires us to disclose data (section 8, "Legal requests").

**If something goes wrong.** If a personal data breach affects you, we will tell you and the authorities as the law requires. In India, that means the Data Protection Board; for GDPR users, the competent supervisory authority, generally within 72 hours.
**LAWYER CHECK:** align with the DPDP Rules, 2025 breach-intimation timelines and their commencement dates.

## 7. How long we keep your data

| Data | How long |
|---|---|
| **Uploaded files** (raw statements) | **Deleted automatically 30 days after upload**, or sooner if you delete the report or your account. Files from an analysis you never saved are deleted after 24 hours. **BUILD CHECK** |
| **Reports and their trades** | **Until you delete the report or close your account.** Reports do not expire when your plan ends. A plan's validity only controls creating *new* reports. |
| **Account** | Until you close it. After closure we delete your reports and trades, and anonymise your account record (email, name and Google ID removed). |
| **Payment and invoice records** | **[8 years]** after the financial year of the payment, as Indian tax and accounting law requires, even if you close your account. **LAWYER CHECK** (confirm the period under the Companies Act, 2013 s. 128, the CGST Act, 2017 s. 36 and the Income-tax Act) |
| **Sign-in codes** | Deleted 7 days after they are created. **BUILT ✓** |
| **Usage and error logs** | **[12 months]**, then deleted or aggregated. **LAWYER CHECK** (BUILT ✓: automatic 12-month purge, `purge_logs`; period configurable) |
| **Audit log and file-access log** | **[24 months]**, for security and to show who accessed what. **LAWYER CHECK** (BUILT ✓: automatic 24-month purge) |
| **Consent records** | As long as your account exists, plus **[3 years]**, to prove consent was given. **LAWYER CHECK** |
| **Backups** | Deleted data can remain in encrypted backups for up to **[6 months]** until those backups expire. Backups are only used to restore the service after a failure. **LAWYER CHECK:** the owner chose 14 daily / 8 weekly / 12 monthly snapshots, so this must say **12 months**. |

**LAWYER CHECK:** DPDP s. 8(7) and the DPDP Rules require erasure once the purpose is served, and may require notice before erasure for inactive accounts. Confirm whether "keep reports until the user deletes them" needs an inactivity limit (for example, erase after [3] years without sign-in, with [48 hours'] notice).

## 8. Who we share data with

We share only what each provider needs to do its job for us. They act on our instructions (as Data Processors / GDPR processors) under their terms.
**LAWYER CHECK:** confirm that each provider's data processing terms (DPA) are accepted and adequate.

| Provider | What they do | Data they receive | Location |
|---|---|---|---|
| **DigitalOcean** | Hosts our servers, database, file storage and backups | All data we store (uploaded files only in encrypted form) | India (Bengaluru) **BUILD CHECK** |
| **Cloudflare** | Domain name service, network protection, and secure connection between your browser and our servers; tells us your country | Your IP address and the web requests you make, including what you type or upload while it travels to us | Global network **LAWYER CHECK** |
| **Razorpay** | Processes payments | Your email, amount, plan and payment details you enter on Razorpay's checkout | India |
| **Resend** | Sends our emails (sign-in codes, service messages) | Your email address and the email content | [United States — confirm region] **LAWYER CHECK** |
| **Google** (only if you choose "Continue with Google") | Signs you in | Google tells us your name, email, Google account ID and whether the email is verified. Google knows you signed in to PnL Lens. | Global |

**We do not sell or rent your personal data, and we do not share it with advertisers.**

**Legal requests.** We may disclose data where Indian law, or other law that applies to us, requires it, for example a valid order from a court or authority. Where allowed, we will tell you first.

**Business changes.** If PnL Lens is merged or sold, your data may transfer to the new owner under this policy. We will tell you before that happens. **LAWYER CHECK**

## 9. Your rights

You can exercise these rights yourself in the app where shown, or by writing to **support@pnllens.com** (or to the Grievance Officer in section 11). We may need to confirm it's you. We reply within **[30 days]** **LAWYER CHECK**.

| Right | How |
|---|---|
| **Access:** a summary of your data and how we use it, and the providers we share it with (DPDP s. 11; GDPR Art. 15) | Write to us. Your reports are always visible in your dashboard. |
| **Export / portability** (GDPR Art. 20) | Download each report's trades as CSV from the report page. A full account export is available on Dashboard → Your data → Export my data (ZIP: JSON + original statements still stored; link valid 7 days). **BUILT ✓** (Phase 7). |
| **Correction and updating** (DPDP s. 12; GDPR Art. 16) | Write to us. If a report misreads your file, delete it and re-upload a corrected file. |
| **Erasure** (DPDP s. 12; GDPR Art. 17) | Delete a report: Report page → **Delete**. Close your account: **Dashboard → Your data → Delete my account** **BUILT ✓** (Phase 7). We then delete your data as described in section 7. Payment records we must keep by law remain. |
| **Withdraw consent** (DPDP s. 6(4); GDPR Art. 7(3)) | Research: switch it off at **Dashboard → Your data** **BUILT ✓** (Phase 7). Processing: delete your reports or account. |
| **Nominate** someone to exercise your rights if you die or become incapacitated (DPDP s. 14) | Write to us with the nominee's name and email. **LAWYER CHECK** (form and verification process) |
| **Object or restrict** (GDPR Art. 18, 21) | Write to us. |
| **Grievance** (DPDP s. 13) | Contact our Grievance Officer (section 11). If you are not satisfied, you may complain to the **Data Protection Board of India**. GDPR users may complain to their local data protection authority. |

## 10. Cookies and similar technology

We use only the cookies we need to run the service. **We use no advertising cookies and no third-party analytics.**

| Cookie | Set by | Why | How long |
|---|---|---|---|
| `lens_session` | PnL Lens | Keeps you signed in (secure, not readable by scripts) | 30 days |
| Google sign-in state cookie | PnL Lens | Protects the Google sign-in step against forgery | Minutes; removed after sign-in |
| Cloudflare security cookies (for example `__cf_bm`) | Cloudflare | Tell real visitors apart from bots | Up to 30 minutes **LAWYER CHECK** |
| Razorpay checkout cookies | Razorpay | Run the payment window when you pay | Set by Razorpay **LAWYER CHECK** |

App usage events (section 3) are recorded on our servers, not through tracking cookies.
**LAWYER CHECK:** confirm whether strictly necessary cookies need a banner for EU/UK visitors (generally no for these essential cookies). **BUILD CHECK:** re-check this list against the live site before publishing.

## 11. Grievance Officer and contact

**Grievance Officer** (DPDP Act s. 8(10) and s. 13; Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021; Consumer Protection (E-Commerce) Rules, 2020)

- **[GRIEVANCE OFFICER NAME]**, [DESIGNATION]
- [COMPANY LEGAL NAME], [REGISTERED ADDRESS]
- Email: [GRIEVANCE EMAIL, e.g. grievance@pnllens.com]
- Phone: [PHONE NUMBER]

We acknowledge complaints within **[48 hours]** and resolve them within **[30 days]**.
**LAWYER CHECK:** confirm which rules apply to us and their exact timelines. Also confirm whether a named Data Protection Officer is required; it is only mandatory for Significant Data Fiduciaries.

**General privacy questions:** support@pnllens.com.

## 12. Children

PnL Lens is **only for people aged 18 and over**. We do not knowingly collect data from anyone under 18. If you believe a child has created an account, write to us and we will delete it.
**LAWYER CHECK:** the DPDP Act treats everyone under 18 as a child and requires verifiable parental consent. Confirm that a self-declared "I am 18 or older" confirmation at sign-up is enough. **BUILD CHECK:** add that confirmation to sign-up.

## 13. Changes to this policy

We may update this policy. If a change is significant, for example a new purpose or a new provider that receives your data, we will tell you by email or in the app **before it takes effect**. Where the law requires it, we will ask for your consent again. The date at the top shows the latest version. Earlier versions are available on request.

## 14. Language

This policy is written in English.
**LAWYER CHECK:** DPDP s. 5(3) requires the consent notice to be available in English or any language in the Eighth Schedule to the Constitution, at the user's choice. Confirm which languages to offer, and how.

---

*Other laws to confirm (LAWYER CHECK):*
- Interaction with the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, which treat financial information as sensitive, until DPDP fully replaces them.
- DPDP Act and DPDP Rules, 2025 commencement dates.
- Whether any US state privacy law (for example California's CCPA/CPRA) applies at our size.
