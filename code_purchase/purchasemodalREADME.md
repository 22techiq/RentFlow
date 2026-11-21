# RentFlow Source Code Purchase — Setup Guide

## What is included
- `apps-script/Code.gs`: Apps Script backend for fixed KSh 5,000 IntaSend checkout, webhook validation, server-side invoice verification, Google Sheets order logging and email delivery.
- `frontend/purchase-modal.html`: Footer link and responsive purchase modal for a GitHub Pages/Vercel frontend.

## Important: source archive is not included
This package implements the sales and delivery workflow. It does not contain the private RentFlow application source code because that archive has not been provided. Upload your final RentFlow ZIP to Google Drive and configure its file ID as `SOURCE_FILE_ID`.

## 1. Create the Google Sheet
1. Create a Google Spreadsheet named `RentFlow Purchases`.
2. Copy its spreadsheet ID from its URL.
3. Open Extensions → Apps Script.
4. Paste `apps-script/Code.gs` into `Code.gs`.

## 2. Configure Script Properties
In Apps Script: Project Settings → Script Properties. Add:

| Property | Value |
|---|---|
| `INTASEND_PUBLISHABLE_KEY` | Your IntaSend publishable key |
| `INTASEND_SECRET_KEY` | Your IntaSend secret key |
| `INTASEND_WEBHOOK_CHALLENGE` | A long random secret value |
| `SPREADSHEET_ID` | Spreadsheet ID |
| `SOURCE_FILE_ID` | Google Drive file ID of your RentFlow ZIP |
| `DELIVERY_FROM_NAME` | `RentFlow by McOwino` (optional) |

Keep all secret keys in Script Properties. Never put the secret key in frontend HTML or JavaScript.

## 3. Upload the source archive
1. Create the final source ZIP.
2. Upload it to a private Google Drive folder.
3. Copy its file ID from the Drive URL.
4. Set `SOURCE_FILE_ID` in Script Properties.
5. Do not make the ZIP publicly accessible. Apps Script reads it as the script owner and attaches it to the buyer email.

The attachment must fit Gmail's message-size limits and your account's sending quotas. For a large ZIP, replace attachment delivery with a private, expiring download service.

## 4. Deploy Apps Script
1. Run `setupPurchasesSheet()` once and authorize Sheets, Drive, external requests and Gmail permissions.
2. Deploy → New deployment → Web app.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Deploy and copy the `/exec` URL.
6. Do not use the `/dev` test URL in production.

## 5. Configure IntaSend webhook
In IntaSend dashboard → Settings → Webhooks:
- Endpoint: your deployed Apps Script `/exec` URL.
- Challenge: exactly the same value as `INTASEND_WEBHOOK_CHALLENGE`.
- Event: `collection_event`.

Use sandbox keys and a sandbox webhook for testing first. Switch to live keys only after successful end-to-end tests.

## 6. Add the frontend modal
1. Open `frontend/purchase-modal.html`.
2. Replace both occurrences of `APPS_SCRIPT_WEB_APP_URL` with your deployed Apps Script `/exec` URL.
3. Paste the link, modal markup, CSS and JavaScript into the shared footer/layout of RentFlow.
4. Deploy the frontend to GitHub Pages or Vercel.

## 7. Payment and delivery rules
- Product amount is fixed on the server at KES 5,000; the browser cannot choose the amount.
- Each checkout receives a unique `api_ref`.
- IntaSend webhook challenge is checked.
- Backend then calls IntaSend `POST /payment/status/` using the secret key.
- The invoice must match the stored `api_ref`, invoice ID, KES currency, KES 5,000 amount and `COMPLETE` state.
- Only then is the source ZIP attached to the buyer email.
- A lock and delivery-state column prevent duplicate email delivery from repeated webhook notifications.
- A redirect to the checkout return URL does not prove payment.

## 8. Test checklist
- Test invalid name/email/phone.
- Test a pending checkout: no email should be sent.
- Test a failed/cancelled payment: no email should be sent.
- Test a completed KES 5,000 payment: one email with ZIP attachment should be sent.
- Replay the same webhook: no duplicate email should be sent.
- Confirm a mismatched amount, currency or api_ref is rejected.
- Verify the purchase row in the `Purchases` sheet.

## 9. Single-project licence
The buyer email states that the purchase is licensed for one project. It does not grant redistribution or resale rights. Publish your full licence terms on your website before accepting payment if you need additional restrictions.

## API references
- IntaSend checkout: https://developers.intasend.com/guides/collections/checkout/
- IntaSend webhooks: https://developers.intasend.com/guides/webhooks/
- Payment status: https://developers.intasend.com/guides/collections/overview/

## Production notes
- The webhook challenge is a shared secret; keep it private and rotate it if exposed.
- Restrict Apps Script editor access to trusted administrators.
- Monitor Apps Script execution failures and Gmail quotas.
- The implementation intentionally fails closed: if the status API, source file, or email delivery fails, the order remains undelivered and the error is recorded.
- This starter does not create a refund workflow, customer portal, or automated retry scheduler for failed email delivery. Add an admin reconciliation/retry process before high-volume production.
