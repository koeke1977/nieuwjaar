import { state } from "./data/demo-data.js";
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
  if(consoleButton){state.activeConsole=consoleButton.dataset.console;state.activeSection="overview";renderApp();return;}
  const sectionButton=event.target.closest("[data-section]");
  if(sectionButton){state.activeSection=sectionButton.dataset.section;renderApp();return;}
  const action=event.target.closest("[data-action]");
  if(!action)return;
  if(action.dataset.action==="receive"){
    const payment=state.payments[Number(action.dataset.index)];const remaining=Math.max(0,payment.due-payment.paid);
    const raw=window.prompt(`Hoeveel heeft ${payment.household} betaald?\nNog openstaand: ${money(remaining)}`,String(remaining));if(raw===null)return;
    const amount=Number(raw.replace(",","."));if(!Number.isFinite(amount)||amount<=0){window.alert("Geef een geldig bedrag in.");return;}
    payment.paid=Math.round((payment.paid+amount)*100)/100;payment.method="Cash";renderApp();
  }
  if(action.dataset.action==="print")window.print();
  if(action.dataset.action==="edit-order")window.alert(`Bestelling aanpassen voor ${action.dataset.name} – de invoer volgt in een volgende stap.`);
  if(action.dataset.action==="toggle-product"){const product=state.catalog.find(item=>item.id===action.dataset.id);if(product)product.active=!product.active;renderApp();}
  if(action.dataset.action==="remove-image"){const product=state.catalog.find(item=>item.id===action.dataset.id);if(product)product.image=null;renderApp();}
}
function handleSubmit(event){
  if(event.target.id!=="add-product-form")return;event.preventDefault();
  const name=event.target.elements.productName.value.trim();if(!name)return;
  if(state.catalog.some(item=>item.name.toLowerCase()===name.toLowerCase())){window.alert("Dit product bestaat al in de catalogus.");return;}
  const id=name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now().toString(36);
  state.catalog.push({id,name,active:true,image:null});renderApp();
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
