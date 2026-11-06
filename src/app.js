import { startFamilyPortal } from "./pages/family-portal.js";
import { state, getActiveFamily } from "./data/demo-data.js";
import { renderHeader } from "./components/header.js";
import { renderConsoleSwitcher, renderUserNavigation, renderAdminNavigation } from "./components/navigation.js";
import { renderUserContent } from "./pages/user.js";
import { renderAdminContent, setFamilyInvites } from "./pages/admin.js";
import { money } from "./utils/format.js";
import { getExpenseShares, getFinancialSummary } from "./utils/finance.js";
import { switchEnvironment, resetTestEnvironment } from "./data/environment-store.js";
import { archiveCurrentAndStartNewEdition } from "./data/edition-manager.js";
import { loadAdminState, saveAdminState } from "./services/admin-state.js";
const markCostsProvisional = () => { state.costsFinalized=false; state.costsFinalizedAt=null; };
const makeId = (prefix = "lid") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
let adminAuthenticated = false;
let loginError = "";
let statePersistenceReady = false;
let persistenceTimer = null;
let persistenceInFlight = false;
let persistenceAgain = false;
let persistenceError = "";
function scheduleAdminStateSave() {
  if (!adminAuthenticated || !statePersistenceReady) return;
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(async () => {
    if (persistenceInFlight) { persistenceAgain = true; return; }
    persistenceInFlight = true;
    try { await saveAdminState(); }
    catch (error) { persistenceError = error.message || "Opslaan is mislukt."; statePersistenceReady = false; console.error("Admin state save failed:", error); renderApp(); }
    finally {
      persistenceInFlight = false;
      if (persistenceAgain) { persistenceAgain = false; scheduleAdminStateSave(); }
    }
  }, 500);
}
async function loadFamilyInvites() {
  if (!adminAuthenticated) return;
  const response = await fetch("/api/admin/family-invites", { credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Gezinslinks konden niet worden geladen.");
  setFamilyInvites(result.invites || []);
}
function renderAdminLogin() { return `<main class="admin-login-shell"><section class="admin-login-card"><p class="eyebrow">NIEUWJAAR · ORGANISATIE</p><h1>Admin aanmelden</h1><p>Deze omgeving is uitsluitend toegankelijk voor de organisator.</p><form id="admin-login-form"><label for="admin-password">Adminwachtwoord</label><input id="admin-password" name="password" type="password" autocomplete="current-password" required>${loginError ? `<p class="admin-login-error" role="alert">${loginError}</p>` : ""}<button class="button button-dark full" type="submit">Aanmelden</button></form><a class="admin-login-back" href="/">Terug naar deelnemersportaal</a></section></main>`; }
function renderApp() {
  if (state.activeConsole === "admin" && !adminAuthenticated) { document.querySelector("#app").innerHTML=renderAdminLogin(); return; }
  const isAdmin=state.activeConsole==="admin";
  const persistenceNotice=persistenceError?"<div class=\"environment-notice\">Opslag is niet beschikbaar. Wijzigingen worden momenteel niet bewaard; controleer de verbinding en database-migratie.</div>":"";
  const environmentNotice=state.activeEnvironment==="test"?'<div class="environment-notice">TESTOMGEVING · Wijzigingen zijn alleen testgegevens en staan los van de echte editie.</div>':"";
  document.querySelector("#app").innerHTML=`${renderHeader()}<main class="shell">${isAdmin?'<div class="admin-session-bar"><span>Beveiligde admin-sessie</span><button class="text-button" data-action="admin-logout">Uitloggen</button></div>':""}${persistenceNotice}${environmentNotice}${renderConsoleSwitcher(state.activeConsole)}<div class="workspace">${isAdmin?renderAdminNavigation(state.activeSection):renderUserNavigation(state.activeSection)}<div class="content">${isAdmin?renderAdminContent(state.activeSection):renderUserContent(state.activeSection)}</div></div><footer>Nieuwjaar <span>·</span> Samen vieren, alles geregeld.</footer></main>`;
  if (state.activeConsole === "admin") scheduleAdminStateSave();
}
function handleClick(event) {
  const consoleButton=event.target.closest("[data-console]");
  if(consoleButton){if(consoleButton.dataset.console==="admin"&&!adminAuthenticated){state.activeConsole="admin";loginError="";renderApp();return;}state.activeConsole=consoleButton.dataset.console;state.activeSection="overview";state.editingMember=null;renderApp();return;}
  const sectionButton=event.target.closest("[data-section]");
  if(sectionButton){state.activeSection=sectionButton.dataset.section;state.editingMember=null;renderApp();return;}
  const action=event.target.closest("[data-action]");
  if(!action)return;
  if(action.dataset.action==="create-family-invite"){
    const registrationId=action.dataset.id;
    action.disabled=true;action.textContent="Aanmaken…";
    (async()=>{
      try{
        await saveAdminState();
        const response=await fetch("/api/admin/family-invites",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({edition:state.activeEnvironment,registrationId})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||"De gezinslink kon niet worden aangemaakt.");
        await loadFamilyInvites();
        renderApp();
      }catch(error){window.alert(error.message||"De gezinslink kon niet worden aangemaakt.");action.disabled=false;action.textContent="Gezinslink maken";}
    })();
    return;
  }
  if(action.dataset.action==="copy-family-invite"){
    const registrationId=action.dataset.id;
    const input=action.closest(".registration-row")?.nextElementSibling?.querySelector("input");
    if(input?.value){navigator.clipboard?.writeText(input.value).then(()=>window.alert("Gezinslink gekopieerd.")).catch(()=>{input.select();window.alert("Selecteer en kopieer de gezinslink.");});}
    return;
  }
  if(action.dataset.action==="copy-family-invite-url"){
    const url=action.dataset.url||"";
    if(url)navigator.clipboard?.writeText(url).then(()=>window.alert("Gezinslink gekopieerd.")).catch(()=>window.alert("Kopiëren is niet gelukt; selecteer de link in het overzicht."));
    return;
  }
  if(action.dataset.action==="revoke-family-invite"){
    if(!window.confirm("Deze persoonlijke gezinslink intrekken? De link en bestaande sessies verliezen onmiddellijk toegang."))return;
    (async()=>{try{
      const response=await fetch(`/api/admin/family-invites/${encodeURIComponent(action.dataset.id)}`,{method:"DELETE",credentials:"same-origin"});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"Intrekken is niet gelukt.");
      await loadFamilyInvites();renderApp();
    }catch(error){window.alert(error.message||"Intrekken is niet gelukt.");}})();
    return;
  }
  if(action.dataset.action==="admin-logout"){fetch("/api/admin/logout",{method:"POST",credentials:"same-origin"}).finally(()=>{adminAuthenticated=false;state.activeConsole="user";state.activeSection="overview";renderApp();});return;}
  if(action.dataset.action==="switch-environment"){
    const target=action.dataset.environment;
    const label=target==="test"?"de testomgeving":"de echte editie";
    if(!window.confirm(`Wisselen naar ${label}? De gegevens van de huidige omgeving blijven apart bewaard.`))return;
    switchEnvironment(target);
    renderApp();return;
  }
  if(action.dataset.action==="reset-test-environment"){
    if(state.activeEnvironment!=="test")return;
    if(!window.confirm("Alle testgezinnen, testkosten, betalingen en bestellingen verwijderen en de testomgeving opnieuw instellen? De echte editie blijft onaangeroerd."))return;
    resetTestEnvironment();
    renderApp();return;
  }
  if(action.dataset.action==="edit-expense"){state.editingExpenseId=action.dataset.id;renderApp();return;}
  if(action.dataset.action==="finalize-costs"){if(!window.confirm("Bevestig je dat alle kosten en facturen voor deze editie zijn ontvangen en ingevoerd? Daarna worden de bedragen als definitief getoond."))return;state.costsFinalized=true;state.costsFinalizedAt=new Date().toISOString();renderApp();return;}
  if(action.dataset.action==="reopen-costs"){if(!window.confirm("De eindafrekening opnieuw voorlopig maken?"))return;markCostsProvisional();renderApp();return;}
  if(action.dataset.action==="cancel-edit-expense"){state.editingExpenseId=null;renderApp();return;}
  if(action.dataset.action==="delete-expense"){
    const expense=state.expenses.find(item=>item.id===action.dataset.id);
    if(!expense)return;
    if(!window.confirm(`Verwijder de kost "${expense.description}" van ${money(expense.amountCents/100)} definitief? De verdeling en saldi worden opnieuw berekend.`))return;
    state.expenses=state.expenses.filter(item=>item.id!==expense.id);
    markCostsProvisional();
    renderApp();return;
  }
  if(action.dataset.action==="delete-payment"){
    const payment=state.payments.find(item=>item.id===action.dataset.id);
    if(!payment)return;
    if(!window.confirm("Deze betaling verwijderen? Het openstaande saldo wordt opnieuw berekend."))return;
    state.payments=state.payments.filter(item=>item.id!==payment.id);renderApp();return;
  }
  if(action.dataset.action==="edit-order"){state.editingMember=state.editingMember===action.dataset.personId?null:action.dataset.personId;renderApp();}
  if(action.dataset.action==="close-order-editor"){state.editingMember=null;renderApp();}
  if(action.dataset.action==="change-quantity"){
    const person=getActiveFamily().members.find(item=>item.id===action.dataset.personId);
    const product=state.catalog.find(item=>item.id===action.dataset.product);
    if(person&&product){const current=Number(person.orders[product.id])||0;person.orders[product.id]=Math.max(0,current+Number(action.dataset.delta));markCostsProvisional();renderApp();}
  }
  if(action.dataset.action==="edit-own-member"||action.dataset.action==="delete-own-member"){
    const registration=state.registrations.find(item=>item.id===state.activeRegistrationId);
    const members=registration?.members||[];
    const index=Number(action.dataset.index);
    const member=members[index];
    if(!registration||!member)return;
    if(action.dataset.action==="edit-own-member"){state.editingOwnMemberIndex=index;renderApp();return;}
    if(action.dataset.action==="delete-own-member"){
      if(members.length<=1){window.alert("Een inschrijving moet minstens één deelnemer bevatten.");return;}
      if(!window.confirm(`Verwijder ${member.name} uit jullie inschrijving?`))return;
      members.splice(index,1);
      markCostsProvisional();
    }
    registration.adults=members.filter(person=>person.type==="Volwassene").length;
    registration.children=members.filter(person=>person.type==="Kind").length;
    renderApp();return;
  }
  if(action.dataset.action==="manage-members"){state.managingRegistrationId=action.dataset.id;renderApp();return;}
  if(action.dataset.action==="edit-member"){state.editingAdminMemberIndex=Number(action.dataset.index);renderApp();return;}
  if(action.dataset.action==="cancel-edit-admin-member"){state.editingAdminMemberIndex=null;renderApp();return;}
  if(action.dataset.action==="cancel-edit-own-member"){state.editingOwnMemberIndex=null;renderApp();return;}
  if(action.dataset.action==="delete-member"){const registration=state.registrations.find(item=>item.id===state.managingRegistrationId);if(!registration?.members)return;const index=Number(action.dataset.index);if(!window.confirm(`Verwijder ${registration.members[index]?.name || 'dit lid'} uit deze inschrijving?`))return;registration.members.splice(index,1);markCostsProvisional();registration.adults=registration.members.filter(person=>person.type==="Volwassene").length;registration.children=registration.members.filter(person=>person.type==="Kind").length;renderApp();return;}
  if(action.dataset.action==="edit-registration"){const item=state.registrations.find(row=>row.id===action.dataset.id);if(!item)return;const name=window.prompt("Naam van de inschrijving:",item.name);if(name===null)return;const adults=window.prompt("Aantal volwassenen (18+):",String(item.adults));if(adults===null)return;const children=window.prompt("Aantal kinderen:",String(item.children));if(children===null)return;const adultCount=Number(adults),childCount=Number(children);if(!name.trim()||!Number.isInteger(adultCount)||!Number.isInteger(childCount)||adultCount<0||childCount<0||adultCount+childCount<1){window.alert("Controleer de naam en aantallen. Er moet minstens één deelnemer zijn.");return;}item.name=name.trim();item.adults=adultCount;item.children=childCount;markCostsProvisional();renderApp();}
  if(action.dataset.action==="print")window.print();
  if(action.dataset.action==="toggle-product"){const product=state.catalog.find(item=>item.id===action.dataset.id);if(product)product.active=!product.active;renderApp();}
  if(action.dataset.action==="remove-image"){
    const product=state.catalog.find(item=>item.id===action.dataset.id);if(!product)return;
    const oldImage=product.image;product.image=null;renderApp();
    if(oldImage?.startsWith("/media/"))fetch("/api/admin/product-image",{method:"DELETE",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:oldImage})}).catch(error=>console.error("Photo delete failed:",error));
    return;
  }
}
async function handleSubmit(event){
  if(event.target.id==="admin-login-form"){event.preventDefault();const form=event.target;const button=form.querySelector("button[type=submit]");button.disabled=true;button.textContent="Even controleren…";loginError="";try{const response=await fetch("/api/admin/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:form.elements.password.value})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Aanmelden is niet gelukt.");adminAuthenticated=true;try{await loadAdminState();statePersistenceReady=true;await loadFamilyInvites();}catch(loadError){console.error("Admin state load failed:",loadError);}state.activeConsole="admin";state.activeSection="overview";renderApp();}catch(error){loginError=error.message||"Aanmelden is niet gelukt.";renderApp();}return;}
  if(event.target.id==="add-member-form"){event.preventDefault();const registration=state.registrations.find(item=>item.id===state.managingRegistrationId);if(!registration)return;const form=event.target;const name=form.elements.memberName.value.trim();const type=form.elements.memberType.value;if(!name)return;if(!registration.members?.length&&registration.id!=="koen-isabella"){const replace=window.confirm("Deze inschrijving bevat momenteel alleen historische aantallen, geen namen. De nieuwe ledenlijst vervangt die aantallen. Doorgaan?");if(!replace)return;}registration.members=registration.members||[];registration.members.push({id:makeId("lid"),name,type,orders:Object.fromEntries(state.catalog.map(product=>[product.id,0]))});markCostsProvisional();registration.adults=registration.members.filter(person=>person.type==="Volwassene").length;registration.children=registration.members.filter(person=>person.type==="Kind").length;renderApp();return;}
  if(event.target.id==="add-own-member-form"){
    event.preventDefault();
    const registration=state.registrations.find(item=>item.id===state.activeRegistrationId);
    if(!registration)return;
    const form=event.target;
    const name=form.elements.memberName.value.trim();
    const type=form.elements.memberType.value;
    if(!name||!["Volwassene","Kind"].includes(type))return;
    registration.members=registration.members||[];
    registration.members.push({id:makeId("lid"),name,type,orders:Object.fromEntries(state.catalog.map(product=>[product.id,0]))});
    markCostsProvisional();
    registration.adults=registration.members.filter(person=>person.type==="Volwassene").length;
    registration.children=registration.members.filter(person=>person.type==="Kind").length;
    renderApp();return;
  }
  if(event.target.id==="edit-own-member-form" || event.target.id==="edit-admin-member-form"){
    event.preventDefault();
    const isOwn=event.target.id==="edit-own-member-form";
    const registration=state.registrations.find(item=>item.id===(isOwn?state.activeRegistrationId:state.managingRegistrationId));
    const index=Number(event.target.dataset.index);
    const member=registration?.members?.[index];
    const form=event.target;
    const name=form.elements.memberName.value.trim();
    const type=form.elements.memberType.value;
    if(!registration||!member||!name||!["Volwassene","Kind"].includes(type)){window.alert("Vul een geldige naam in en kies Volwassene of Kind.");return;}
    member.name=name;
    member.type=type;
    markCostsProvisional();
    registration.adults=registration.members.filter(person=>person.type==="Volwassene").length;
    registration.children=registration.members.filter(person=>person.type==="Kind").length;
    if(isOwn)state.editingOwnMemberIndex=null;else state.editingAdminMemberIndex=null;
    // Kosten, individuele aandelen en openstaande saldi worden bij elke render opnieuw uit de actuele ledenlijst berekend.
    renderApp();return;
  }
  if(event.target.id==="edit-expense-form"){
    event.preventDefault();
    const form=event.target;
    const expense=state.expenses.find(item=>item.id===state.editingExpenseId);
    if(!expense)return;
    const description=form.elements.description.value.trim();
    const amount=Number(form.elements.amount.value);
    const amountCents=Math.round(amount*100);
    const date=form.elements.date.value;
    const method=form.elements.method.value;
    const advancedBy=form.elements.advancedBy.value;
    if(!description||!Number.isFinite(amount)||amount<=0||!Number.isInteger(amountCents)||!date||!advancedBy||!["general","adults","meat"].includes(method)||!state.registrations.some(item=>item.id===advancedBy)){
      window.alert("Controleer alle velden.");return;
    }
    const updated={...expense,description,amountCents,date,method,advancedBy};
    try{getExpenseShares(updated,state.registrations,{ strict: true });}catch(error){window.alert(error.message);return;}
    Object.assign(expense,updated);
    markCostsProvisional();
    state.editingExpenseId=null;
    renderApp();return;
  }
  if(event.target.id==="add-payment-form"){
    event.preventDefault();
    const form=event.target;
    const registrationId=form.elements.registrationId.value;
    const amount=Number(form.elements.amount.value);
    const amountCents=Math.round(amount*100);
    const date=form.elements.date.value;
    const method=form.elements.method.value;
    if(!state.registrations.some(item=>item.id===registrationId)||!Number.isFinite(amount)||amount<=0||!Number.isInteger(amountCents)||!date||!["cash","bank"].includes(method)){
      window.alert("Controleer de inschrijving, het bedrag, de datum en de betaalwijze.");return;
    }
    const financial=getFinancialSummary(state.registrations,state.expenses,state.payments);
    const balance=financial.find(row=>row.id===registrationId);
    if(!balance||amountCents>balance.remainingCents){
      window.alert(`Het bedrag is hoger dan het openstaande saldo van ${money((balance?.remainingCents||0)/100)}.`);return;
    }
    state.payments.push({id:makeId("betaling"),eventId:state.activeEvent.id,registrationId,amountCents,date,method});
    renderApp();return;
  }
  if(event.target.id==="add-expense-form"){
    event.preventDefault();
    const form=event.target;
    const description=form.elements.description.value.trim();
    const amount=Number(form.elements.amount.value);
    const amountCents=Math.round(amount*100);
    const date=form.elements.date.value;
    const method=form.elements.method.value;
    const advancedBy=form.elements.advancedBy.value;
    if(!description||!Number.isFinite(amount)||amount<=0||!Number.isInteger(amountCents)||!date||!advancedBy||!["general","adults","meat"].includes(method)){
      window.alert("Controleer de omschrijving, het bedrag, de datum, de verdeelsleutel en de voorschieter.");return;
    }
    const expense={id:makeId("kost"),eventId:state.activeEvent.id,description,amountCents,date,method,advancedBy};
    try { getExpenseShares(expense,state.registrations,{ strict: true }); } catch(error){ window.alert(error.message); return; }
    state.expenses.push(expense);
    markCostsProvisional();
    renderApp();return;
  }
  if(event.target.id==="add-registration-form"){event.preventDefault();const form=event.target;const name=form.elements.registrationName.value.trim();if(!name){window.alert("Vul een naam voor het gezin of de deelnemer in.");return;}const id=name.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now().toString(36);state.registrations.push({id,name,adults:0,children:0,members:[],financial:{advanced:0,share:0,bring:0}});state.activeRegistrationId=id;state.managingRegistrationId=id;markCostsProvisional();renderApp();return;}
  if(event.target.id==="new-edition-form"){
    event.preventDefault();
    const form=event.target;
    const name=form.elements.editionName.value.trim();
    const copyCatalog=form.elements.copyCatalog.checked;
    if(!name){window.alert("Geef de nieuwe editie een naam.");return;}
    const confirmed=window.confirm(`De huidige editie "${state.activeEvent.name}" wordt afgesloten en volledig gearchiveerd. Daarna start "${name}" met lege inschrijvingen, kosten en betalingen. Doorgaan?`);
    if(!confirmed)return;
    try{archiveCurrentAndStartNewEdition(name,copyCatalog);renderApp();}
    catch(error){window.alert(error.message);}
    return;
  }
  if(event.target.id!=="add-product-form")return;event.preventDefault();
  const name=event.target.elements.productName.value.trim();if(!name)return;
  if(state.catalog.some(item=>item.name.toLowerCase()===name.toLowerCase())){window.alert("Dit product bestaat al in de catalogus.");return;}
  const id=name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now().toString(36);
  state.catalog.push({id,name,active:true,image:null});state.registrations.forEach(registration=>(registration.members||[]).forEach(person=>{person.orders[id]=0;}));renderApp();
}
async function handleImageUpload(event){
  const input=event.target;if(!input.matches("[data-upload-image]"))return;const file=input.files?.[0];if(!file)return;
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){window.alert("Gebruik een JPG-, PNG- of WebP-afbeelding.");input.value="";return;}
  if(file.size>5*1024*1024){window.alert("De afbeelding mag maximaal 5 MB groot zijn.");input.value="";return;}
  const product=state.catalog.find(item=>item.id===input.dataset.uploadImage);if(!product)return;
  const oldImage=product.image;
  const label=input.closest(".catalog-admin-actions")?.querySelector("label");
  if(label){label.textContent="Uploaden…";label.classList.add("disabled");}
  try{
    const form=new FormData();form.append("file",file);form.append("productId",product.id);form.append("environment",state.activeEnvironment);
    const response=await fetch("/api/admin/product-image",{method:"POST",credentials:"same-origin",body:form});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"De foto kon niet worden opgeslagen.");
    product.image=result.image;renderApp();
    if(oldImage?.startsWith("/media/"))fetch("/api/admin/product-image",{method:"DELETE",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:oldImage})}).catch(error=>console.error("Photo cleanup failed:",error));
  }catch(error){window.alert(error.message||"De foto kon niet worden opgeslagen.");}
  finally{input.value="";}
}
export async function startApp(){
  if (location.pathname.startsWith("/familie/")) { startFamilyPortal(); return; }
  document.addEventListener("click",handleClick);document.addEventListener("submit",handleSubmit);document.addEventListener("change",handleImageUpload);
  try{const response=await fetch("/api/admin/session",{credentials:"same-origin"});const session=await response.json();adminAuthenticated=Boolean(session.authenticated);}catch{adminAuthenticated=false;}
  if(adminAuthenticated){try{await loadAdminState();statePersistenceReady=true;await loadFamilyInvites();}catch(error){persistenceError=true;console.error("Admin state load failed:",error);}}
  renderApp();
}
