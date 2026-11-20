/** RentFlow by McOwino — Google Apps Script API
 * Deploy as Web App: Execute as Me; access Anyone (webhook + API). Protect with app-level auth.
 * Set Script Properties before deployment; see README.md.
 */
const RF = {
  SHEETS: {
    Users:['id','tenantId','name','email','phone','passwordHash','salt','role','status','createdAt'],
    Properties:['id','tenantId','name','address','type','manager','createdAt'],
    Units:['id','tenantId','propertyId','unitNo','rent','status','createdAt'],
    Tenants:['id','tenantId','name','email','phone','nationalId','unitId','deposit','leaseStart','leaseEnd','status','createdAt'],
    Leases:['id','tenantId','tenantRecordId','unitId','startDate','endDate','rent','deposit','status','createdAt'],
    RentLedger:['id','tenantId','tenantRecordId','unitId','period','dueDate','charge','paid','balance','status','createdAt'],
    Payments:['id','tenantId','tenantRecordId','ledgerId','amount','method','provider','invoiceId','reference','status','paidAt','createdAt'],
    Maintenance:['id','tenantId','tenantRecordId','unitId','subject','description','status','createdAt','updatedAt'],
    Expenses:['id','tenantId','propertyId','category','description','amount','expenseDate','createdAt'],
    AuditLogs:['id','tenantId','actorId','action','entity','entityId','details','createdAt'],
    Sessions:['tokenHash','userId','tenantId','role','expiresAt','createdAt'],
    WebhookEvents:['id','invoiceId','state','receivedAt']
  },
  TOKEN_HOURS: 12
};
function setup(){ return setup_(); }
function doGet(e){ return json_({ok:true,app:'RentFlow API',version:'1.0.0',message:'API online'}); }
function doPost(e){
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.topic) return json_(handleWebhook_(body));
    const result = route_(body);
    return json_({ok:true,data:result});
  } catch(err){ return json_({ok:false,error:err.message || 'Request failed'}); }
}
function route_(b){
  switch(b.action){
    case 'signup': return signup_(b);
    case 'login': return login_(b);
    case 'logout': return logout_(b);
    case 'me': return me_(b.token);
    case 'dashboard': return dashboard_(b.token);
    case 'list': return list_(b.token,b.entity);
    case 'createProperty': return createProperty_(b);
    case 'createUnit': return createUnit_(b);
    case 'createTenant': return createTenant_(b);
    case 'createRent': return createRent_(b);
    case 'recordManualPayment': return recordManualPayment_(b);
    case 'createCheckout': return createCheckout_(b);
    case 'createStk': return createStk_(b);
    case 'createMaintenance': return createMaintenance_(b);
    case 'updateMaintenance': return updateMaintenance_(b);
    case 'createExpense': return createExpense_(b);
    case 'tenantStatement': return tenantStatement_(b);
    case 'verifyPayment': return verifyPayment_(b);
    default: throw new Error('Unknown action');
  }
}
function setup_(){
  const p=PropertiesService.getScriptProperties();
  let id=p.getProperty('RF_SPREADSHEET_ID');
  let ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.create('RentFlow Database');
  p.setProperty('RF_SPREADSHEET_ID',ss.getId());
  Object.keys(RF.SHEETS).forEach(n=>{let s=ss.getSheetByName(n)||ss.insertSheet(n);let h=RF.SHEETS[n];if(s.getLastRow()===0)s.appendRow(h);});
  const sh=ss.getSheetByName('Sheet1');if(sh && ss.getSheets().length>1)ss.deleteSheet(sh);
  return {spreadsheetId:ss.getId(),url:ss.getUrl(),sheets:Object.keys(RF.SHEETS)};
}
function signup_(b){
  const email=normEmail_(b.email), name=String(b.name||'').trim(), pass=String(b.password||'');
  if(!name||!email||pass.length<10)throw new Error('Enter your name, valid email and password (at least 10 characters).');
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    if(find_('Users','email',email).length)throw new Error('An account with this email already exists.');
    const tenantId=uid_(), salt=Utilities.getUuid(), hash=hash_(pass,salt), userId=uid_();
    add_('Users',{id:userId,tenantId,name,email,phone:String(b.phone||''),passwordHash:hash,salt,role:'LANDLORD',status:'ACTIVE',createdAt:now_()});
    audit_(tenantId,userId,'ACCOUNT_CREATED','User',userId,{role:'LANDLORD'});
    return session_(userId,tenantId,name,email,'LANDLORD');
  }finally{lock.releaseLock();}
}
function login_(b){
  const email=normEmail_(b.email), rows=find_('Users','email',email);if(!rows.length)throw new Error('Invalid email or password.');
  const u=rows[0];if(u.status!=='ACTIVE'||hash_(String(b.password||''),u.salt)!==u.passwordHash)throw new Error('Invalid email or password.');
  return session_(u.id,u.tenantId,u.name,u.email,u.role);
}
function session_(id,tenantId,name,email,role){
  const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  add_('Sessions',{tokenHash:hash_(token,'RF_SESSION'),userId:id,tenantId,role,expiresAt:Date.now()+RF.TOKEN_HOURS*3600000,createdAt:now_()});
  return {token,user:{id,tenantId,name,email,role}};
}
function auth_(token){
  if(!token)throw new Error('Please sign in.');const h=hash_(String(token),'RF_SESSION');
  const s=find_('Sessions','tokenHash',h)[0];if(!s||Number(s.expiresAt)<Date.now())throw new Error('Session expired. Please sign in again.');
  const u=find_('Users','id',s.userId)[0];if(!u||u.status!=='ACTIVE')throw new Error('Account unavailable.');
  return {id:u.id,tenantId:u.tenantId,name:u.name,email:u.email,role:u.role};
}
function me_(t){const u=auth_(t);return {user:u};}
function logout_(b){const u=auth_(b.token);const h=hash_(String(b.token),'RF_SESSION');remove_('Sessions','tokenHash',h);return {loggedOut:true};}
function requireLandlord_(u){if(!['LANDLORD','MANAGER'].includes(u.role))throw new Error('Permission denied.');}
function dashboard_(token){
  const u=auth_(token), tid=u.tenantId;
  if(u.role==='TENANT'){const t=tenantForUser_(u),unit=getOwned_('Units',t.unitId,tid),ledger=rows_('RentLedger',tid).filter(x=>x.tenantRecordId===t.id),payments=rows_('Payments',tid).filter(x=>x.tenantRecordId===t.id);return {properties:0,units:1,occupied:1,vacant:0,tenants:1,expected:ledger.reduce((a,x)=>a+num_(x.charge),0),collected:payments.filter(x=>x.status==='PAID').reduce((a,x)=>a+num_(x.amount),0),arrears:ledger.reduce((a,x)=>a+num_(x.balance),0),collectionRate:0,recentPayments:payments.slice(-8).reverse(),unit};}
  const props=rows_('Properties',tid),units=rows_('Units',tid),tenants=rows_('Tenants',tid),ledger=rows_('RentLedger',tid),payments=rows_('Payments',tid);
  const month=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM');
  const expected=ledger.filter(x=>String(x.period)===month).reduce((a,x)=>a+num_(x.charge),0);
  const collected=payments.filter(x=>String(x.paidAt||'').slice(0,7)===month&&x.status==='PAID').reduce((a,x)=>a+num_(x.amount),0);
  const arrears=ledger.reduce((a,x)=>a+Math.max(0,num_(x.balance)),0);
  return {properties:props.length,units:units.length,occupied:units.filter(x=>x.status==='OCCUPIED').length,vacant:units.filter(x=>x.status==='VACANT').length,tenants:tenants.filter(x=>x.status==='ACTIVE').length,expected,collected,arrears,collectionRate:expected?Math.round(collected/expected*100):0,recentPayments:payments.slice(-8).reverse()};
}
function list_(token,entity){const u=auth_(token);const map={properties:'Properties',units:'Units',tenants:'Tenants',ledger:'RentLedger',payments:'Payments',maintenance:'Maintenance',expenses:'Expenses',leases:'Leases'};const s=map[String(entity||'').toLowerCase()];if(!s)throw new Error('Invalid list type.');let data=rows_(s,u.tenantId);if(u.role==='TENANT'){const t=find_('Tenants','email',u.email).find(x=>x.tenantId===u.tenantId);if(!t)throw new Error('Tenant profile not found.');data=data.filter(x=>x.tenantRecordId===t.id||x.id===t.id||x.unitId===t.unitId);}return data;}
function createProperty_(b){const u=auth_(b.token);requireLandlord_(u);const name=String(b.name||'').trim();if(!name)throw new Error('Property name is required.');const x={id:uid_(),tenantId:u.tenantId,name,address:String(b.address||''),type:String(b.type||'Residential'),manager:String(b.manager||''),createdAt:now_()};add_('Properties',x);audit_(u.tenantId,u.id,'PROPERTY_CREATED','Property',x.id,x);return x;}
function createUnit_(b){const u=auth_(b.token);requireLandlord_(u);const p=getOwned_('Properties',b.propertyId,u.tenantId);if(!p)throw new Error('Property not found.');const rent=num_(b.rent);if(rent<=0)throw new Error('Rent must be greater than zero.');const x={id:uid_(),tenantId:u.tenantId,propertyId:p.id,unitNo:String(b.unitNo||'').trim(),rent,status:'VACANT',createdAt:now_()};if(!x.unitNo)throw new Error('Unit number is required.');add_('Units',x);audit_(u.tenantId,u.id,'UNIT_CREATED','Unit',x.id,x);return x;}
function createTenant_(b){const u=auth_(b.token);requireLandlord_(u);const unit=getOwned_('Units',b.unitId,u.tenantId);if(!unit||unit.status!=='VACANT')throw new Error('Unit is unavailable.');const email=normEmail_(b.email);if(!email)throw new Error('Tenant email is required for portal access.');if(find_('Users','email',email).length)throw new Error('This email already has a user account.');const pass=String(b.password||'');if(pass.length<10)throw new Error('Set a temporary password of at least 10 characters.');const x={id:uid_(),tenantId:u.tenantId,name:String(b.name||'').trim(),email,phone:String(b.phone||''),nationalId:String(b.nationalId||''),unitId:unit.id,deposit:num_(b.deposit),leaseStart:String(b.leaseStart||''),leaseEnd:String(b.leaseEnd||''),status:'ACTIVE',createdAt:now_()};if(!x.name)throw new Error('Tenant name is required.');add_('Tenants',x);const salt=Utilities.getUuid();add_('Users',{id:uid_(),tenantId:u.tenantId,name:x.name,email,phone:x.phone,passwordHash:hash_(pass,salt),salt,role:'TENANT',status:'ACTIVE',createdAt:now_()});unit.status='OCCUPIED';update_('Units',unit.id,unit);add_('Leases',{id:uid_(),tenantId:u.tenantId,tenantRecordId:x.id,unitId:unit.id,startDate:x.leaseStart,endDate:x.leaseEnd,rent:num_(unit.rent),deposit:x.deposit,status:'ACTIVE',createdAt:now_()});audit_(u.tenantId,u.id,'TENANT_CREATED','Tenant',x.id,{unitId:unit.id});return x;}
function createRent_(b){const u=auth_(b.token);requireLandlord_(u);const t=getOwned_('Tenants',b.tenantId,u.tenantId);if(!t)throw new Error('Tenant not found.');const period=String(b.period||'');if(!/^\d{4}-\d{2}$/.test(period))throw new Error('Period must be YYYY-MM.');if(find_('RentLedger','id',period+'_'+t.id).length)throw new Error('Rent for this tenant and period already exists.');const unit=getOwned_('Units',t.unitId,u.tenantId);const charge=num_(b.charge||unit.rent);if(charge<=0)throw new Error('Rent charge must be positive.');const dueDate=String(b.dueDate||period+'-05');const x={id:period+'_'+t.id,tenantId:u.tenantId,tenantRecordId:t.id,unitId:t.unitId,period,dueDate,charge,paid:0,balance:charge,status:'UNPAID',createdAt:now_()};add_('RentLedger',x);audit_(u.tenantId,u.id,'RENT_CHARGED','RentLedger',x.id,x);return x;}
function recordManualPayment_(b){const u=auth_(b.token);requireLandlord_(u);const l=getOwned_('RentLedger',b.ledgerId,u.tenantId);if(!l)throw new Error('Rent record not found.');const amount=num_(b.amount);if(amount<=0||amount>num_(l.balance))throw new Error('Enter a valid amount not exceeding the balance.');const x={id:uid_(),tenantId:u.tenantId,tenantRecordId:l.tenantRecordId,ledgerId:l.id,amount,method:'MANUAL',provider:'MANUAL',invoiceId:'',reference:String(b.reference||''),status:'PAID',paidAt:now_(),createdAt:now_()};if(!x.reference)throw new Error('Payment reference is required.');add_('Payments',x);allocate_(l,amount);audit_(u.tenantId,u.id,'MANUAL_PAYMENT_RECORDED','Payment',x.id,{ledgerId:l.id,amount,reference:x.reference});return x;}
function createCheckout_(b){const u=auth_(b.token),t=tenantForUser_(u);const l=getOwned_('RentLedger',b.ledgerId,u.tenantId);if(!l||l.tenantRecordId!==t.id)throw new Error('Rent item not found.');const amount=num_(b.amount||l.balance);if(amount<=0||amount>num_(l.balance))throw new Error('Invalid payment amount.');const key=prop_('INTASEND_SECRET_KEY');if(!key)throw new Error('IntaSend is not configured.');const ref='RF_'+uid_();const payload={amount,currency:'KES',email:u.email,first_name:t.name.split(' ')[0],last_name:t.name.split(' ').slice(1).join(' ')||'Tenant',phone_number:t.phone,api_ref:ref,unique_api_ref:true,redirect_url:prop_('FRONTEND_URL')+'?payment=return'};const res=inta_('/checkout/',payload,key);const invoice=res.invoice_id||res.id;if(!res.url||!invoice)throw new Error('IntaSend did not return a checkout URL and invoice ID.');add_('Payments',{id:uid_(),tenantId:u.tenantId,tenantRecordId:t.id,ledgerId:l.id,amount,method:'CHECKOUT',provider:'INTASEND',invoiceId:invoice,reference:ref,status:'PENDING',paidAt:'',createdAt:now_()});return {url:res.url,invoiceId:invoice};}
function createStk_(b){const u=auth_(b.token),t=tenantForUser_(u);const l=getOwned_('RentLedger',b.ledgerId,u.tenantId);if(!l||l.tenantRecordId!==t.id)throw new Error('Rent item not found.');const amount=num_(b.amount||l.balance);if(amount<=0||amount>num_(l.balance))throw new Error('Invalid payment amount.');const phone=phone_(b.phone||t.phone);const key=prop_('INTASEND_SECRET_KEY');if(!key)throw new Error('IntaSend is not configured.');const ref='RF_'+uid_();const res=inta_('/payment/mpesa-stk-push/',{amount,phone_number:phone,api_ref:ref},key);const invoice=res.invoice_id||res.id;if(!invoice)throw new Error('IntaSend did not return an invoice ID.');add_('Payments',{id:uid_(),tenantId:u.tenantId,tenantRecordId:t.id,ledgerId:l.id,amount,method:'MPESA_STK',provider:'INTASEND',invoiceId:invoice,reference:ref,status:'PENDING',paidAt:'',createdAt:now_()});return {invoiceId:invoice,message:'STK request sent. Complete the prompt on your phone.'};}
function verifyPayment_(b){const u=auth_(b.token),t=tenantForUser_(u);const p=rows_('Payments',u.tenantId).find(x=>x.invoiceId===String(b.invoiceId)&&x.tenantRecordId===t.id);if(!p)throw new Error('Payment not found.');const state=fetchInvoiceState_(p.invoiceId);if(state==='COMPLETE')confirmPayment_(p.invoiceId);return {state:state||p.status};}
function createMaintenance_(b){const u=auth_(b.token);const t=tenantForUser_(u);const x={id:uid_(),tenantId:u.tenantId,tenantRecordId:t.id,unitId:t.unitId,subject:String(b.subject||''),description:String(b.description||''),status:'OPEN',createdAt:now_(),updatedAt:now_()};if(!x.subject||!x.description)throw new Error('Subject and description are required.');add_('Maintenance',x);return x;}
function updateMaintenance_(b){const u=auth_(b.token);requireLandlord_(u);const x=getOwned_('Maintenance',b.id,u.tenantId);if(!x)throw new Error('Request not found.');x.status=String(b.status||x.status);x.updatedAt=now_();update_('Maintenance',x.id,x);audit_(u.tenantId,u.id,'MAINTENANCE_UPDATED','Maintenance',x.id,{status:x.status});return x;}
function createExpense_(b){const u=auth_(b.token);requireLandlord_(u);const p=getOwned_('Properties',b.propertyId,u.tenantId);if(!p)throw new Error('Property not found.');const amount=num_(b.amount);if(amount<=0)throw new Error('Amount must be positive.');const x={id:uid_(),tenantId:u.tenantId,propertyId:p.id,category:String(b.category||'Other'),description:String(b.description||''),amount,expenseDate:String(b.expenseDate||now_().slice(0,10)),createdAt:now_()};add_('Expenses',x);return x;}
function tenantStatement_(b){const u=auth_(b.token),t=tenantForUser_(u);return {tenant:t,unit:getOwned_('Units',t.unitId,u.tenantId),ledger:rows_('RentLedger',u.tenantId).filter(x=>x.tenantRecordId===t.id),payments:rows_('Payments',u.tenantId).filter(x=>x.tenantRecordId===t.id)};}
function tenantForUser_(u){if(u.role!=='TENANT')throw new Error('Tenant account required.');const t=rows_('Tenants',u.tenantId).find(x=>x.email===u.email);if(!t)throw new Error('Tenant profile not found.');return t;}
function handleWebhook_(ev){
  const challenge=prop_('INTASEND_WEBHOOK_CHALLENGE');if(!challenge||String(ev.challenge||'')!==challenge)throw new Error('Invalid webhook challenge.');
  if(ev.topic!=='collection_event'||!ev.invoice_id)return {received:true,ignored:true};
  const lock=LockService.getScriptLock();lock.waitLock(10000);try{
    const invoice=String(ev.invoice_id),state=String(ev.state||'').toUpperCase();
    const duplicate=find_('WebhookEvents','id',invoice+'_'+state);if(duplicate.length)return {received:true,duplicate:true};
    add_('WebhookEvents',{id:invoice+'_'+state,invoiceId:invoice,state,receivedAt:now_()});
    if(state==='COMPLETE')confirmPayment_(invoice);
    if(['FAILED','CANCELED'].includes(state))updatePaymentStatus_(invoice,state);
    return {received:true};
  }finally{lock.releaseLock();}
}
function confirmPayment_(invoice){
  const p=find_('Payments','invoiceId',invoice)[0];if(!p||p.status==='PAID')return;
  const state=fetchInvoiceState_(invoice);if(state!=='COMPLETE')return;
  const l=getOwned_('RentLedger',p.ledgerId,p.tenantId);if(!l)return;
  const amount=num_(p.amount);p.status='PAID';p.paidAt=now_();update_('Payments',p.id,p);allocate_(l,amount);
  audit_(p.tenantId,'SYSTEM','PAYMENT_CONFIRMED','Payment',p.id,{invoiceId:invoice,amount});
  const t=getOwned_('Tenants',p.tenantRecordId,p.tenantId);if(t&&t.email){try{MailApp.sendEmail(t.email,'Rent payment received — RentFlow','We have confirmed your rent payment of KSh '+amount+'. Reference: '+(p.reference||invoice));}catch(e){}}
}
function allocate_(l,amount){l.paid=num_(l.paid)+amount;l.balance=Math.max(0,num_(l.charge)-l.paid);l.status=l.balance===0?'PAID':'PARTIAL';update_('RentLedger',l.id,l);}
function updatePaymentStatus_(invoice,status){const p=find_('Payments','invoiceId',invoice)[0];if(p&&p.status!=='PAID'){p.status=status;update_('Payments',p.id,p);}}
function fetchInvoiceState_(invoice){const key=prop_('INTASEND_SECRET_KEY');const r=inta_('/payment/status/',{invoice_id:invoice},key);return String(r.state||r.status||'').toUpperCase();}
function inta_(path,payload,key){const response=UrlFetchApp.fetch('https://api.intasend.com/api/v1'+path,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+key},payload:JSON.stringify(payload),muteHttpExceptions:true});const code=response.getResponseCode(),txt=response.getContentText();let data={};try{data=JSON.parse(txt);}catch(e){}if(code<200||code>=300)throw new Error(data.detail||data.message||'IntaSend request failed ('+code+').');return data;}
function phone_(v){let s=String(v||'').replace(/[\s+-]/g,'');if(s.startsWith('0'))s='254'+s.slice(1);if(s.startsWith('7')||s.startsWith('1'))s='254'+s;if(!/^254[17]\d{8}$/.test(s))throw new Error('Enter a valid Kenyan phone number.');return s;}
function prop_(k){return PropertiesService.getScriptProperties().getProperty(k)||'';}
function db_(){const id=prop_('RF_SPREADSHEET_ID');if(!id)throw new Error('Run setup() first.');return SpreadsheetApp.openById(id);}
function rows_(name,tenantId){const s=db_().getSheetByName(name),v=s.getDataRange().getValues();if(v.length<2)return [];const h=v[0];return v.slice(1).filter(r=>r.some(c=>c!==''&&c!==null)).map(r=>{const o={};h.forEach((k,i)=>o[k]=r[i]);return o;}).filter(o=>!tenantId||o.tenantId===tenantId);}
function add_(name,obj){const s=db_().getSheetByName(name),h=RF.SHEETS[name];s.appendRow(h.map(k=>obj[k]===undefined?'':obj[k]));}
function find_(name,key,value){return rows_(name).filter(x=>String(x[key])===String(value));}
function getOwned_(name,id,tenantId){return rows_(name,tenantId).find(x=>String(x.id)===String(id));}
function update_(name,id,obj){const s=db_().getSheetByName(name),v=s.getDataRange().getValues(),h=v[0],ix=h.indexOf('id');for(let r=1;r<v.length;r++){if(String(v[r][ix])===String(id)){s.getRange(r+1,1,1,h.length).setValues([h.map(k=>obj[k]===undefined?'':obj[k])]);return;}}throw new Error('Record not found.');}
function remove_(name,key,value){const s=db_().getSheetByName(name),v=s.getDataRange().getValues(),ix=v[0].indexOf(key);for(let r=v.length-1;r>=1;r--)if(String(v[r][ix])===String(value))s.deleteRow(r+1);}
function audit_(tid,actor,action,entity,eid,details){add_('AuditLogs',{id:uid_(),tenantId:tid,actorId:actor,action,entity,entityId:eid,details:JSON.stringify(details||{}),createdAt:now_()});}
function hash_(v,salt){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(salt)+'|'+String(v)).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function normEmail_(v){return String(v||'').trim().toLowerCase();}function uid_(){return Utilities.getUuid();}function now_(){return new Date().toISOString();}function num_(v){const n=Number(v);return isFinite(n)?Math.round(n*100)/100:0;}function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
