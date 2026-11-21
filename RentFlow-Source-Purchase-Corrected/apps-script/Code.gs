/** RentFlow source purchase backend — corrected version.
 * Required Script Properties:
 * INTASEND_PUBLISHABLE_KEY, INTASEND_SECRET_KEY, INTASEND_WEBHOOK_CHALLENGE,
 * SPREADSHEET_ID, SOURCE_FILE_ID; optional DELIVERY_FROM_NAME.
 * Deploy as Web app: Execute as Me; access Anyone. Use /exec URL.
 */
const CFG={PRODUCT:'RentFlow Source Code',AMOUNT:5000,CURRENCY:'KES',LICENCE:'Single-project licence',API_BASE:'https://api.intasend.com/api/v1/'};
const HEADERS=['created_at','api_ref','checkout_id','invoice_id','customer_name','customer_email','customer_phone','amount','currency','payment_state','delivery_state','delivered_at','provider_ref','last_error'];
function doGet(){return ContentService.createTextOutput('RentFlow purchase backend is online.');}
function doPost(e){
  const type=String((e&&e.postData&&e.postData.type)||'').toLowerCase();
  if(type.indexOf('application/json')!==-1)return handleWebhook_(e);
  return handleCheckout_(e);
}
function handleCheckout_(e){
  let nonce='';
  try{
    const p=(e&&e.parameter)||{};nonce=String(p.request_nonce||'').slice(0,120);
    if(p.action!=='createCheckout')throw new Error('Invalid purchase request.');
    if(!nonce)throw new Error('The request token is missing. Refresh the page and try again.');
    const name=clean_(p.customer_name,90),email=clean_(p.customer_email,160).toLowerCase(),phone=normalizePhone_(p.customer_phone);
    if(name.length<2)throw new Error('Enter your full name.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address.');
    if(!phone)throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678.');
    const apiRef='RF-'+Utilities.getUuid().replace(/-/g,'').toUpperCase();
    const sheet=ordersSheet_();
    const row=sheet.getLastRow()+1;
    sheet.appendRow([new Date(),apiRef,'','',name,email,phone,CFG.AMOUNT,CFG.CURRENCY,'CREATING','NOT_SENT','','','']);
    const parts=name.split(/\s+/),firstName=parts.shift().slice(0,45),lastName=(parts.join(' ')||'Customer').slice(0,45);
    const payload={amount:CFG.AMOUNT,currency:CFG.CURRENCY,email:email,first_name:firstName,last_name:lastName,phone_number:phone,api_ref:apiRef,redirect_url:ScriptApp.getService().getUrl()};
    const response=UrlFetchApp.fetch(CFG.API_BASE+'checkout/',{method:'post',contentType:'application/json',headers:{'X-IntaSend-Public-API-Key':requiredProp_('INTASEND_PUBLISHABLE_KEY')},payload:JSON.stringify(payload),muteHttpExceptions:true});
    const result=parseApi_(response);
    if(!result.url||!result.id)throw new Error('IntaSend did not return a checkout URL.');
    const checkoutUrl=String(result.url),parsed=checkoutUrl.match(/^https:\/\/([a-z0-9.-]+)\//i);
    if(!parsed||!/(^|\.)intasend\.com$/i.test(parsed[1]))throw new Error('IntaSend returned an untrusted checkout URL.');
    sheet.getRange(row,3).setValue(String(result.id));sheet.getRange(row,10).setValue('PENDING');
    return bridgeResponse_({rfPurchaseBridge:true,nonce:nonce,ok:true,checkoutUrl:checkoutUrl,message:'Checkout created.'});
  }catch(err){
    console.error('Checkout error: '+safe_(err));
    return bridgeResponse_({rfPurchaseBridge:true,nonce:nonce,ok:false,message:safe_(err)});
  }
}
function handleWebhook_(e){
  try{
    const body=JSON.parse((e.postData&&e.postData.contents)||'{}');
    if(!constantTimeEquals_(String(body.challenge||''),requiredProp_('INTASEND_WEBHOOK_CHALLENGE')))throw new Error('Webhook challenge mismatch.');
    if(body.topic!=='collection_event')throw new Error('Unsupported webhook topic.');
    const apiRef=String(body.api_ref||''),invoiceId=String(body.invoice_id||'');if(!apiRef||!invoiceId)throw new Error('Missing invoice reference.');
    const order=findOrder_(apiRef);if(!order)throw new Error('Order not found.');
    const invoice=verifyInvoice_(invoiceId);
    if(String(invoice.api_ref||'')!==apiRef)throw new Error('Invoice reference mismatch.');
    if(String(invoice.invoice_id||'')!==invoiceId)throw new Error('Invoice ID mismatch.');
    if(String(invoice.currency||'').toUpperCase()!==CFG.CURRENCY)throw new Error('Currency mismatch.');
    if(Math.round(Number(invoice.value)*100)!==CFG.AMOUNT*100)throw new Error('Amount mismatch.');
    const state=String(invoice.state||'').toUpperCase();
    updatePayment_(order.rowNumber,invoiceId,state,String(invoice.provider_ref||invoice.mpesa_reference||''));
    if(state==='COMPLETE')deliver_(order.rowNumber);
    return ContentService.createTextOutput('OK');
  }catch(err){console.error('Webhook error: '+safe_(err));return ContentService.createTextOutput('ERROR: '+safe_(err));}
}
function verifyInvoice_(invoiceId){
  const r=UrlFetchApp.fetch(CFG.API_BASE+'payment/status/',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+requiredProp_('INTASEND_SECRET_KEY')},payload:JSON.stringify({invoice_id:invoiceId}),muteHttpExceptions:true});
  const data=parseApi_(r);return data.invoice||data;
}
function deliver_(rowNumber){
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const sheet=ordersSheet_(),row=sheet.getRange(rowNumber,1,1,HEADERS.length).getValues()[0];
    if(String(row[10])==='SENT')return;
    const file=DriveApp.getFileById(requiredProp_('SOURCE_FILE_ID'));
    GmailApp.sendEmail(String(row[5]),'Your RentFlow source code — payment confirmed',
      'Hello '+String(row[4])+',\n\nYour KSh 5,000 payment has been confirmed. Your RentFlow source-code ZIP is attached. The purchase includes a '+CFG.LICENCE+' and does not permit redistribution or resale.\n\nThank you,\nRentFlow by McOwino',
      {name:PropertiesService.getScriptProperties().getProperty('DELIVERY_FROM_NAME')||'RentFlow by McOwino',attachments:[file.getBlob().setName('RentFlow-Source-Code.zip')]});
    sheet.getRange(rowNumber,11).setValue('SENT');sheet.getRange(rowNumber,12).setValue(new Date());sheet.getRange(rowNumber,14).setValue('');
  }catch(err){ordersSheet_().getRange(rowNumber,14).setValue(safe_(err));throw err;}finally{lock.releaseLock();}
}
function bridgeResponse_(obj){
  const json=JSON.stringify(obj).replace(/</g,'\\u003c');
  const html='<!doctype html><html><head><meta charset="utf-8"></head><body><script>try{window.top.postMessage('+json+',"*");}catch(e){parent.postMessage('+json+',"*");}</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function updatePayment_(row,id,state,ref){const s=ordersSheet_();s.getRange(row,4).setValue(id);s.getRange(row,10).setValue(state);s.getRange(row,13).setValue(ref);}
function findOrder_(ref){const v=ordersSheet_().getDataRange().getValues();for(let i=1;i<v.length;i++)if(String(v[i][1])===ref)return{rowNumber:i+1,values:v[i]};return null;}
function ordersSheet_(){const ss=SpreadsheetApp.openById(requiredProp_('SPREADSHEET_ID'));let s=ss.getSheetByName('Purchases');if(!s){s=ss.insertSheet('Purchases');s.appendRow(HEADERS);s.setFrozenRows(1);}else if(s.getLastRow()===0)s.appendRow(HEADERS);return s;}
function parseApi_(r){const code=r.getResponseCode(),txt=r.getContentText();let data;try{data=JSON.parse(txt);}catch(_){throw new Error('IntaSend returned an unreadable response (HTTP '+code+').');}if(code<200||code>=300)throw new Error(String(data.detail||data.message||data.error||'IntaSend HTTP '+code));return data;}
function requiredProp_(k){const v=PropertiesService.getScriptProperties().getProperty(k);if(!v)throw new Error('Backend configuration missing: '+k);return v;}
function clean_(v,n){return String(v||'').replace(/[<>]/g,'').trim().slice(0,n);}
function normalizePhone_(v){let p=String(v||'').replace(/[^\d+]/g,'');if(p[0]==='+')p=p.slice(1);if(/^0[17]\d{8}$/.test(p))p='254'+p.slice(1);if(/^[17]\d{8}$/.test(p))p='254'+p;return /^254[17]\d{8}$/.test(p)?p:'';}
function constantTimeEquals_(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function safe_(e){return String((e&&e.message)||e||'Unexpected error').slice(0,240);}
function setupPurchasesSheet(){const s=ordersSheet_();s.autoResizeColumns(1,HEADERS.length);}
