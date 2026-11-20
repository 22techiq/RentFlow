# RentFlow by McOwino
Multi-landlord property, tenant and rent management starter built with GitHub Pages/Vercel + Google Apps Script + Google Sheets.

## Included
- Landlord signup/login and tenant login
- Tenant-scoped records (server-side tenantId filtering)
- Properties, units, tenants, leases, monthly rent ledger, payments, expenses, maintenance
- Tenant rent statement and payment initiation
- IntaSend hosted checkout (M-Pesa + cards) and direct M-Pesa STK Push
- Webhook challenge validation, invoice status confirmation, idempotent payment recording, audit logs
- Responsive frontend

## 1. Create the Google Sheets database
1. Open `apps-script/Code.gs` in a new Google Apps Script project.
2. Save, select `setup` from the function list and click **Run**. Authorize the script.
3. The setup function creates a Google Spreadsheet and all required tabs. Copy the spreadsheet ID from the execution log or Apps Script Properties (`RF_SPREADSHEET_ID`).

## 2. Configure Script Properties
In Apps Script → Project Settings → Script Properties, add:
- `RF_SPREADSHEET_ID` = spreadsheet ID created by setup
- `INTASEND_SECRET_KEY` = IntaSend secret key (start with sandbox/test)
- `INTASEND_WEBHOOK_CHALLENGE` = a long random secret string you create
- `FRONTEND_URL` = your deployed frontend URL, e.g. `https://your-site.vercel.app/`

Never put the IntaSend secret key in frontend files, GitHub, or Vercel environment variables exposed to browser code.

## 3. Deploy Apps Script
1. Deploy → New deployment → Web app.
2. Execute as: **Me**.
3. Who has access: **Anyone** (the API uses application authentication; webhook must be reachable).
4. Deploy and copy the `/exec` URL.
5. In `frontend/app.js`, replace `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` with the deployed URL.
6. Deploy the `frontend` folder to GitHub Pages or Vercel.

After changing Apps Script code, create a new deployment version (Manage deployments → Edit → New version).

## 4. Configure IntaSend
1. Create an IntaSend sandbox account and obtain sandbox secret keys.
2. Set `INTASEND_SECRET_KEY` to the sandbox secret key.
3. In IntaSend dashboard → Settings → Webhooks, add the Apps Script web app URL as the endpoint and set the Challenge to exactly the value in `INTASEND_WEBHOOK_CHALLENGE`.
4. Subscribe to `collection_event`.
5. Test hosted checkout for M-Pesa and card (methods depend on your IntaSend account/currency settings), and test direct M-Pesa STK.
6. Verify payment status in IntaSend dashboard and RentFlow before moving to live credentials.

## 5. First use
- Open the site and choose **Create landlord account**. This creates a private landlord workspace.
- Add a property, then units.
- Register a tenant against a vacant unit and set a temporary password. Share the tenant portal URL and credentials securely; ask the tenant to change the password in the next release (password-change UI is not yet included).
- Generate monthly rent charges from Rent & Payments.
- Tenants sign in using the email and temporary password, view their statement and pay.

## Data model
Users, Properties, Units, Tenants, Leases, RentLedger, Payments, Maintenance, Expenses, AuditLogs, Sessions, WebhookEvents.

## Important production hardening before real-money launch
This is a functional implementation foundation, not a certified financial or tenancy platform. Before production:
- Replace the simple SHA-256 password hashing with a password KDF such as PBKDF2 (Web Crypto/Cloud service) or a managed identity provider; enforce password changes, reset flow, login throttling and MFA for landlords.
- Add tenant invitations/password reset, staff roles, lease/document uploads, PDF receipts/statements, email/SMS notifications, automatic monthly billing trigger, pagination, export and reporting.
- Add strict per-action schemas, CSRF/origin controls, request size limits, rate limits and security monitoring. Apps Script web apps have deployment and quota constraints; consider Cloud Run/Firestore or a proper transactional database as tenant/transaction volume grows.
- Add concurrency-safe ledger allocation and a reconciliation queue. Apps Script Sheets is not a transactional ledger; use a database with atomic transactions for high-volume financial use.
- Validate webhook challenge against IntaSend's current webhook contract and always confirm invoice state server-side. Never treat browser redirects as proof of payment.
- Test duplicate/out-of-order webhook delivery, partial payments, refunds/reversals, overpayment, chargebacks, failed payments and tenant move-out.
- Do not store full card data. IntaSend-hosted checkout handles card entry.
- Add terms, privacy notice, data retention, backups and Kenya Data Protection Act compliance processes.

## API notes
The payment integration follows IntaSend's current documented API patterns:
- Hosted checkout: `POST https://api.intasend.com/api/v1/checkout/`
- M-Pesa STK: `POST https://api.intasend.com/api/v1/payment/mpesa-stk-push/`
- Status check: `POST https://api.intasend.com/api/v1/payment/status/`
- Webhook topic: `collection_event`; verify the configured challenge and confirm the invoice state.

Official docs: https://developers.intasend.com/getting-started/ · https://developers.intasend.com/guides/collections/checkout/ · https://developers.intasend.com/guides/webhooks/
