import { state, getActiveFamily } from "./data/demo-data.js";
import { renderHeader } from "./components/header.js";
import { renderConsoleSwitcher, renderUserNavigation, renderAdminNavigation } from "./components/navigation.js";
import { renderUserContent } from "./pages/user.js";
import { renderAdminContent } from "./pages/admin.js";
import { money } from "./utils/format.js";
import { getExpenseShares, getFinancialSummary } from "./utils/finance.js";
const markCostsProvisional = () => { state.costsFinalized=false; state.costsFinalizedAt=null; };
const makeId = (prefix = "lid") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
function renderApp() {
  const isAdmin=state.activeConsole==="admin";
  document.querySelector("#app").innerHTML=`${renderHeader()}<main class="shell">${renderConsoleSwitcher(state.activeConsole)}<div class="workspace">${isAdmin?renderAdminNavigation(state.activeSection):renderUserNavigation(state.activeSection)}<div class="content">${isAdmin?renderAdminContent(state.activeSection):renderUserContent(state.activeSection)}</div></div><footer>Nieuwjaar <span>·</span> Samen vieren, alles geregeld.</footer></main>`;
}
function handleClick(event) {
  const consoleButton=event.target.closest("[data-console]");
  if(consoleButton){state.activeConsole=consoleButton.dataset.console;state.activeSection="overview";state.editingMember=null;renderApp();return;}
  const sectionButton=event.target.closest("[data-section]");
  if(sectionButton){state.activeSection=sectionButton.dataset.section;state.editingMember=null;renderApp();return;}
  const action=event.target.closest("[data-action]");
  if(!action)return;
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
  if(action.dataset.action==="edit-registration"){const item=state.registrations.find(row=>row.id===action.dataset.id);if(!item)return;const name=window.prompt("Naam van de inschrijving:",item.name);if(name===null)return;const adults=window.prompt("Aantal volwassenen (18+):",String(item.adults));if(adults===null)return;const children=window.prompt("Aantal kinderen:",String(item.children));if(children===null)return;const adultCount=Number(adults),childCount=Number(children);if(!name.trim()||!Number.isInteger(adultCount)||!Number.isInteger(childCount)||adultCount<0||childCount<0||adultCount+childCount<1){window.alert("Controleer de naam en aantallen. Er moet minstens één deelnemer zijn.");return;}item.name=name.trim();item.adults=adultCount;item.children=childCount;renderApp();}
  if(action.dataset.action==="print")window.print();
  if(action.dataset.action==="toggle-product"){const product=state.catalog.find(item=>item.id===action.dataset.id);if(product)product.active=!product.active;renderApp();}
  if(action.dataset.action==="remove-image"){const product=state.catalog.find(item=>item.id===action.dataset.id);if(product)product.image=null;renderApp();}
}
function handleSubmit(event){
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
    try{getExpenseShares(updated,state.registrations);}catch(error){window.alert(error.message);return;}
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
    try { getExpenseShares(expense,state.registrations); } catch(error){ window.alert(error.message); return; }
    state.expenses.push(expense);
    markCostsProvisional();
    renderApp();return;
  }
  if(event.target.id==="add-registration-form"){event.preventDefault();const form=event.target;const name=form.elements.registrationName.value.trim();const adults=Number(form.elements.adults.value);const children=Number(form.elements.children.value);if(!name||!Number.isInteger(adults)||!Number.isInteger(children)||adults<0||children<0||adults+children<1){window.alert("Vul een naam en minstens één deelnemer in.");return;}const id=name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now().toString(36);state.registrations.push({id,name,adults,children,members:[],financial:{advanced:0,share:0,bring:0}});markCostsProvisional();renderApp();return;}
  if(event.target.id!=="add-product-form")return;event.preventDefault();
  const name=event.target.elements.productName.value.trim();if(!name)return;
  if(state.catalog.some(item=>item.name.toLowerCase()===name.toLowerCase())){window.alert("Dit product bestaat al in de catalogus.");return;}
  const id=name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now().toString(36);
  state.catalog.push({id,name,active:true,image:null});state.registrations.forEach(registration=>(registration.members||[]).forEach(person=>{person.orders[id]=0;}));renderApp();
}
function handleImageUpload(event){
  const input=event.target;if(!input.matches("[data-upload-image]"))return;const file=input.files?.[0];if(!file)return;
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){window.alert("Gebruik een JPG-, PNG- of WebP-afbeelding.");input.value="";return;}
  if(file.size>5*1024*1024){window.alert("De afbeelding mag maximaal 5 MB groot zijn.");input.value="";return;}
  const product=state.catalog.find(item=>item.id===input.dataset.uploadImage);if(!product)return;
  const reader=new FileReader();reader.onload=()=>{product.image=reader.result;renderApp();};reader.readAsDataURL(file);
}
export function startApp(){
  document.addEventListener("click",handleClick);document.addEventListener("submit",handleSubmit);document.addEventListener("change",handleImageUpload);renderApp();
}
