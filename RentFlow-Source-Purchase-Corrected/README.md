# RentFlow Source Purchase — corrected implementation

This package corrects the browser-to-Apps-Script bridge that could leave the button stuck at “Preparing secure checkout”. It uses a hidden iframe with a per-request nonce, sends the response to the top-level page, validates the checkout host, and times out with a visible error. The backend logs the order before requesting an IntaSend checkout.

## Files
- `frontend/purchase-modal.html` — paste into your RentFlow shared footer/layout.
- `apps-script/Code.gs` — replace the existing Apps Script project code with this file.

## Configure Apps Script
1. Create a Google Sheet named `RentFlow Purchases` and copy its spreadsheet ID.
2. In Apps Script, replace the existing `Code.gs` with this package's `apps-script/Code.gs`.
3. In Project Settings → Script Properties, set:
   - `INTASEND_PUBLISHABLE_KEY` — IntaSend publishable key (`ISPubKey_test_...` for sandbox).
   - `INTASEND_SECRET_KEY` — matching secret key (`ISSecretKey_test_...` for sandbox).
   - `INTASEND_WEBHOOK_CHALLENGE` — a long random string.
   - `SPREADSHEET_ID` — Google Sheet ID.
   - `SOURCE_FILE_ID` — private Google Drive ID of the RentFlow ZIP.
   - `DELIVERY_FROM_NAME` — optional, `RentFlow by McOwino`.
4. Run `setupPurchasesSheet()` once from the Apps Script editor and authorize access.
5. Deploy → Manage deployments → Edit (pencil) → select **New version** → Deploy. Execute as **Me**; access **Anyone**. Copy the deployed URL ending in `/exec`. Do not use `/dev`.
6. Open the deployed `/exec` URL in a browser. It should display `RentFlow purchase backend is online.`

## Configure frontend
1. Open `frontend/purchase-modal.html`.
2. Replace `PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE` with the actual deployed `/exec` URL. The corrected file has one URL setting only.
3. Paste the complete file into the RentFlow footer/layout and deploy the website.
4. Open the website, click Purchase Source Code, and submit a test buyer. If the server is reached, a row will appear in `Purchases`; the page will then redirect to IntaSend.

## Webhook
In IntaSend → Settings → Webhooks, configure the same deployed `/exec` URL, the exact same challenge string as `INTASEND_WEBHOOK_CHALLENGE`, and `collection_event`. Use matching sandbox keys and sandbox checkout for testing.

## Important safety checks
- Never put the secret key in frontend code. The publishable key and secret key must belong to the same environment.
- The backend confirms the invoice through IntaSend's payment-status API and checks `COMPLETE`, amount, currency, invoice ID and `api_ref` before emailing the ZIP. A return/redirect alone is not proof of payment.
- Keep the ZIP private in Drive. Check Gmail attachment limits and sending quotas.
- The package does not include the actual RentFlow source ZIP; upload your own archive and set `SOURCE_FILE_ID`.
- The backend is not deployed or connected to your account by this package.

## If the request still does not reach Apps Script
Confirm the frontend contains the correct `/exec` URL, the latest Apps Script deployment is active, and access is set to **Anyone**. Then submit once and check Apps Script → Executions. A row in `Purchases` means the request reached the backend; if there is no row and no execution, the live page is still using an old/wrong frontend URL or cached code.

## API documentation
- IntaSend checkout: https://developers.intasend.com/guides/collections/checkout/
- IntaSend webhooks: https://developers.intasend.com/guides/webhooks/
- IntaSend payment status: https://developers.intasend.com/guides/collections/overview/
