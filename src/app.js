import { state, getActiveFamily } from "./data/demo-data.js";
import { renderHeader } from "./components/header.js";
import { renderConsoleSwitcher, renderUserNavigation, renderAdminNavigation } from "./components/navigation.js";
import { renderUserContent } from "./pages/user.js";
import { renderAdminContent } from "./pages/admin.js";
import { money } from "./utils/format.js";
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
  if(action.dataset.action==="receive"){
    const payment=state.payments[Number(action.dataset.index)];const remaining=Math.max(0,payment.due-payment.paid);
    const raw=window.prompt(`Hoeveel heeft ${payment.household} betaald?\nNog openstaand: ${money(remaining)}`,String(remaining));if(raw===null)return;
    const amount=Number(raw.replace(",","."));if(!Number.isFinite(amount)||amount<=0){window.alert("Geef een geldig bedrag in.");return;}
    payment.paid=Math.round((payment.paid+amount)*100)/100;payment.method="Cash";renderApp();
  }
  if(action.dataset.action==="edit-order"){state.editingMember=state.editingMember===action.dataset.name?null:action.dataset.name;renderApp();}
  if(action.dataset.action==="close-order-editor"){state.editingMember=null;renderApp();}
  if(action.dataset.action==="change-quantity"){
    const person=getActiveFamily().members.find(item=>item.name===action.dataset.person);
    const product=state.catalog.find(item=>item.id===action.dataset.product);
    if(person&&product){const current=Number(person.orders[product.id])||0;person.orders[product.id]=Math.max(0,current+Number(action.dataset.delta));renderApp();}
  }
  if(action.dataset.action==="edit-registration"){const item=state.registrations.find(row=>row.id===action.dataset.id);if(!item)return;const name=window.prompt("Naam van de inschrijving:",item.name);if(name===null)return;const adults=window.prompt("Aantal volwassenen (18+):",String(item.adults));if(adults===null)return;const children=window.prompt("Aantal kinderen:",String(item.children));if(children===null)return;const adultCount=Number(adults),childCount=Number(children);if(!name.trim()||!Number.isInteger(adultCount)||!Number.isInteger(childCount)||adultCount<0||childCount<0||adultCount+childCount<1){window.alert("Controleer de naam en aantallen. Er moet minstens één deelnemer zijn.");return;}item.name=name.trim();item.adults=adultCount;item.children=childCount;renderApp();}
  if(action.dataset.action==="print")window.print();
  if(action.dataset.action==="toggle-product"){const product=state.catalog.find(item=>item.id===action.dataset.id);if(product)product.active=!product.active;renderApp();}
  if(action.dataset.action==="remove-image"){const product=state.catalog.find(item=>item.id===action.dataset.id);if(product)product.image=null;renderApp();}
}
function handleSubmit(event){
  if(event.target.id==="add-registration-form"){event.preventDefault();const form=event.target;const name=form.elements.registrationName.value.trim();const adults=Number(form.elements.adults.value);const children=Number(form.elements.children.value);if(!name||!Number.isInteger(adults)||!Number.isInteger(children)||adults<0||children<0||adults+children<1){window.alert("Vul een naam en minstens één deelnemer in.");return;}const id=name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now().toString(36);state.registrations.push({id,name,adults,children,members:[],financial:{advanced:0,share:0,bring:0}});renderApp();return;}
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
