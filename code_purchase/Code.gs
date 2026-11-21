/**
 * RentFlow Source Code Checkout — Google Apps Script backend
 * Product: KSh 5,000 | KES | Single-project licence
 *
 * Script Properties required:
 * INTASEND_PUBLISHABLE_KEY = ISPubKey_test_... or ISPubKey_live_...
 * INTASEND_SECRET_KEY      = ISSecretKey_test_... or ISSecretKey_live_...
 * INTASEND_WEBHOOK_CHALLENGE = a long random secret configured identically in IntaSend
 * SPREADSHEET_ID           = Google Sheets spreadsheet ID
 * SOURCE_FILE_ID           = Google Drive ID of the RentFlow source ZIP
 * DELIVERY_FROM_NAME       = RentFlow by McOwino (optional)
 *
 * Deploy as Web app: Execute as Me; Who has access: Anyone.
 * Set the webhook URL to this deployment's /exec URL and subscribe to collection_event.
 */

const CFG = Object.freeze({
  PRODUCT: 'RentFlow Source Code',
  AMOUNT: 5000,
  CURRENCY: 'KES',
  LICENCE: 'Single-project licence',
  API_BASE: 'https://api.intasend.com/api/v1/'
});

const HEADERS = [
  'created_at', 'api_ref', 'checkout_id', 'invoice_id', 'customer_name',
  'customer_email', 'customer_phone', 'amount', 'currency', 'payment_state',
  'delivery_state', 'delivered_at', 'provider_ref', 'last_error'
];

function doGet(e) {
  return ContentService.createTextOutput('RentFlow purchase backend is online.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const contentType = String((e.postData && e.postData.type) || '').toLowerCase();

  // IntaSend sends JSON webhooks. Browser checkout form posts url-encoded fields.
  if (contentType.indexOf('application/json') !== -1) {
    return handleIntaSendWebhook_(e);
  }
  return handleCheckoutRequest_(e);
}

function handleCheckoutRequest_(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action !== 'createCheckout') throw new Error('Invalid request.');
    const name = clean_(p.customer_name, 90);
    const email = clean_(p.customer_email, 160).toLowerCase();
    const phone = normalizeKenyanPhone_(p.customer_phone);

    if (name.length < 2) throw new Error('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    if (!phone) throw new Error('Enter a valid Kenyan phone number.');

    const parts = name.trim().split(/\s+/);
    const firstName = parts.shift().slice(0, 45);
    const lastName = (parts.join(' ') || 'Customer').slice(0, 45);
    const apiRef = 'RF-' + Utilities.getUuid().replace(/-/g, '').toUpperCase();

    const payload = {
      amount: CFG.AMOUNT,
      currency: CFG.CURRENCY,
      email: email,
      first_name: firstName,
      last_name: lastName,
      phone_number: phone,
      api_ref: apiRef,
      unique_api_ref: true,
      redirect_url: ScriptApp.getService().getUrl(),
      host: ScriptApp.getService().getUrl(),
      channel: 'WEBSITE'
    };

    const response = UrlFetchApp.fetch(CFG.API_BASE + 'checkout/', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-IntaSend-Public-API-Key': requiredProp_('INTASEND_PUBLISHABLE_KEY')
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = parseApiResponse_(response);
    if (!result.url || !result.id) throw new Error('IntaSend did not return a checkout URL.');

    const sheet = ordersSheet_();
    sheet.appendRow([
      new Date(), apiRef, String(result.id), '', name, email, phone,
      CFG.AMOUNT, CFG.CURRENCY, 'PENDING', 'NOT_SENT', '', '', ''
    ]);

    return iframeResponse_({
      ok: true,
      checkoutUrl: result.url,
      apiRef: apiRef,
      message: 'Checkout created.'
    });
  } catch (err) {
    return iframeResponse_({ ok: false, message: safeMessage_(err) });
  }
}

function handleIntaSendWebhook_(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const expectedChallenge = requiredProp_('INTASEND_WEBHOOK_CHALLENGE');
    if (!constantTimeEquals_(String(body.challenge || ''), expectedChallenge)) {
      throw new Error('Webhook challenge mismatch.');
    }
    if (body.topic !== 'collection_event') throw new Error('Unsupported webhook topic.');

    const apiRef = String(body.api_ref || '');
    const invoiceId = String(body.invoice_id || '');
    if (!apiRef || !invoiceId) throw new Error('Missing payment reference.');

    const row = findOrderByApiRef_(apiRef);
    if (!row) throw new Error('Order not found.');

    // Verify from IntaSend's authenticated status endpoint, not from webhook fields alone.
    const verified = verifyInvoiceWithIntaSend_(invoiceId);
    if (String(verified.api_ref || '') !== apiRef) throw new Error('Invoice reference mismatch.');
    if (String(verified.invoice_id || '') !== invoiceId) throw new Error('Invoice ID mismatch.');
    if (String(verified.currency || '').toUpperCase() !== CFG.CURRENCY) throw new Error('Currency mismatch.');
    if (Number(verified.value) !== CFG.AMOUNT) throw new Error('Amount mismatch.');

    updateOrderPayment_(row.rowNumber, invoiceId, String(verified.state || '').toUpperCase(),
      String(verified.provider_ref || verified.mpesa_reference || ''));

    if (String(verified.state || '').toUpperCase() === 'COMPLETE') {
      deliverSourceCode_(row.rowNumber);
    }
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    console.error('Webhook error: ' + safeMessage_(err));
    // Non-200 allows provider retry where supported.
    return ContentService.createTextOutput('ERROR: ' + safeMessage_(err))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function verifyInvoiceWithIntaSend_(invoiceId) {
  const response = UrlFetchApp.fetch(CFG.API_BASE + 'payment/status/', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + requiredProp_('INTASEND_SECRET_KEY') },
    payload: JSON.stringify({ invoice_id: invoiceId }),
    muteHttpExceptions: true
  });
  const data = parseApiResponse_(response);
  const invoice = data.invoice || data;
  return invoice;
}

function deliverSourceCode_(rowNumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = ordersSheet_();
    const row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
    const deliveryState = String(row[10] || '');
    if (deliveryState === 'SENT') return;

    const email = String(row[5] || '');
    const name = String(row[4] || '');
    const file = DriveApp.getFileById(requiredProp_('SOURCE_FILE_ID'));
    const blob = file.getBlob().setName('RentFlow-Source-Code.zip');

    // Gmail attachment size/quota limits apply. For a large archive, use a private
    // Drive delivery workflow rather than attaching the ZIP.
    GmailApp.sendEmail(
      email,
      'Your RentFlow source code — payment confirmed',
      'Hello ' + name + ',\n\n' +
      'Your payment of KSh 5,000 for RentFlow Source Code has been confirmed.\n\n' +
      'Attached is your RentFlow source-code package. Your purchase includes a ' +
      CFG.LICENCE + ' for one project. It does not grant redistribution or resale rights.\n\n' +
      'Thank you for choosing RentFlow by McOwino.\n\n' +
      'McOwino',
      {
        name: PropertiesService.getScriptProperties().getProperty('DELIVERY_FROM_NAME') || 'RentFlow by McOwino',
        attachments: [blob]
      }
    );

    sheet.getRange(rowNumber, 11).setValue('SENT');
    sheet.getRange(rowNumber, 12).setValue(new Date());
    sheet.getRange(rowNumber, 14).setValue('');
  } catch (err) {
    ordersSheet_().getRange(rowNumber, 14).setValue(safeMessage_(err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function updateOrderPayment_(rowNumber, invoiceId, state, providerRef) {
  const sheet = ordersSheet_();
  sheet.getRange(rowNumber, 4).setValue(invoiceId);
  sheet.getRange(rowNumber, 10).setValue(state);
  sheet.getRange(rowNumber, 13).setValue(providerRef);
}

function findOrderByApiRef_(apiRef) {
  const sheet = ordersSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]) === apiRef) {
      return { rowNumber: i + 1, values: values[i] };
    }
  }
  return null;
}

function ordersSheet_() {
  const id = requiredProp_('SPREADSHEET_ID');
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName('Purchases');
  if (!sheet) {
    sheet = ss.insertSheet('Purchases');
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function iframeResponse_(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const html = '<!doctype html><html><body><script>' +
    'parent.postMessage(' + json + ', "*");' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function parseApiResponse_(response) {
  const code = response.getResponseCode();
  const text = response.getContentText();
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error('IntaSend returned an unreadable response.'); }
  if (code < 200 || code >= 300) {
    throw new Error((data && (data.detail || data.message || data.error)) || ('IntaSend HTTP ' + code));
  }
  return data;
}

function requiredProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Backend configuration missing: ' + key);
  return value;
}

function clean_(value, max) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function normalizeKenyanPhone_(value) {
  let phone = String(value || '').replace(/[^\d+]/g, '');
  if (phone.indexOf('+') === 0) phone = phone.slice(1);
  if (/^0[17]\d{8}$/.test(phone)) phone = '254' + phone.slice(1);
  if (/^[17]\d{8}$/.test(phone)) phone = '254' + phone;
  return /^254[17]\d{8}$/.test(phone) ? phone : '';
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function safeMessage_(err) {
  return String((err && err.message) || err || 'Unexpected error').slice(0, 240);
}

/** Run once manually after setting SPREADSHEET_ID to create the Purchases sheet. */
function setupPurchasesSheet() {
  const sheet = ordersSheet_();
  sheet.autoResizeColumns(1, HEADERS.length);
}
