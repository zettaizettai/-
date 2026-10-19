// 表示の好みは予定データとは別に、このブラウザーだけに記憶します。
(function setupDisplayMode(){
  const key='care-schedule-display-mode';
  const narrow=window.matchMedia('(max-width:840px)');
  let preference=null;
  try{const saved=localStorage.getItem(key);if(saved==='mobile'||saved==='desktop')preference=saved}catch{}
  function apply(){
    const mode=preference||(narrow.matches?'mobile':'desktop');
    document.documentElement.dataset.displayMode=mode;
    document.querySelectorAll('[data-display-mode]').forEach(button=>{
      if(button.tagName!=='BUTTON')return;
      const selected=button.dataset.displayMode===mode;
      button.setAttribute('aria-pressed',String(selected));
      button.classList.toggle('button-primary',selected);
      button.classList.toggle('button-light',!selected);
    });
    document.querySelector('#displayModeHint').textContent=mode==='desktop'?'1週間表示・表を左右にスクロールできます':'1日ずつ表示します';
    window.dispatchEvent(new Event('resize'));
  }
  document.querySelectorAll('button[data-display-mode]').forEach(button=>{
    button.addEventListener('click',()=>{
      preference=button.dataset.displayMode;
      apply();
      try{localStorage.setItem(key,preference)}catch{document.querySelector('#displayModeHint').textContent+='（表示設定を記憶できませんでした）'}
    });
  });
  narrow.addEventListener('change',()=>{if(!preference)apply()});
  apply();
})();

// 保存先の読み込みが完了してから画面を初期化します。
(async function () {
const persistence = window.schedulePersistence.store;
const loadedState = await persistence.load();
const KEY='care-schedule-v1', DAYS=['月曜日','火曜日','水曜日','木曜日','金曜日','土曜日','日曜日'];
const STATUS={unassigned:'未対応',assigned:'ヘルパー決定',manager:'サ責対応',changed:'時間変更',cancelled:'サービス中止'};
const IMPORTED_CLIENT_NAMES=[];
let weekOffset=0;
let state=load();
window.schedulePersistence.bind(()=>state);
if(!Array.isArray(state.defaultServices)){
  state.defaultServices=JSON.parse(JSON.stringify(state.services));
  state.defaultServices.forEach(service=>{service.templateId=service.id});
}
state.services.forEach(service=>{
  if(!service.templateId&&state.defaultServices.some(template=>template.id===service.id)){
    service.templateId=service.id;
  }
});
if(!state.helperDaysOff)state.helperDaysOff={};
if(!state.weekNotes)state.weekNotes={};
if(!Array.isArray(state.clients)){
  state.clients=[...new Set(state.services.map(service=>service.clientName).filter(Boolean))]
    .map(name=>({id:id('c'),name}));
}
let importedClientsAdded=false;
IMPORTED_CLIENT_NAMES.forEach(name=>{
  if(!state.clients.some(client=>client.name===name)){
    state.clients.push({id:id('c'),name,reading:'',address:'',phone:''});
    importedClientsAdded=true;
  }
});
if(importedClientsAdded)save();

let view='unassigned',day=0,helper='all',only=false,showAssigned=true;
let weeklyClientFilter='all',weeklyManagerFilter='all';
let openId=null,openSource='week',returnView='unassigned';
let listMode='default',listWeekKey='',helperMode='default',helperWeekKey='';
function weekStart(offset=weekOffset){
  const date=new Date();
  date.setHours(0,0,0,0);
  const daysSinceMonday=(date.getDay()+6)%7;
  date.setDate(date.getDate()-daysSinceMonday+offset*7);
  return date;
}
function dateLabel(i){const d=weekStart();d.setDate(d.getDate()+i);return`${d.getMonth()+1}/${d.getDate()}`}
function weekLabel(){return`${dateLabel(0)}（${DAYS[0].charAt(0)}）～${dateLabel(6)}（${DAYS[6].charAt(0)}）`}
function currentWeekKey(){return weekKeyFromOffset(weekOffset)}
function weekKeyOffset(key){const target=new Date(`${key}T00:00:00`);return Math.round((target-weekStart(0))/604800000)}
function weekText(key){const [y,m,d]=key.split('-').map(Number),start=new Date(y,m-1,d);return`${start.getMonth()+1}/${start.getDate()}～${new Date(y,m-1,d+6).getMonth()+1}/${new Date(y,m-1,d+6).getDate()}`}
function id(p){return p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7)}
function initial(){return {helpers:[],services:[],clients:[],managers:[]}}
function load(){const x=loadedState;if(x&&Array.isArray(x.helpers)&&Array.isArray(x.services)){x.services.forEach(s=>{if(!s.weekKey)s.weekKey=currentWeekKey();if(!s.status)s.status=s.helperId?'assigned':'unassigned'});if(!Array.isArray(x.defaultServices)){x.defaultServices=JSON.parse(JSON.stringify(x.services));x.defaultServices.forEach(s=>{s.templateId=s.id})}x.defaultServices.forEach(s=>{if(!s.status)s.status=s.helperId?'assigned':'unassigned'});return x}return initial()}
function save(){return persistence.save(state)}
function sourceServices(source='week'){return source==='default'?state.defaultServices:state.services}
function findService(serviceId,source=openSource){return sourceServices(source).find(s=>s.id===serviceId)}
function hname(x){return state.helpers.find(h=>h.id===x)?.name||''}
function esc(x=''){return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function active(s){return s.status!=='cancelled'}
function weekMatch(s){return s.weekKey===currentWeekKey()}
function overlap(a,b){return a.startTime<b.endTime&&b.startTime<a.endTime}
function conflict(s,h,exclude=s.id,source='week'){const list=sourceServices(source);return list.some(x=>x.id!==exclude&&active(x)&&x.helperId===h&&x.day===s.day&&overlap(s,x)&&(source==='default'||x.weekKey===s.weekKey)) }
// 未割当一覧のひな形とヘルパー別のひな形は、別々のデータとして管理します。
// 旧データでは同じ配列を共有していたため、初回だけ担当者付きの予定をヘルパー別へ移します。
if(!Array.isArray(state.helperDefaultServices)){
  state.helperDefaultServices=(state.defaultServices||[]).filter(s=>!!s.helperId);
  state.defaultServices=(state.defaultServices||[]).filter(s=>!s.helperId);
  save();
}
let managerNamesMigrated=false;
[state.services,state.defaultServices,state.helperDefaultServices].forEach(items=>items.forEach(service=>{
  if(service.status!=='manager'||!service.managerName)return;
  const normalized=managerDisplayName(service.managerName);
  if(normalized!==service.managerName){service.managerName=normalized;managerNamesMigrated=true}
}));
if(managerNamesMigrated)save();
if(!Array.isArray(state.managers)){
  const savedManagerNames=[state.services,state.defaultServices,state.helperDefaultServices].flatMap(items=>items.filter(service=>service.status==='manager').map(service=>managerDisplayName(service.managerName))).filter(name=>name&&name!=='サ責対応');
  state.managers=[...new Set([...savedManagerNames])].map(name=>({id:id('m'),name}));
  save();
}
function badge(s){return`<span class="status-badge ${s.status}">${STATUS[s.status]}</span>`}
function hasDisplayOverlap(s){return active(s)&&!!s.helperId&&state.services.some(x=>x.id!==s.id&&active(x)&&x.weekKey===s.weekKey&&x.helperId===s.helperId&&x.day===s.day&&overlap(s,x))}
function nav(){return`<div class="mobile-day-nav"><button class="button button-light button-small" data-move="-1">＜ 前の日</button><strong>${DAYS[day]}</strong><button class="button button-light button-small" data-move="1">次の日 ＞</button></div>`}
function grid(fn=s=>true){return`<div class="week-grid">${DAYS.map((d,i)=>`<div class="day-column ${i===day?'mobile-selected':''}"><div class="day-title">${d}<small>${dateLabel(i)}・${state.services.filter(s=>weekMatch(s)&&s.day===i&&fn(s)).length}件</small></div><div class="cards">${state.services.filter(s=>weekMatch(s)&&s.day===i&&fn(s)).sort((a,b)=>a.startTime.localeCompare(b.startTime)).map(card).join('')||'<div class="empty">予定なし</div>'}</div></div>`).join('')}</div>`}
function weeklyClientNames(){return[...new Set([...state.clients.map(client=>client.name),...state.services.map(service=>service.clientName)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'))}
function weeklyManagerNames(){return[...new Set(state.services.filter(service=>service.status==='manager').map(service=>service.managerName||'サ責対応'))].sort((a,b)=>a.localeCompare(b,'ja'))}
function weeklyScheduleVisible(service){
  const statusVisible=service.status==='cancelled'||service.status==='manager'||(!service.helperId&&(service.status==='unassigned'||service.status==='changed'))||(showAssigned&&!!service.helperId&&service.status==='assigned');
  if(!statusVisible)return false;
  if(weeklyClientFilter!=='all'&&service.clientName!==weeklyClientFilter)return false;
  if(weeklyManagerFilter!=='all'&&(service.status!=='manager'||(service.managerName||'サ責対応')!==weeklyManagerFilter))return false;
  return true;
}
function render(){document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelector('#view-'+view).classList.add('active');document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===view));document.querySelector('#summary').innerHTML=`<span class="summary-label">${weekLabel()}の状況</span>`+Object.keys(STATUS).map(k=>`<div class="summary-item"><strong>${state.services.filter(s=>weekMatch(s)&&s.status===k).length}</strong>${STATUS[k]}</div>`).join('');
document.querySelector('#view-unassigned').innerHTML=`<div class="toolbar"><h2>未割当サービス週間</h2><div class="week-controls"><button class="button button-light button-small" data-week-move="-1">＜ 前週</button><button class="button button-light button-small" data-week-move="1">次週 ＞</button></div><div class="weekly-filters"><label>利用者<select id="weeklyClientFilter"><option value="all">すべて</option>${weeklyClientNames().map(name=>`<option value="${esc(name)}" ${weeklyClientFilter===name?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label>サ責<select id="weeklyManagerFilter"><option value="all">すべて</option>${weeklyManagerNames().map(name=>`<option value="${esc(name)}" ${weeklyManagerFilter===name?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label class="filter-row"><input type="checkbox" id="showAssigned" ${showAssigned?'checked':''}> 担当決定済みも表示</label></div><span class="notice">利用者名・サ責名で予定を絞り込めます</span></div>${nav()}${grid(weeklyScheduleVisible)}`;
document.querySelector('#view-helpers').innerHTML=`<div class="toolbar"><h2>ヘルパー別週間スケジュール</h2><label class="helper-picker">表示するヘルパー<select id="helperSelect"><option value="all">全員</option>${state.helpers.map(x=>`<option value="${x.id}" ${x.id===helper?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label></div>${helper==='all'?`<div class="panel"><p>ヘルパーを選択すると、その人の予定と空き状況を確認できます。</p>${grid(s=>active(s)&&s.status!=='unassigned')}</div>`:`<div class="panel"><h3>${esc(hname(helper))}さんの予定</h3>${nav()}${grid(s=>s.helperId===helper&&active(s))}</div>`}`;
const weekKeys=[...new Set([currentWeekKey(),...state.services.map(s=>s.weekKey).filter(Boolean)])].sort().reverse();const rows=state.services.filter(s=>(listMode==='default'||s.weekKey===listWeekKey)&&(!only||s.status==='unassigned')).sort((a,b)=>(a.weekKey||'').localeCompare(b.weekKey||'')||a.day-b.day||a.startTime.localeCompare(b.startTime));const listTabs=`<div class="list-tabs"><button class="button button-small ${listMode==='default'?'button-primary':'button-light'}" data-list-mode="default">デフォルト</button>${weekKeys.map(k=>`<button class="button button-small ${listMode==='week'&&listWeekKey===k?'button-primary':'button-light'}" data-list-week="${k}">${weekText(k)}</button>`).join('')}</div>`;document.querySelector('#view-list').innerHTML=`<div class="toolbar"><div><h2>未割当サービス一覧</h2><div class="history">${listMode==='default'?'全週のサービス':'表示中の週：'+weekText(listWeekKey)}</div></div><div><button class="button button-primary" data-bulk>${listMode==='week'?'この週を週間画面で表示':'一覧を週間画面で表示'}</button><button class="button button-light button-small" data-list-default>デフォルト表示に戻す</button></div></div>${listTabs}<div class="panel"><div class="filter-row"><label><input type="checkbox" id="only" ${only?'checked':''}> 未対応だけ表示</label><span class="history">※登録したサービスは削除するまで残ります</span></div><div class="list-wrap"><table class="schedule-table"><thead><tr><th>週</th><th>曜日</th><th>時間</th><th>利用者名</th><th>状態</th><th>メモ</th></tr></thead><tbody>${rows.map(s=>`<tr class="clickable" data-id="${s.id}"><td>${weekText(s.weekKey||currentWeekKey())}</td><td>${DAYS[s.day]}</td><td>${displayClockTime(s.startTime)}～${displayClockTime(s.endTime)}</td><td>${esc(s.clientName)}</td><td>${badge(s)}</td><td>${esc(s.memo)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">対象サービスはありません</td></tr>'}</tbody></table></div></div>`;
document.querySelector('#view-register').innerHTML=`<div class="toolbar"><div><h2>サービス登録</h2><div class="history">登録先：${weekLabel()}</div></div></div><form id="serviceForm" class="form-card"><div class="form-grid"><label>曜日<select name="day">${DAYS.map((x,i)=>`<option value="${i}">${x}</option>`).join('')}</select></label><label>利用者名<input name="clientName" required placeholder="例：山田様"></label><label>開始時間<input type="time" name="startTime" value="09:00" required></label><label>終了時間<input type="time" name="endTime" value="10:00" required></label><label>担当ヘルパー<select name="helperId"><option value="">未割当</option>${state.helpers.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}<option value="manager">サ責対応</option></select></label><label>メモ<textarea name="memo" placeholder="支援内容など"></textarea></label></div><div class="form-actions"><button class="button button-primary">サービスを登録</button></div></form>`;renderClients();replaceClientInput('#serviceForm input[name="clientName"]');bind()}
function replaceClientInput(selector){const input=document.querySelector(selector);if(!input||input.tagName==='SELECT')return;const select=document.createElement('select');select.id=input.id;select.name=input.name||'clientName';select.required=true;select.innerHTML=`<option value="">利用者を選択</option>${clientOptions()}`;input.replaceWith(select)}

function modal(id){const s=state.services.find(x=>x.id===id);if(!s)return;openId=id;const ok=state.helpers.filter(h=>!conflict(s,h.id)),busy=state.helpers.filter(h=>conflict(s,h.id));document.querySelector('#serviceModalTitle').textContent=`${s.clientName}｜${DAYS[s.day]}｜${displayClockTime(s.startTime)}～${displayClockTime(s.endTime)}`;document.querySelector('#serviceModalBody').innerHTML=`<div class="detail"><div class="detail-box">利用者：<b>${esc(s.clientName)}</b><br>状態：${badge(s)}${s.memo?`<br>メモ：${esc(s.memo)}`:''}${s.originalStartTime?`<div class="history">元の時間：${s.originalStartTime}～${s.originalEndTime}</div>`:''}</div><div class="detail-box"><h3>対応可能ヘルパー</h3><div class="availability">${ok.map(h=>`<button class="button button-light" data-assign="${h.id}">○ ${esc(h.name)}<span class="available">対応可能</span></button>`).join('')||'<p class="busy">対応可能なヘルパーはいません</p>'}</div><h3>予定あり</h3><div class="availability">${busy.map(h=>`<button class="button button-light" data-busy="${h.id}">× ${esc(h.name)}<span class="busy">予定あり</span></button>`).join('')||'<p class="history">該当なし</p>'}</div></div><div class="detail-box"><h3>別の処理</h3><div class="form-grid"><button class="button button-light" data-status="unassigned">未対応に戻す</button><button class="button button-light" data-status="manager">サ責対応にする</button><button class="button button-light" data-change>時間変更</button><button class="button button-danger" data-status="cancelled">サービス中止</button></div></div></div>`;document.querySelector('#serviceModalBackdrop').classList.remove('hidden');bindModal()}
function assign(h,force=false){const s=state.services.find(x=>x.id===openId);if(!s)return;if(conflict(s,h)&&!force){if(confirm('この時間には別の予定があります。OKで既存の予定を未割当にして割り当てます。'))assign(h,true);return}state.services.filter(x=>x.id!==s.id&&x.weekKey===s.weekKey&&x.helperId===h&&x.day===s.day&&overlap(s,x)).forEach(x=>{x.helperId='';x.status='unassigned'});s.helperId=h;s.status='assigned';save();close();render()}
function changeTime(){const s=state.services.find(x=>x.id===openId),box=document.querySelector('#serviceModalBody .detail');if(!s||!box)return;box.insertAdjacentHTML('beforeend',`<div class="detail-box"><h3>時間変更</h3><p class="history">時間欄にカーソルを置いてホイールを回すと15分ずつ変更できます。</p><div class="form-grid"><label>開始時間<input type="time" id="editStartTime" value="${s.startTime}"></label><label>終了時間<input type="time" id="editEndTime" value="${s.endTime}"></label></div><div class="form-actions"><button class="button button-primary" id="saveChangedTime">変更を保存</button></div></div>`);document.querySelector('#saveChangedTime').onclick=()=>{const a=document.querySelector('#editStartTime').value,b=document.querySelector('#editEndTime').value;if(!a||!b||a>=b){alert('終了時間は開始時間より後にしてください');return}s.originalStartTime=s.originalStartTime||s.startTime;s.originalEndTime=s.originalEndTime||s.endTime;s.startTime=a;s.endTime=b;s.helperId='';s.status='changed';save();close();render();modal(s.id)} }
function close(){document.querySelectorAll('.modal-backdrop').forEach(x=>x.classList.add('hidden'));openId=null}
function bind(){document.querySelectorAll('.tab').forEach(x=>x.onclick=()=>{view=x.dataset.view;render()});document.querySelectorAll('[data-id]').forEach(x=>{x.onclick=()=>modal(x.dataset.id);x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();modal(x.dataset.id)}}});document.querySelectorAll('[data-move]').forEach(x=>x.onclick=()=>{day=(day+Number(x.dataset.move)+7)%7;render()});document.querySelectorAll('[data-list-mode]').forEach(x=>x.onclick=()=>{listMode='default';listWeekKey='';render()});document.querySelectorAll('[data-list-week]').forEach(x=>x.onclick=()=>{listMode='week';listWeekKey=x.dataset.listWeek;render()});const hs=document.querySelector('#helperSelect');if(hs)hs.onchange=()=>{helper=hs.value;render()};const f=document.querySelector('#only');if(f)f.onchange=()=>{only=f.checked;render()};const form=document.querySelector('#serviceForm');if(form)form.onsubmit=e=>{e.preventDefault();const d=new FormData(form),h=d.get('helperId'),s={id:id('s'),weekKey:currentWeekKey(),day:+d.get('day'),startTime:d.get('startTime'),endTime:d.get('endTime'),clientName:d.get('clientName').trim(),helperId:h==='manager'?'':h,memo:d.get('memo').trim(),status:h==='manager'?'manager':h?'assigned':'unassigned'};if(s.startTime>=s.endTime)return alert('終了時間は開始時間より後にしてください');if(h&&h!=='manager'&&conflict(s,h,''))return alert('選択したヘルパーには同じ時間帯の予定があります。未割当で登録するか、時間を変更してください。');state.services.push(s);save();form.reset();alert('サービスを登録しました');render()};const bulk=document.querySelector('[data-bulk]');if(bulk)bulk.onclick=()=>{if(listMode==='week'&&listWeekKey){weekOffset=weekKeyOffset(listWeekKey)}view='unassigned';render()}}
function bindModal(){document.querySelectorAll('[data-assign]').forEach(x=>x.onclick=()=>assign(x.dataset.assign));document.querySelectorAll('[data-busy]').forEach(x=>x.onclick=()=>assign(x.dataset.busy));document.querySelectorAll('[data-status]').forEach(x=>x.onclick=()=>{const s=state.services.find(a=>a.id===openId),previousHelper=s.helperId;s.status=x.dataset.status;if(x.dataset.status!=='cancelled')s.helperId='';if(x.dataset.status==='manager')s.managerName='サ責対応';else if(x.dataset.status!=='cancelled')s.managerName='';else s.helperId=previousHelper;save();close();render()});document.querySelectorAll('[data-manager]').forEach(x=>x.onclick=()=>{const s=state.services.find(a=>a.id===openId);s.status='manager';s.helperId='';s.managerName=x.dataset.manager;save();close();render()});const c=document.querySelector('[data-change]');if(c)c.onclick=changeTime}
document.addEventListener('change',e=>{if(e.target.id==='showAssigned'){showAssigned=e.target.checked;render()}if(e.target.id==='weeklyClientFilter'){weeklyClientFilter=e.target.value;render()}if(e.target.id==='weeklyManagerFilter'){weeklyManagerFilter=e.target.value;render()}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-week-move]');if(b){weekOffset+=Number(b.dataset.weekMove);render()}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-list-default]');if(b){only=false;listMode='default';listWeekKey='';render()}});
// 登録時にweekKeyを直接設定するため、後付けの補正処理は不要です。
// 詳細モーダルにメモ編集・削除操作を追加します。
function addModalTools(){
  const s=state.services.find(x=>x.id===openId),body=document.querySelector('#serviceModalBody');
  if(!s||!body||body.querySelector('[data-close-memo]'))return;
  const managerButtons=state.managers.map(manager=>`<button class="button button-light" data-manager="${esc(manager.name)}">${esc(manager.name)}</button>`).join('')||'<p class="history">サ責管理から担当者を追加してください</p>';
  body.insertAdjacentHTML('beforeend',`<div class="detail-box"><h3>サ責対応</h3><div class="availability">${managerButtons}</div></div><div class="detail-box"><h3>メモ編集</h3><textarea id="editMemo">${esc(s.memo||'')}</textarea><div class="form-actions"><button type="button" class="button button-primary" data-close-memo>閉じる</button></div></div><div class="detail-box"><button class="button button-danger" data-delete-service>このサービスを削除</button></div>`);
  bindModal();
  const memoInput=body.querySelector('#editMemo');
  memoInput.oninput=()=>{s.memo=memoInput.value;save();render()};
  body.querySelector('[data-close-memo]').onclick=()=>{close();render()};
  body.querySelector('[data-delete-service]').onclick=()=>{if(confirm('このサービスを削除しますか？削除後は一覧にも残りません。')){state.services=state.services.filter(x=>x.id!==s.id);save();close();render()}};
}
const originalModal=modal;modal=function(id){originalModal(id);addModalTools()};
// 時間入力欄はマウスホイールで15分ずつ変更できます。
document.addEventListener('wheel',e=>{if(!e.target.matches('input[type="time"]'))return;e.preventDefault();const input=e.target,[h,m]=input.value.split(':').map(Number);let total=h*60+m+(e.deltaY<0?15:-15);total=Math.max(0,Math.min(1439,total));input.value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0')},{passive:false});
document.querySelector('#openHelperManager').onclick=()=>{document.querySelector('#helperModalBackdrop').classList.remove('hidden');helpersRender()};function helpersRender(){document.querySelector('#helperList').innerHTML=state.helpers.map(h=>`<div class="helper-row"><span>${esc(h.name)}</span><div><button class="button button-light button-small" data-edit="${h.id}">編集</button><button class="button button-danger button-small" data-del="${h.id}">削除</button></div></div>`).join('')||'<div class="empty">ヘルパーなし</div>';document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const h=state.helpers.find(x=>x.id===b.dataset.edit);helperId.value=h.id;helperName.value=h.name});document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{if(state.services.some(s=>s.helperId===b.dataset.del))return alert('担当中のサービスがあるため削除できません');if(confirm('削除しますか？')){state.helpers=state.helpers.filter(h=>h.id!==b.dataset.del);save();helpersRender();render()}})}
document.querySelector('#helperForm').onsubmit=e=>{e.preventDefault();const n=helperName.value.trim();if(!n)return;if(state.helpers.some(h=>h.name===n&&h.id!==helperId.value))return alert('同じ名前のヘルパーがすでに登録されています');const x=helperId.value;if(x)state.helpers.find(h=>h.id===x).name=n;else state.helpers.push({id:id('h'),name:n});save();e.target.reset();helpersRender();render()};document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=close);document.querySelectorAll('.modal-backdrop').forEach(x=>x.onclick=e=>{if(e.target===x)close()});document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});

// 一覧は「デフォルト（ひな形）」と「週別データ」を分離して表示します。
const baseRenderForIndependentList=render;
function weekKeyFromOffset(offset){
  const date=weekStart(offset);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function reflectionConflicts(key,templates){const conflicts=[];templates.forEach(t=>{if(!t.helperId)return;const templateId=t.templateId||t.id;state.services.filter(s=>s.weekKey===key&&s.templateId!==templateId&&active(s)&&s.helperId===t.helperId&&s.day===t.day&&overlap(t,s)).forEach(s=>conflicts.push({template:t,service:s}))});return conflicts}
function reflectDefaultToWeek(key){const templates=state.defaultServices||[],conflicts=reflectionConflicts(key,templates);if(conflicts.length){const details=conflicts.map(x=>`・${hname(x.template.helperId)}：${x.template.clientName} ${x.template.startTime}〜${x.template.endTime} ↔ ${x.service.clientName} ${x.service.startTime}〜${x.service.endTime}`).join('\n');if(!confirm(`${weekText(key)}への反映で、以下の予定が重複します。\n\n${details}\n\n重複した予定をそのまま反映しますか？`))return false}let added=0,updated=0;templates.forEach(t=>{const templateId=t.templateId||t.id,existing=state.services.find(s=>s.weekKey===key&&s.templateId===templateId);if(existing){const keepId=existing.id;Object.assign(existing,JSON.parse(JSON.stringify(t)),{id:keepId,templateId,weekKey:key});updated++;return}const copy=JSON.parse(JSON.stringify(t));copy.id=id('s');copy.templateId=templateId;copy.weekKey=key;state.services.push(copy);added++});save();alert(added||updated?`${weekText(key)}へ${added}件を追加、${updated}件を更新しました`:'この週には反映済みです');return true}
function renderIndependentList(){const root=document.querySelector('#view-list');if(!root)return;const selected=listWeekKey||currentWeekKey();const weekKeys=[...new Set([currentWeekKey(),...state.services.map(s=>s.weekKey).filter(Boolean)])].sort().reverse();const source=listMode==='default'?(state.defaultServices||[]):state.services;const rows=source.filter(s=>(listMode==='default'||s.weekKey===selected)&&(!only||s.status==='unassigned')).sort((a,b)=>(a.weekKey||'').localeCompare(b.weekKey||'')||a.day-b.day||a.startTime.localeCompare(b.startTime));const tabs=`<div class="list-tabs"><button class="button button-small ${listMode==='default'?'button-primary':'button-light'}" data-independent-default>デフォルト</button><button class="button button-small ${listMode==='week'?'button-primary':'button-light'}" data-independent-week>週別一覧</button></div>`;const weekNav=listMode==='week'?`<div class="week-controls list-week-controls"><button class="button button-light button-small" data-list-week-move="-1">＜ 前週</button><button class="button button-light button-small" data-list-week-move="1">次週 ＞</button></div>`:'';const action=listMode==='week'?`<button class="button button-primary" data-independent-reflect>デフォルトをこの週へ反映</button><button class="button button-light button-small" data-independent-show>この週を週間画面で表示</button>`:`<button class="button button-primary" data-independent-reflect>デフォルトを今週へ反映</button>`;root.innerHTML=`<div class="toolbar"><div><h2>未割当サービス一覧</h2><div class="history">${listMode==='default'?'デフォルト（ひな形）':`週別：${weekText(selected)}`}</div></div><div>${weekNav}${action}<button class="button button-light button-small" data-independent-reset>デフォルト表示に戻す</button></div></div>${tabs}<div class="panel"><div class="filter-row"><label><input type="checkbox" id="only" ${only?'checked':''}> 未対応だけ表示</label><span class="history">週別一覧を編集してもデフォルトには反映されません。</span></div><div class="list-wrap"><table class="schedule-table"><thead><tr><th>週</th><th>曜日</th><th>時間</th><th>利用者名</th><th>状態</th><th>メモ</th></tr></thead><tbody>${rows.map(s=>`<tr class="${listMode==='week'?'clickable':''}" data-independent-id="${s.id}"><td>${weekText(s.weekKey||currentWeekKey())}</td><td>${DAYS[s.day]}</td><td>${displayClockTime(s.startTime)}～${displayClockTime(s.endTime)}</td><td>${esc(s.clientName)}</td><td>${badge(s)}</td><td>${esc(s.memo)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">対象サービスはありません</td></tr>'}</tbody></table></div></div>`;root.querySelector('#only').onchange=e=>{only=e.target.checked;render()};root.querySelectorAll('[data-independent-id]').forEach(row=>{if(listMode==='week')row.onclick=()=>modal(row.dataset.independentId,'week')});root.querySelector('[data-independent-default]').onclick=()=>{listMode='default';listWeekKey='';render()};root.querySelector('[data-independent-week]').onclick=()=>{listMode='week';listWeekKey=selected;render()};root.querySelector('[data-independent-reset]').onclick=()=>{only=false;listMode='default';listWeekKey='';render()};root.querySelector('[data-independent-reflect]').onclick=()=>{reflectDefaultToWeek(listMode==='week'?selected:currentWeekKey());if(listMode==='default'){listMode='week';listWeekKey=currentWeekKey()}render()};if(listMode==='week'){root.querySelector('[data-independent-show]').onclick=()=>{weekOffset=weekKeyOffset(selected);view='unassigned';render()};root.querySelector('[data-list-week-move="-1"]').onclick=()=>{listWeekKey=weekKeyFromOffset(weekKeyOffset(selected)-1);render()};root.querySelector('[data-list-week-move="1"]').onclick=()=>{listWeekKey=weekKeyFromOffset(weekKeyOffset(selected)+1);render()}}}
render=function(){baseRenderForIndependentList();renderIndependentList()};
function validServiceTime(value){if(!value)return false;const [h,m]=value.split(':').map(Number);return h>=7&&h<=19&&m%5===0&&(h<19||m===0)}
function timeRangeMessage(a,b){if(!validServiceTime(a)||!validServiceTime(b))return'時間は07:00〜19:00の範囲で、5分刻みで入力してください。';if(a>=b)return'終了時間は開始時間より後にしてください';return''}
function defaultModal(id){const s=(state.defaultServices||[]).find(x=>x.id===id);if(!s)return;openId=id;openSource='default';document.querySelector('#serviceModalTitle').textContent=`デフォルト編集：${s.clientName}`;document.querySelector('#serviceModalBody').innerHTML=`<div class="detail"><div class="detail-box"><div class="form-grid"><label>曜日<select id="defaultEditDay">${DAYS.map((x,i)=>`<option value="${i}" ${s.day===i?'selected':''}>${x}</option>`).join('')}</select></label><label>利用者名<input id="defaultEditClient" value="${esc(s.clientName)}"></label><label>開始時間<input type="time" id="defaultEditStart" value="${s.startTime}" min="07:00" max="19:00" step="300"></label><label>終了時間<input type="time" id="defaultEditEnd" value="${s.endTime}" min="07:00" max="19:00" step="300"></label><label>担当ヘルパー<select id="defaultEditHelper"><option value="">未割当</option>${state.helpers.map(h=>`<option value="${h.id}" ${s.helperId===h.id?'selected':''}>${esc(h.name)}</option>`).join('')}<option value="manager" ${s.status==='manager'?'selected':''}>サ責対応</option></select></label><label>メモ<textarea id="defaultEditMemo">${esc(s.memo||'')}</textarea></label></div><div class="form-actions"><button class="button button-primary" id="saveDefaultService">デフォルトを保存</button><button class="button button-light" data-close-default>キャンセル</button></div></div></div>`;document.querySelector('#serviceModalBackdrop').classList.remove('hidden');document.querySelector('[data-close-default]').onclick=close;document.querySelector('#saveDefaultService').onclick=()=>{const a=document.querySelector('#defaultEditStart').value,b=document.querySelector('#defaultEditEnd').value,msg=timeRangeMessage(a,b);if(msg){alert(msg);return}const h=document.querySelector('#defaultEditHelper').value;s.day=Number(document.querySelector('#defaultEditDay').value);s.clientName=document.querySelector('#defaultEditClient').value.trim();s.startTime=a;s.endTime=b;s.helperId=h==='manager'?'':h;s.status=h==='manager'?'manager':h?'assigned':'unassigned';s.managerName=h==='manager'?'サ責対応':'';s.memo=document.querySelector('#defaultEditMemo').value;save();close();render()};}
document.addEventListener('submit',e=>{if(e.target.id!=='serviceForm')return;const latest=state.services[state.services.length-1];if(!latest||state.defaultServices.some(s=>s.id===latest.id||s.templateId===latest.templateId))return;const template=JSON.parse(JSON.stringify(latest));template.templateId=latest.id;state.defaultServices.push(template);save()});
document.addEventListener('submit',e=>{if(e.target.id!=='serviceForm')return;const a=e.target.querySelector('[name="startTime"]').value,b=e.target.querySelector('[name="endTime"]').value;const msg=timeRangeMessage(a,b);if(msg){e.preventDefault();e.stopImmediatePropagation();alert(msg)}},true);
document.addEventListener('click',e=>{if(e.target.closest('#saveChangedTime')){const a=document.querySelector('#editStartTime')?.value,b=document.querySelector('#editEndTime')?.value,msg=timeRangeMessage(a,b);if(msg){e.preventDefault();e.stopImmediatePropagation();alert(msg)}}},true);
function applyTimeLimits(){document.querySelectorAll('input[type="time"]').forEach(input=>{input.min='07:00';input.max='19:00';input.step='300'})}
const renderWithTimeLimits=render;render=function(){renderWithTimeLimits();applyTimeLimits()};
const renderWithDefaultEditing=render;render=function(){renderWithDefaultEditing();if(listMode==='default'){document.querySelectorAll('#view-list [data-independent-id]').forEach(row=>{row.classList.add('clickable');row.onclick=()=>defaultModal(row.dataset.independentId)})}};
document.addEventListener('wheel',e=>{if(!e.target.matches('input[type="time"]'))return;e.preventDefault();e.stopImmediatePropagation();const input=e.target,[h,m]=input.value.split(':').map(Number);let total=h*60+m+(e.deltaY<0?5:-5);total=Math.max(420,Math.min(1140,total));input.value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0')},{passive:false,capture:true});
function openServiceRegister(helperId=''){view='register';render();const form=document.querySelector('#serviceForm');if(!form)return;form.elements.day.value=String(day);if(helperId)form.elements.helperId.value=helperId;form.dataset.targetWeek=helperMode==='week'?(helperWeekKey||currentWeekKey()):currentWeekKey();form.elements.clientName.focus()}
function addQuickRegisterButtons(){[['#view-unassigned','この週に予定を追加'],['#view-helpers',helper!=='all'?`${esc(hname(helper))}さんの予定を追加`:'予定を追加']].forEach(([selector,label])=>{const viewRoot=document.querySelector(selector),toolbar=viewRoot?.querySelector('.toolbar');if(toolbar&&!toolbar.querySelector('[data-open-register]'))toolbar.insertAdjacentHTML('beforeend',`<button class="button button-primary" data-open-register="${selector==='#view-helpers'&&helper!=='all'?helper:''}">${label}</button>`)})}
const renderWithQuickRegister=render;render=function(){renderWithQuickRegister();addQuickRegisterButtons()};
document.addEventListener('click',e=>{const button=e.target.closest('[data-open-register]');if(button){openServiceRegister(button.dataset.openRegister||'')}});
function timeOptions(selected='09:00'){let html=`<option value="" ${selected===''?'selected':''}>未定</option>`;for(let total=420;total<=1140;total+=5){const value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');html+=`<option value="${value}" ${value===selected?'selected':''}>${displayClockTime(value)}</option>`}return html}
function clientOptions(selected=''){return state.clients.map(c=>`<option value="${esc(c.name)}" ${c.name===selected?'selected':''}>${esc(c.name)}</option>`).join('')}
function quickAddModal(helperId='',targetWeek=currentWeekKey()){document.querySelector('#serviceModalTitle').textContent='予定を追加';document.querySelector('#serviceModalBody').innerHTML=`<div class="detail"><div class="detail-box"><div class="form-grid"><label>曜日<select id="quickDay">${DAYS.map((x,i)=>`<option value="${i}" ${i===day?'selected':''}>${x}</option>`).join('')}</select></label><label>利用者名<select id="quickClient" required><option value="">利用者を選択</option>${clientOptions()}</select></label><label>開始時間<select id="quickStart">${timeOptions('09:00')}</select></label><label>終了時間<select id="quickEnd">${timeOptions('10:00')}</select></label><label>担当ヘルパー<select id="quickHelper"><option value="">未割当</option>${state.helpers.map(h=>`<option value="${h.id}" ${h.id===helperId?'selected':''}>${esc(h.name)}</option>`).join('')}<option value="manager">サ責対応</option></select></label><label>メモ<textarea id="quickMemo" placeholder="支援内容など"></textarea></label></div><div class="form-actions"><button class="button button-primary" id="saveQuickService">追加</button><button class="button button-light" data-close-quick>キャンセル</button></div></div></div>`;document.querySelector('#serviceModalBackdrop').classList.remove('hidden');document.querySelector('[data-close-quick]').onclick=close;document.querySelector('#saveQuickService').onclick=()=>{const client=document.querySelector('#quickClient').value.trim(),a=document.querySelector('#quickStart').value,b=document.querySelector('#quickEnd').value,msg=timeRangeMessage(a,b);if(!client||msg)return;if(!validServiceTime(a)||!validServiceTime(b))return;const selectedHelper=document.querySelector('#quickHelper').value,hasConflict=selectedHelper&&selectedHelper!=='manager'&&conflict({id:'',weekKey:targetWeek,day:Number(document.querySelector('#quickDay').value),startTime:a,endTime:b},selectedHelper,'');const s={id:id('s'),weekKey:targetWeek,day:Number(document.querySelector('#quickDay').value),startTime:a,endTime:b,clientName:client,helperId:hasConflict||selectedHelper==='manager'?'':selectedHelper,memo:document.querySelector('#quickMemo').value,status:hasConflict||selectedHelper===''?'unassigned':selectedHelper==='manager'?'manager':'assigned'};state.services.push(s);save();close();render()};document.querySelector('#quickClient').focus()}
const renderWithQuickModal=render;render=function(){renderWithQuickModal();document.querySelectorAll('[data-open-register]').forEach(button=>button.onclick=()=>quickAddModal(button.dataset.openRegister||''))};
document.addEventListener('submit',e=>{if(e.target.id!=='serviceForm')return;e.preventDefault();e.stopImmediatePropagation();const d=new FormData(e.target),h=d.get('helperId'),a=d.get('startTime'),b=d.get('endTime'),msg=timeRangeMessage(a,b);if(msg)return alert(msg);const targetWeek=e.target.dataset.targetWeek||currentWeekKey(),s={id:id('s'),weekKey:targetWeek,day:+d.get('day'),startTime:a,endTime:b,clientName:d.get('clientName').trim(),helperId:h==='manager'?'':h,memo:d.get('memo').trim(),status:h==='manager'?'manager':h?'assigned':'unassigned'};state.services.push(s);const template=JSON.parse(JSON.stringify(s));template.templateId=s.id;state.defaultServices.push(template);save();e.target.reset();render()},true);
const renderWithFiveMinuteSelects=render;render=function(){renderWithFiveMinuteSelects();convertDynamicTimeInputs()};
function convertDynamicTimeInputs(){document.querySelectorAll('input[type="time"]').forEach(input=>{const select=document.createElement('select');select.id=input.id;select.name=input.name;select.className=input.className;select.innerHTML=timeOptions(input.value);input.replaceWith(select)})}
const defaultModalWithFiveMinuteTimes=defaultModal;defaultModal=function(id){defaultModalWithFiveMinuteTimes(id);convertDynamicTimeInputs()};const changeTimeWithFiveMinuteTimes=changeTime;changeTime=function(){changeTimeWithFiveMinuteTimes();convertDynamicTimeInputs()};
document.addEventListener('click',e=>{const addButton=e.target.closest('[data-open-register]');if(addButton)returnView=view;if(e.target.closest('#saveQuickService'))view=returnView},true);
function quickTimeEdit(id){const s=findService(id,'week');if(!s)return;openId=id;openSource='week';document.querySelector('#serviceModalTitle').textContent=`時間変更：${s.clientName}`;document.querySelector('#serviceModalBody').innerHTML=`<div class="detail"><div class="detail-box"><p class="history">5分刻みで選択できます。</p><div class="form-grid"><label>開始時間<select id="cardEditStart">${timeOptions(s.startTime)}</select></label><label>終了時間<select id="cardEditEnd">${timeOptions(s.endTime)}</select></label></div><div class="form-actions"><button class="button button-primary" id="saveCardTime">保存</button><button class="button button-light" data-close-card-time>キャンセル</button></div></div></div>`;document.querySelector('#serviceModalBackdrop').classList.remove('hidden');document.querySelector('[data-close-card-time]').onclick=close;document.querySelector('#saveCardTime').onclick=()=>{const a=document.querySelector('#cardEditStart').value,b=document.querySelector('#cardEditEnd').value,msg=timeRangeMessage(a,b);if(msg){alert(msg);return}const hasConflict=s.helperId&&conflict({id:s.id,day:s.day,startTime:a,endTime:b},s.helperId,s.id,'week');s.startTime=a;s.endTime=b;if(hasConflict){s.helperId='';s.status='changed'}save();close();render()}}
document.addEventListener('click',e=>{const time=e.target.closest('.service-card .time');if(!time)return;e.preventDefault();e.stopImmediatePropagation();quickTimeEdit(time.closest('.service-card').dataset.id)},true);

function helperScheduleGrid(items,source){return`<div class="week-grid">${DAYS.map((name,index)=>{const dayItems=items.filter(s=>s.day===index).sort((a,b)=>a.startTime.localeCompare(b.startTime));return`<div class="day-column ${index===day?'mobile-selected':''}"><div class="day-title">${name}<small>${dateLabel(index)}・${dayItems.length}件</small></div><div class="cards">${dayItems.map(s=>{let html=card(s).replace(`data-id="${s.id}"`,`data-helper-card="${s.id}"`);if(source==='default')html=html.replace('class="time"','class="default-time"');return html}).join('')||'<div class="empty">予定なし</div>'}</div></div>`}).join('')}</div>`}
function reflectHelperDefaultToWeek(key,helperId){const templates=(state.defaultServices||[]).filter(s=>s.helperId===helperId),conflicts=reflectionConflicts(key,templates);if(conflicts.length){const details=conflicts.map(x=>`・${x.template.clientName} ${x.template.startTime}〜${x.template.endTime} ↔ ${x.service.clientName} ${x.service.startTime}〜${x.service.endTime}`).join('\n');if(!confirm(`${hname(helperId)}さんのデフォルト反映で、以下の予定が重複します。\n\n${details}\n\n重複した予定をそのまま反映しますか？`))return false}templates.forEach(t=>{const templateId=t.templateId||t.id,existing=state.services.find(s=>s.weekKey===key&&s.templateId===templateId);if(existing){const keepId=existing.id;Object.assign(existing,JSON.parse(JSON.stringify(t)),{id:keepId,templateId,weekKey:key});return}const copy=JSON.parse(JSON.stringify(t));copy.id=id('s');copy.templateId=templateId;copy.weekKey=key;state.services.push(copy)});save();return true}
function renderIndependentHelpers(){const root=document.querySelector('#view-helpers');if(!root)return;const selected=helperWeekKey||currentWeekKey();if(helper==='all'){root.innerHTML=`<div class="toolbar"><h2>ヘルパー別週間スケジュール</h2><label class="helper-picker">表示するヘルパー<select id="helperIndependentSelect"><option value="all">全員</option>${state.helpers.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select></label></div><div class="panel"><p>ヘルパーを選択すると、デフォルトと週別の予定を確認できます。</p></div>`;root.querySelector('#helperIndependentSelect').value='all';root.querySelector('#helperIndependentSelect').onchange=e=>{helper=e.target.value;helperMode='default';helperWeekKey='';render()};return}const source=helperMode==='default'?(state.defaultServices||[]):state.services;const items=source.filter(s=>s.helperId===helper&&(helperMode==='default'||s.weekKey===selected)&&active(s));const tabs=`<div class="list-tabs"><button class="button button-small ${helperMode==='default'?'button-primary':'button-light'}" data-helper-default>デフォルト</button><button class="button button-small ${helperMode==='week'?'button-primary':'button-light'}" data-helper-week>週別</button></div>`;const weekControls=helperMode==='week'?`<div class="week-controls list-week-controls"><button class="button button-light button-small" data-helper-week-move="-1">＜ 前週</button><button class="button button-light button-small" data-helper-week-move="1">次週 ＞</button></div>`:'';const actions=helperMode==='week'?`<button class="button button-primary" data-helper-reflect>デフォルトをこの週へ反映</button>`:`<button class="button button-primary" data-helper-reflect>デフォルトを今週へ反映</button>`;root.innerHTML=`<div class="toolbar"><div><h2>${esc(hname(helper))}さんの週間スケジュール</h2><div class="history">${helperMode==='default'?'デフォルト（ひな形）':`週別：${weekText(selected)}`}</div></div><label class="helper-picker">ヘルパー<select id="helperIndependentSelect">${state.helpers.map(h=>`<option value="${h.id}" ${h.id===helper?'selected':''}>${esc(h.name)}</option>`).join('')}</select></label><div class="helper-schedule-actions">${weekControls}${actions}<button class="button button-primary" data-open-register="${helper}">この週に予定を追加</button></div></div>${tabs}<div class="panel">${helperScheduleGrid(items,helperMode)}</div>`;root.querySelector('#helperIndependentSelect').onchange=e=>{helper=e.target.value;helperMode='default';helperWeekKey='';render()};root.querySelector('[data-helper-default]').onclick=()=>{helperMode='default';helperWeekKey='';render()};root.querySelector('[data-helper-week]').onclick=()=>{helperMode='week';helperWeekKey=selected;render()};root.querySelector('[data-helper-reflect]').onclick=()=>{reflectHelperDefaultToWeek(helperMode==='week'?selected:currentWeekKey(),helper);if(helperMode==='default'){helperMode='week';helperWeekKey=currentWeekKey()}render()};root.querySelectorAll('[data-helper-card]').forEach(x=>x.onclick=()=>{if(helperMode==='default')defaultModal(x.dataset.helperCard);else modal(x.dataset.helperCard,'week')});if(helperMode==='week'){root.querySelector('[data-helper-week-move="-1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selected)-1);render()};root.querySelector('[data-helper-week-move="1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selected)+1);render()}}}
const renderWithIndependentHelpers=render;render=function(){renderWithIndependentHelpers();renderIndependentHelpers()};
function defaultAddModal(helperId=''){document.querySelector('#serviceModalTitle').textContent='デフォルトサービスを登録';document.querySelector('#serviceModalBody').innerHTML=`<div class="detail"><div class="detail-box"><div class="form-grid"><label>曜日<select id="defaultAddDay">${DAYS.map((x,i)=>`<option value="${i}" ${i===day?'selected':''}>${x}</option>`).join('')}</select></label><label>利用者名<input id="defaultAddClient" required placeholder="例：山田様"></label><label>開始時間<select id="defaultAddStart">${timeOptions('09:00')}</select></label><label>終了時間<select id="defaultAddEnd">${timeOptions('10:00')}</select></label><label>担当ヘルパー<select id="defaultAddHelper"><option value="">未割当</option>${state.helpers.map(h=>`<option value="${h.id}" ${h.id===helperId?'selected':''}>${esc(h.name)}</option>`).join('')}<option value="manager">サ責対応</option></select></label><label>メモ<textarea id="defaultAddMemo" placeholder="支援内容など"></textarea></label></div><div class="form-actions"><button class="button button-primary" id="saveDefaultAdd">デフォルトに登録</button><button class="button button-light" data-close-default-add>キャンセル</button></div></div></div>`;document.querySelector('#serviceModalBackdrop').classList.remove('hidden');document.querySelector('[data-close-default-add]').onclick=close;document.querySelector('#saveDefaultAdd').onclick=()=>{const client=document.querySelector('#defaultAddClient').value.trim(),a=document.querySelector('#defaultAddStart').value,b=document.querySelector('#defaultAddEnd').value,msg=timeRangeMessage(a,b);if(!client||msg)return;const h=document.querySelector('#defaultAddHelper').value;state.defaultServices.push({id:id('s'),templateId:id('t'),day:Number(document.querySelector('#defaultAddDay').value),startTime:a,endTime:b,clientName:client,helperId:h==='manager'?'':h,memo:document.querySelector('#defaultAddMemo').value,status:h==='manager'?'manager':h?'assigned':'unassigned',managerName:h==='manager'?'サ責対応':''});save();close();render()};document.querySelector('#defaultAddClient').focus()}
function addDefaultServiceButtons(){const helperActions=document.querySelector('#view-helpers .helper-schedule-actions');if(helperMode==='default'&&helper!=='all'&&helperActions&&!helperActions.querySelector('[data-open-helper-default-add]')){helperActions.insertAdjacentHTML('afterbegin',`<button class="button button-primary" data-open-helper-default-add>このヘルパーのデフォルト予定を追加</button>`);helperActions.querySelector('[data-open-helper-default-add]').onclick=()=>defaultAddModal(helper)}}
const renderWithDefaultAddButtons=render;render=function(){renderWithDefaultAddButtons();addDefaultServiceButtons()};
function timeConflicts(service,startTime,endTime){if(!service.helperId)return[];return state.services.filter(x=>x.id!==service.id&&x.weekKey===service.weekKey&&active(x)&&x.helperId===service.helperId&&x.day===service.day&&overlap({startTime,endTime},x))}
function conflictWarning(service,conflicts,startTime,endTime){const names=conflicts.map(x=>`・${x.clientName}（${x.startTime}〜${x.endTime}）`).join('\n');return`${hname(service.helperId)}さんの予定と重複します。\n\n変更後：${startTime}〜${endTime}\n重複する予定：\n${names}\n\nOKを押すと、先に予定されていた予定を未対応に変更します。`}
document.addEventListener('click',e=>{const target=e.target.closest('#saveCardTime,#saveChangedTime');if(!target)return;const service=state.services.find(s=>s.id===openId);if(!service)return;const start=document.querySelector('#cardEditStart, #editStartTime')?.value,end=document.querySelector('#cardEditEnd, #editEndTime')?.value,conflicts=timeConflicts(service,start,end);if(!conflicts.length)return;if(!confirm(conflictWarning(service,conflicts,start,end))){e.preventDefault();e.stopImmediatePropagation();return}conflicts.forEach(x=>{x.helperId='';x.status='unassigned';x.managerName='' });save()},true);
function defaultQuickTimeEdit(id){const s=(state.defaultServices||[]).find(x=>x.id===id);if(!s)return;document.querySelector('#serviceModalTitle').textContent=`時間変更：${s.clientName}`;document.querySelector('#serviceModalBody').innerHTML=`<div class="detail"><div class="detail-box"><p class="history">5分刻みで選択できます。</p><div class="form-grid"><label>開始時間<select id="defaultCardStart">${timeOptions(s.startTime)}</select></label><label>終了時間<select id="defaultCardEnd">${timeOptions(s.endTime)}</select></label></div><div class="form-actions"><button class="button button-primary" id="saveDefaultCardTime">保存</button><button class="button button-light" data-close-default-time>キャンセル</button></div></div></div>`;document.querySelector('#serviceModalBackdrop').classList.remove('hidden');document.querySelector('[data-close-default-time]').onclick=close;document.querySelector('#saveDefaultCardTime').onclick=()=>{const a=document.querySelector('#defaultCardStart').value,b=document.querySelector('#defaultCardEnd').value;if(timeRangeMessage(a,b)){alert(timeRangeMessage(a,b));return}s.startTime=a;s.endTime=b;save();close();render()}}
document.addEventListener('click',e=>{const time=e.target.closest('.default-time');if(!time)return;const cardNode=time.closest('.service-card');if(!cardNode)return;e.preventDefault();e.stopImmediatePropagation();defaultQuickTimeEdit(cardNode.dataset.helperCard||cardNode.dataset.id)},true);
const helperScheduleGridWithCardIds=helperScheduleGrid;helperScheduleGrid=function(items,source){return helperScheduleGridWithCardIds(items,source).replace(/data-helper-card="([^"]+)"/g,'data-helper-card="$1" data-id="$1"')};const renderWithHelperCardIds=render;render=function(){renderWithHelperCardIds()};
document.addEventListener('click',e=>{if(e.target.closest('[data-close-quick]')){e.preventDefault();e.stopImmediatePropagation();view=returnView;close();render()}},true);
function formatDateLabels(){document.querySelectorAll('.week-grid').forEach(gridRoot=>{gridRoot.querySelectorAll('.day-column').forEach((column,index)=>{const title=column.querySelector('.day-title'),small=title?.querySelector('small');if(!title||!small)return;const count=small.textContent.split('・').pop();title.innerHTML=`${dateLabel(index)}（${DAYS[index].charAt(0)}）<small>${count}</small>`})});document.querySelectorAll('.mobile-day-nav strong').forEach(node=>{node.textContent=`${dateLabel(day)}（${DAYS[day].charAt(0)}）`})}
const renderWithDateLabels=render;render=function(){renderWithDateLabels();formatDateLabels()};
function addCardDeleteButtons(){document.querySelectorAll('.service-card').forEach(cardNode=>{if(cardNode.querySelector('[data-card-delete]'))return;const button=document.createElement('button');button.type='button';button.className='card-delete';button.dataset.cardDelete='';button.setAttribute('aria-label','予定を削除');button.textContent='×';cardNode.appendChild(button);button.onclick=e=>{e.preventDefault();e.stopPropagation();const isDefault=!!cardNode.querySelector('.default-time'),serviceId=cardNode.dataset.id||cardNode.dataset.helperCard;if(!confirm('この予定を削除しますか？'))return;if(isDefault)state.defaultServices=state.defaultServices.filter(s=>s.id!==serviceId);else state.services=state.services.filter(s=>s.id!==serviceId);save();close();render()}})}
const renderWithCardDeleteButtons=render;render=function(){renderWithCardDeleteButtons();addCardDeleteButtons()};
function addHelperChoiceButtons(){
  const select=document.querySelector('#helperIndependentSelect');
  if(!select||select.dataset.replaced)return;
  const wrap=document.createElement('div');
  wrap.className='helper-choice-buttons';
  wrap.setAttribute('aria-label','表示するヘルパー');
  state.helpers.forEach(h=>{
    const button=document.createElement('button');
    button.type='button';
    button.className=`button button-small ${helper===h.id?'button-primary':'button-light'}`;
    button.textContent=h.name;
    button.onclick=()=>{helper=h.id;rememberLastOpenedHelper(h.id);helperMode='week';helperWeekKey=currentWeekKey();render()};
    wrap.appendChild(button);
  });
  const all=document.createElement('button');
  all.type='button';
  all.className=`button button-small ${helper==='all'?'button-primary':'button-light'}`;
  all.textContent='全員';
  all.onclick=()=>{helper='all';helperMode='week';helperWeekKey=currentWeekKey();render()};
  wrap.appendChild(all);
  select.dataset.replaced='true';
  select.replaceWith(wrap);
}
const renderWithHelperChoiceButtons=render;render=function(){renderWithHelperChoiceButtons();addHelperChoiceButtons()};
function addHelperAbsenceTools(){const root=document.querySelector('#view-helpers');if(!root||helper==='all'||helperMode!=='week'||root.querySelector('[data-helper-absence]'))return;const toolbar=root.querySelector('.toolbar');if(!toolbar)return;const box=document.createElement('div');box.className='helper-absence-tools';box.innerHTML=`<div class="helper-day-buttons" aria-label="対象曜日">${DAYS.map((name,index)=>`<button type="button" class="button button-small ${day===index?'button-primary':'button-light'}" data-helper-day="${index}">${name.replace('曜日','')}</button>`).join('')}</div><button type="button" class="button button-danger button-small" data-helper-absence>この曜日を一括で未割当にする</button>`;toolbar.insertAdjacentElement('afterend',box);box.querySelectorAll('[data-helper-day]').forEach(button=>button.onclick=()=>{day=Number(button.dataset.helperDay);render()});box.querySelector('[data-helper-absence]').onclick=()=>{const selectedWeek=helperWeekKey||currentWeekKey(),targets=state.services.filter(s=>s.weekKey===selectedWeek&&s.helperId===helper&&s.day===day&&active(s));if(!targets.length){alert('対象の予定はありません');return}if(!confirm(`${hname(helper)}さんの${DAYS[day]}の予定${targets.length}件を未割当にしますか？`))return;targets.forEach(s=>{s.helperId='';s.status='unassigned';s.managerName='' });save();render()}}
const renderWithHelperAbsenceTools=render;render=function(){renderWithHelperAbsenceTools();addHelperAbsenceTools()};
const originalHelperAbsenceTools=addHelperAbsenceTools;addHelperAbsenceTools=function(){originalHelperAbsenceTools();const root=document.querySelector('#view-helpers'),button=root?.querySelector('[data-helper-absence]');if(!button)return;button.textContent='お休み';button.onclick=()=>{const selectedWeek=helperWeekKey||currentWeekKey(),key=`${selectedWeek}:${helper}:${day}`,targets=state.services.filter(s=>s.weekKey===selectedWeek&&s.helperId===helper&&s.day===day&&active(s));if(targets.length&&!confirm(`${hname(helper)}さんを${DAYS[day]}お休みにしますか？\n${targets.length}件の予定を未割当に変更します。`))return;state.helperDaysOff[key]=true;targets.forEach(s=>{s.helperId='';s.status='unassigned';s.managerName='' });save();render()}};const renderWithUpdatedAbsenceTools=render;render=function(){renderWithUpdatedAbsenceTools();markHelperDaysOff()};function markHelperDaysOff(){if(helper==='all'||helperMode!=='week')return;const selectedWeek=helperWeekKey||currentWeekKey();document.querySelectorAll('#view-helpers .day-column').forEach((column,index)=>{const key=`${selectedWeek}:${helper}:${index}`,title=column.querySelector('.day-title');if(state.helperDaysOff[key]&&title&&!title.querySelector('.day-off-label'))title.insertAdjacentHTML('beforeend','<span class="day-off-label">休み</span>')})}render();
function listWeekDateLabel(key,index){const [y,m,d]=key.split('-').map(Number),date=new Date(y,m-1,d+index);return`${date.getMonth()+1}/${date.getDate()}`}
function listScheduleGrid(items,source,key){return`<div class="week-grid">${DAYS.map((name,index)=>{const dayItems=items.filter(s=>s.day===index).sort((a,b)=>a.startTime.localeCompare(b.startTime));return`<div class="day-column ${index===day?'mobile-selected':''}"><div class="day-title">${listWeekDateLabel(key,index)}（${name.charAt(0)}）<small>${dayItems.length}件</small></div><div class="cards">${dayItems.map(s=>{let html=card(s);if(source==='default')html=html.replace('class="time"','class="default-time"');return html}).join('')||'<div class="empty">予定なし</div>'}</div></div>`}).join('')}</div>`}
const originalRenderIndependentList=renderIndependentList;renderIndependentList=function(){const root=document.querySelector('#view-list');if(!root)return;const selected=listWeekKey||currentWeekKey(),source=listMode==='default'?(state.defaultServices||[]):state.services,items=source.filter(s=>(listMode==='default'||s.weekKey===selected)&&(!only||s.status==='unassigned'));const tabs=`<div class="list-tabs"><button class="button button-small ${listMode==='default'?'button-primary':'button-light'}" data-independent-default>デフォルト</button><button class="button button-small ${listMode==='week'?'button-primary':'button-light'}" data-independent-week>週別一覧</button></div>`;const weekNav=listMode==='week'?`<div class="week-controls list-week-controls"><button class="button button-light button-small" data-list-week-move="-1">＜ 前週</button><button class="button button-light button-small" data-list-week-move="1">次週 ＞</button></div>`:'';const actions=listMode==='week'?`<button class="button button-primary" data-independent-reflect>デフォルトをこの週へ反映</button><button class="button button-light button-small" data-independent-show>この週を週間画面で表示</button>`:`<button class="button button-primary" data-independent-reflect>デフォルトを今週へ反映</button>`;root.innerHTML=`<div class="toolbar"><div><h2>未割当サービス一覧</h2><div class="history">${listMode==='default'?'デフォルト（ひな形）':`週別：${weekText(selected)}`}</div></div><div class="list-toolbar-actions">${weekNav}${actions}<button class="button button-light button-small" data-independent-reset>デフォルト表示に戻す</button></div></div>${tabs}<div class="panel"><div class="filter-row"><label><input type="checkbox" id="only" ${only?'checked':''}> 未対応だけ表示</label><span class="history">週別一覧を編集してもデフォルトには反映されません。</span></div>${listScheduleGrid(items,listMode,selected)}</div>`;root.querySelector('#only').onchange=e=>{only=e.target.checked;render()};root.querySelectorAll('.service-card').forEach(node=>{node.onclick=()=>{if(node.querySelector('.default-time'))defaultModal(node.dataset.id);else modal(node.dataset.id,'week')}});root.querySelector('[data-independent-default]').onclick=()=>{listMode='default';listWeekKey='';render()};root.querySelector('[data-independent-week]').onclick=()=>{listMode='week';listWeekKey=selected;render()};root.querySelector('[data-independent-reset]').onclick=()=>{only=false;listMode='default';listWeekKey='';render()};root.querySelector('[data-independent-reflect]').onclick=()=>{reflectDefaultToWeek(listMode==='week'?selected:currentWeekKey());if(listMode==='default'){listMode='week';listWeekKey=currentWeekKey()}render()};if(listMode==='week'){root.querySelector('[data-independent-show]').onclick=()=>{weekOffset=weekKeyOffset(selected);view='unassigned';render()};root.querySelector('[data-list-week-move="-1"]').onclick=()=>{listWeekKey=weekKeyFromOffset(weekKeyOffset(selected)-1);render()};root.querySelector('[data-list-week-move="1"]').onclick=()=>{listWeekKey=weekKeyFromOffset(weekKeyOffset(selected)+1);render()}}};
function addMultiSelectTools(){['#view-unassigned','#view-helpers','#view-list'].forEach(selector=>{const root=document.querySelector(selector);if(!root||!root.classList.contains('active'))return;const cards=[...root.querySelectorAll('.service-card')];if(!cards.length)return;cards.forEach(cardNode=>{if(cardNode.querySelector('[data-card-select]'))return;const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='card-select';checkbox.dataset.cardSelect='';checkbox.dataset.selectId=cardNode.dataset.id||cardNode.dataset.helperCard;checkbox.title='この予定を選択';checkbox.onclick=e=>e.stopPropagation();cardNode.appendChild(checkbox)});const toolbar=root.querySelector('.toolbar');if(!toolbar||toolbar.querySelector('[data-delete-selected]'))return;const button=document.createElement('button');button.type='button';button.className='button button-danger button-small';button.dataset.deleteSelected='';button.textContent='選択した予定を削除';button.onclick=()=>{const selected=[...root.querySelectorAll('[data-card-select]:checked')];if(!selected.length)return alert('削除する予定を選択してください');if(!confirm(`選択した${selected.length}件の予定を削除しますか？`))return;selected.forEach(check=>{const node=check.closest('.service-card'),isDefault=!!node.querySelector('.default-time'),idValue=check.dataset.selectId;if(isDefault)state.defaultServices=state.defaultServices.filter(s=>s.id!==idValue);else state.services=state.services.filter(s=>s.id!==idValue)});save();render()};toolbar.appendChild(button)})}
const renderWithMultiSelectTools=render;render=function(){renderWithMultiSelectTools();addMultiSelectTools()};
function resizeDayNote(note){note.style.height='auto';note.style.height=`${Math.max(54,note.scrollHeight)}px`}
function addWeeklyNotes(){const root=document.querySelector('#view-unassigned');if(!root)return;const title=root.querySelector('.toolbar h2');if(title)title.textContent='週間スケジュール';const key=currentWeekKey();if(!Array.isArray(state.weekNotes[key]))state.weekNotes[key]=Array(7).fill('');root.querySelectorAll('.day-column').forEach((column,index)=>{const titleNode=column.querySelector('.day-title');if(!titleNode||column.querySelector('.day-note'))return;const note=document.createElement('textarea');note.className='day-note';note.placeholder='曜日メモ';note.value=state.weekNotes[key][index]||'';note.setAttribute('aria-label',`${DAYS[index]}のメモ`);note.oninput=()=>{state.weekNotes[key][index]=note.value;resizeDayNote(note);save()};titleNode.insertAdjacentElement('afterend',note);resizeDayNote(note)})}
const renderWithWeeklyNotes=render;render=function(){renderWithWeeklyNotes();addWeeklyNotes()};
function syncHelperWeekDates(){if(helper==='all'||helperMode!=='week')return;const selected=helperWeekKey||currentWeekKey();document.querySelectorAll('#view-helpers .day-column').forEach((column,index)=>{const title=column.querySelector('.day-title'),small=title?.querySelector('small');if(!title||!small)return;const count=small.textContent;title.innerHTML=`${listWeekDateLabel(selected,index)}（${DAYS[index].charAt(0)}）<small>${count}</small>`;const key=`${selected}:${helper}:${index}`;if(state.helperDaysOff[key])title.insertAdjacentHTML('beforeend','<span class="day-off-label">休み</span>')})}
const renderWithSyncedHelperDates=render;render=function(){renderWithSyncedHelperDates();syncHelperWeekDates()};
function syncHelperHolidayToggle(){if(helper==='all'||helperMode!=='week')return;const button=document.querySelector('#view-helpers [data-helper-absence]');if(!button)return;const selectedWeek=helperWeekKey||currentWeekKey(),key=`${selectedWeek}:${helper}:${day}`;state.helperDaysOffBackups=state.helperDaysOffBackups||{};const isOff=!!state.helperDaysOff[key];button.textContent=isOff?'お休みを解除':'お休み';button.onclick=()=>{if(isOff){const backups=state.helperDaysOffBackups[key]||[];backups.forEach(saved=>{const service=state.services.find(s=>s.id===saved.id);if(service&&(!service.helperId||service.status==='unassigned')){service.helperId=saved.helperId;service.status=saved.status;service.managerName=saved.managerName||''}});delete state.helperDaysOff[key];delete state.helperDaysOffBackups[key];save();render();return}const targets=state.services.filter(s=>s.weekKey===selectedWeek&&s.helperId===helper&&s.day===day&&active(s));if(targets.length&&!confirm(`${hname(helper)}さんを${DAYS[day]}お休みにしますか？\n${targets.length}件の予定を未割当に変更します。`))return;state.helperDaysOff[key]=true;state.helperDaysOffBackups[key]=targets.map(s=>({id:s.id,helperId:s.helperId,status:s.status,managerName:s.managerName||''}));targets.forEach(s=>{s.helperId='';s.status='unassigned';s.managerName='' });save();render()}}
const renderWithHolidayToggle=render;render=function(){renderWithHolidayToggle();syncHelperHolidayToggle()};
document.addEventListener('click',e=>{const title=e.target.closest('#view-unassigned .day-title');if(!title)return;const column=title.closest('.day-column');if(!column)return;day=[...column.parentElement.children].indexOf(column);quickAddModal()},true);
document.addEventListener('click',e=>{const title=e.target.closest('#view-helpers .day-title');if(!title||helper==='all')return;const column=title.closest('.day-column');if(!column)return;day=[...column.parentElement.children].indexOf(column);if(helperMode==='default')defaultAddModal(helper);else quickAddModal(helper,helperWeekKey||currentWeekKey())},true);
document.addEventListener('click',e=>{const title=e.target.closest('#view-list .day-title');if(!title)return;const column=title.closest('.day-column');if(!column)return;day=[...column.parentElement.children].indexOf(column);if(listMode==='default')defaultAddModal('');else quickAddModal('',listWeekKey||currentWeekKey())},true);
function addCancelledHelperCards(){if(helper==='all'||helperMode!=='week')return;const selected=helperWeekKey||currentWeekKey();DAYS.forEach((name,index)=>{const column=document.querySelectorAll('#view-helpers .day-column')[index],cards=column?.querySelector('.cards');if(!cards)return;state.services.filter(s=>s.weekKey===selected&&s.day===index&&s.helperId===helper&&s.status==='cancelled').sort((a,b)=>a.startTime.localeCompare(b.startTime)).forEach(s=>{if(cards.querySelector(`[data-id="${s.id}"]`))return;cards.insertAdjacentHTML('beforeend',card(s))})});document.querySelectorAll('#view-helpers .service-card[data-id]').forEach(node=>{if(node.dataset.cancelBound)return;node.dataset.cancelBound='true';node.onclick=()=>modal(node.dataset.id)})}
const originalDefaultAddModal=defaultAddModal;defaultAddModal=function(helperId=''){originalDefaultAddModal(helperId);replaceClientInput('#defaultAddClient')};
function addWeeklyReflectButton(){const toolbar=document.querySelector('#view-unassigned .toolbar');if(!toolbar||toolbar.querySelector('[data-week-reflect]'))return;const button=document.createElement('button');button.type='button';button.className='button button-primary';button.dataset.weekReflect='';button.textContent='デフォルトをこの週へ反映';button.onclick=()=>{if(reflectDefaultToWeek(currentWeekKey()))render()};toolbar.appendChild(button)}
function removeWeeklyListMode(){const root=document.querySelector('#view-list');if(!root)return;root.querySelectorAll('[data-independent-week],[data-list-week],[data-list-week-move],[data-independent-show],[data-independent-reflect]').forEach(node=>node.remove());root.querySelector('.list-tabs')?.remove()}
const renderWithWeeklyTools=render;render=function(){listMode='default';listWeekKey='';renderWithWeeklyTools();addWeeklyReflectButton();removeWeeklyListMode()};
const renderWithCancelledHelperCards=render;render=function(){renderWithCancelledHelperCards();addCancelledHelperCards()};

// 「未割当サービス一覧」と「ヘルパー別」でデフォルト予定を共有しないための分離層。
// 既存の画面処理はそのまま利用し、ヘルパー別画面の操作中だけ専用配列へ接続します。
function withHelperDefaults(callback){
  const listDefaults=state.defaultServices;
  state.defaultServices=state.helperDefaultServices;
  try{return callback()}
  finally{
    state.helperDefaultServices=state.defaultServices;
    state.defaultServices=listDefaults;
  }
}
function isHelperDefaultView(){return helperMode==='default'&&!!document.querySelector('#view-helpers.active')}

const sharedRenderIndependentHelpers=renderIndependentHelpers;
renderIndependentHelpers=function(){return withHelperDefaults(()=>sharedRenderIndependentHelpers())};

const sharedReflectHelperDefaultToWeek=reflectHelperDefaultToWeek;
reflectHelperDefaultToWeek=function(key,helperId){return withHelperDefaults(()=>sharedReflectHelperDefaultToWeek(key,helperId))};

const sharedDefaultModal=defaultModal;
defaultModal=function(serviceId){
  return isHelperDefaultView()?withHelperDefaults(()=>sharedDefaultModal(serviceId)):sharedDefaultModal(serviceId);
};

const sharedDefaultQuickTimeEdit=defaultQuickTimeEdit;
defaultQuickTimeEdit=function(serviceId){
  return isHelperDefaultView()?withHelperDefaults(()=>sharedDefaultQuickTimeEdit(serviceId)):sharedDefaultQuickTimeEdit(serviceId);
};

const sharedDefaultAddModal=defaultAddModal;
defaultAddModal=function(helperId=''){
  sharedDefaultAddModal(helperId);
  if(!helperId)return;
  const saveButton=document.querySelector('#saveDefaultAdd');
  if(!saveButton)return;
  const sharedSave=saveButton.onclick;
  saveButton.onclick=()=>withHelperDefaults(()=>sharedSave());
};

// 時刻クリックは、表示中の画面に応じた専用データを編集します。
document.addEventListener('click',e=>{
  const time=e.target.closest('.default-time');
  if(!time)return;
  const cardNode=time.closest('.service-card');
  if(!cardNode)return;
  e.preventDefault();
  e.stopImmediatePropagation();
  defaultQuickTimeEdit(cardNode.dataset.helperCard||cardNode.dataset.id);
},true);

addCardDeleteButtons=function(){
  document.querySelectorAll('.service-card').forEach(cardNode=>{
    if(cardNode.querySelector('[data-card-delete]'))return;
    const button=document.createElement('button');
    button.type='button';button.className='card-delete';button.dataset.cardDelete='';
    const isHelperWeek=!!cardNode.closest('#view-helpers')&&helperMode==='week';
    button.setAttribute('aria-label',isHelperWeek?'担当を解除':'予定を削除');button.textContent='×';cardNode.appendChild(button);
    button.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      const isDefault=!!cardNode.querySelector('.default-time');
      const isHelperDefault=isDefault&&!!cardNode.closest('#view-helpers');
      const serviceId=cardNode.dataset.id||cardNode.dataset.helperCard;
      if(isHelperWeek){
        if(!confirm('このヘルパーの担当を解除し、週間スケジュールの未割当に戻しますか？'))return;
        const service=state.services.find(s=>s.id===serviceId);
        if(service){service.helperId='';service.status='unassigned';service.managerName=''}
        save();close();render();return;
      }
      if(!confirm('この予定を削除しますか？'))return;
      if(isHelperDefault)state.helperDefaultServices=state.helperDefaultServices.filter(s=>s.id!==serviceId);
      else if(isDefault)state.defaultServices=state.defaultServices.filter(s=>s.id!==serviceId);
      else state.services=state.services.filter(s=>s.id!==serviceId);
      save();close();render();
    };
  });
};

addMultiSelectTools=function(){
  ['#view-unassigned','#view-helpers','#view-list'].forEach(selector=>{
    const root=document.querySelector(selector);
    if(!root||!root.classList.contains('active'))return;
    const cards=[...root.querySelectorAll('.service-card')];
    if(!cards.length)return;
    cards.forEach(cardNode=>{
      if(cardNode.querySelector('[data-card-select]'))return;
      const checkbox=document.createElement('input');
      checkbox.type='checkbox';checkbox.className='card-select';checkbox.dataset.cardSelect='';
      checkbox.dataset.selectId=cardNode.dataset.id||cardNode.dataset.helperCard;
      checkbox.title='この予定を選択';checkbox.onclick=e=>e.stopPropagation();cardNode.appendChild(checkbox);
    });
    const toolbar=root.querySelector('.toolbar');
    if(!toolbar||toolbar.querySelector('[data-delete-selected]'))return;
    const button=document.createElement('button');
    button.type='button';button.className='button button-danger button-small';
    const isHelperWeek=root.id==='view-helpers'&&helperMode==='week';
    button.dataset.deleteSelected='';button.textContent=isHelperWeek?'選択した予定を未割当に戻す':'選択した予定を削除';
    button.onclick=()=>{
      const selected=[...root.querySelectorAll('[data-card-select]:checked')];
      if(!selected.length)return alert(isHelperWeek?'未割当に戻す予定を選択してください':'削除する予定を選択してください');
      if(!confirm(isHelperWeek?`選択した${selected.length}件の担当を解除し、週間スケジュールの未割当に戻しますか？`:`選択した${selected.length}件の予定を削除しますか？`))return;
      selected.forEach(check=>{
        const node=check.closest('.service-card'),isDefault=!!node.querySelector('.default-time');
        const isHelperDefault=isDefault&&!!node.closest('#view-helpers'),serviceId=check.dataset.selectId;
        if(isHelperWeek){const service=state.services.find(s=>s.id===serviceId);if(service){service.helperId='';service.status='unassigned';service.managerName=''}}
        else if(isHelperDefault)state.helperDefaultServices=state.helperDefaultServices.filter(s=>s.id!==serviceId);
        else if(isDefault)state.defaultServices=state.defaultServices.filter(s=>s.id!==serviceId);
        else state.services=state.services.filter(s=>s.id!==serviceId);
      });
      save();render();
    };
    toolbar.appendChild(button);
  });
};

// 利用者名の変更・削除判定にも、ヘルパー別のデフォルト予定を含めます。
document.addEventListener('submit',e=>{
  if(e.target.id!=='clientForm')return;
  const clientId=e.target.querySelector('#clientId')?.value;
  const client=state.clients.find(c=>c.id===clientId);
  const nextName=e.target.querySelector('#clientName')?.value.trim();
  if(client&&nextName)state.helperDefaultServices.forEach(s=>{if(s.clientName===client.name)s.clientName=nextName});
},true);
document.addEventListener('click',e=>{
  const clientDelete=e.target.closest('[data-client-del]');
  if(clientDelete){
    const client=state.clients.find(c=>c.id===clientDelete.dataset.clientDel);
    if(client&&state.helperDefaultServices.some(s=>s.clientName===client.name)){
      e.preventDefault();e.stopImmediatePropagation();alert('予定で使用中の利用者は削除できません');return;
    }
  }
  const helperDelete=e.target.closest('[data-del]');
  if(helperDelete&&state.helperDefaultServices.some(s=>s.helperId===helperDelete.dataset.del)){
    e.preventDefault();e.stopImmediatePropagation();alert('デフォルト予定があるため削除できません');
  }
},true);


// 予定カードは、左に2段の時間・中央に利用者・右に担当者を表示します。
function displayClockTime(value){return value?String(value).replace(/^0(?=\d:)/,''):'未定'}
function managerDisplayName(value){
  const name=String(value||'');
  return name==='サ責対応'?name:name.replace(/^サ責[・\s]*/,'');
}
function card(service){
  const statusClass=service.status==='assigned'?'assigned':service.status==='manager'?'manager':service.status==='changed'?'changed':service.status==='cancelled'?'cancelled':'';
  const overlapClass=hasDisplayOverlap(service)?' overlap':'';
  const person=service.helperId?hname(service.helperId):service.status==='manager'?managerDisplayName(service.managerName||'サ責対応'):'';
  const endTime=service.endTime?displayClockTime(service.endTime):'未定';
  return`<article class="service-card ${statusClass}${overlapClass}" data-id="${service.id}" tabindex="0"><div class="time"><span>${esc(displayClockTime(service.startTime))}</span><span>${esc(endTime)}</span></div><div class="service-card-main"><div class="client">${esc(service.clientName)}</div>${service.memo?`<div class="memo">${esc(service.memo)}</div>`:''}</div><div class="helper">${esc(person)}</div></article>`;
}

// 週間予定の利用者名は、一覧からの候補選択と自由入力の両方に対応します。
function makeClientNameInputEditable(selector,listId){
  const current=document.querySelector(selector);
  if(!current)return null;
  let input=current;
  if(current.tagName==='SELECT'){
    input=document.createElement('input');
    input.id=current.id;input.name=current.name;input.required=current.required;
    input.value=current.value||'';
    current.replaceWith(input);
  }
  input.type='text';input.setAttribute('list',listId);input.placeholder='一覧から選択、または名前を直接入力';input.autocomplete='off';
  let dataList=document.querySelector(`#${listId}`);
  if(!dataList){dataList=document.createElement('datalist');dataList.id=listId;input.insertAdjacentElement('afterend',dataList)}
  dataList.innerHTML=[...state.clients].sort((a,b)=>(a.reading||a.name).localeCompare(b.reading||b.name,'ja')).map(client=>`<option value="${esc(client.name)}"></option>`).join('');
  const label=input.closest('label');
  if(label&&!label.querySelector('.manual-client-hint'))label.insertAdjacentHTML('beforeend','<small class="history manual-client-hint">利用者一覧にない名前も入力できます</small>');
  return input;
}
const quickAddWithManualClientName=quickAddModal;
quickAddModal=function(...args){
  const result=quickAddWithManualClientName(...args);
  const input=makeClientNameInputEditable('#quickClient','quickClientCandidates');
  if(input)input.focus();
  return result;
};
const renderWithManualClientName=render;
render=function(){
  renderWithManualClientName();
  makeClientNameInputEditable('#serviceForm [name="clientName"]','serviceClientCandidates');
};

// localStorageの自動保存に加え、全データをJSONでバックアップ・復元します。
function backupFileTimestamp(){
  const now=new Date(),pad=value=>String(value).padStart(2,'0');
  return`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}
function isValidBackupState(data){
  return !!data&&typeof data==='object'&&!Array.isArray(data)&&Array.isArray(data.helpers)&&Array.isArray(data.services)&&data.helpers.every(helper=>helper&&typeof helper.id==='string'&&typeof helper.name==='string')&&data.services.every(service=>service&&typeof service.id==='string'&&typeof service.clientName==='string');
}
function downloadScheduleBackup(){
  const backup={format:'care-schedule-backup',version:1,exportedAt:new Date().toISOString(),data:state};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`介護スケジュール_${backupFileTimestamp()}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function restoreScheduleBackup(file){
  if(!file)return;
  if(file.size>20*1024*1024){alert('ファイルが大きすぎます。20MB以下のJSONファイルを選択してください。');return}
  try{
    const parsed=JSON.parse(await file.text());
    const restored=parsed&&parsed.format==='care-schedule-backup'?parsed.data:parsed;
    if(!isValidBackupState(restored))throw new Error('invalid backup');
    const helperCount=restored.helpers.length,serviceCount=restored.services.length;
    if(!confirm(`現在のデータをバックアップ内容で置き換えます。\n\nヘルパー：${helperCount}名\n予定：${serviceCount}件\n\n復元してよろしいですか？`))return;
    if(!await persistence.save(restored))return;
    state=restored;
    alert('バックアップを復元しました。画面を再読み込みします。');
    location.reload();
  }catch(error){
    alert('復元できませんでした。正しいバックアップJSONファイルを選択してください。');
  }
}
const backupDataButton=document.querySelector('#backupData'),restoreDataButton=document.querySelector('#restoreData'),restoreDataFile=document.querySelector('#restoreDataFile');
if(backupDataButton)backupDataButton.onclick=downloadScheduleBackup;
if(restoreDataButton&&restoreDataFile){
  restoreDataButton.onclick=()=>{restoreDataFile.value='';restoreDataFile.click()};
  restoreDataFile.onchange=()=>restoreScheduleBackup(restoreDataFile.files&&restoreDataFile.files[0]);
}

// 未割当の週間予定とヘルパーの週別予定を、利用者・曜日・時間で照合して1件にまとめます。
function sameWeekService(service,template,weekKey){
  return service.weekKey===weekKey&&active(service)&&service.day===template.day&&
    service.startTime===template.startTime&&service.endTime===template.endTime&&
    service.clientName===template.clientName;
}
function copyScheduleFields(target,template){
  target.day=template.day;
  target.startTime=template.startTime;
  target.endTime=template.endTime;
  target.clientName=template.clientName;
  if(template.memo)target.memo=template.memo;
}
function removeMergedService(serviceId){
  state.services=state.services.filter(service=>service.id!==serviceId);
}

reflectDefaultToWeek=function(weekKey){
  const templates=state.defaultServices||[];
  let added=0,updated=0,linked=0;
  templates.forEach(template=>{
    const listTemplateId=template.templateId||template.id;
    const listLinked=state.services.find(service=>service.weekKey===weekKey&&
      (service.listTemplateId===listTemplateId||service.templateId===listTemplateId));
    const assignedMatch=state.services.find(service=>sameWeekService(service,template,weekKey)&&!!service.helperId);
    let target=listLinked||assignedMatch;

    // 旧仕様で作られた未割当と割当済みの重複は、未割当側のIDを残して統合します。
    if(listLinked&&assignedMatch&&listLinked.id!==assignedMatch.id){
      listLinked.helperId=assignedMatch.helperId;
      listLinked.status=assignedMatch.status;
      listLinked.managerName=assignedMatch.managerName||'';
      listLinked.helperTemplateId=assignedMatch.helperTemplateId||assignedMatch.templateId;
      removeMergedService(assignedMatch.id);
      target=listLinked;linked++;
    }

    if(target){
      const assignment={helperId:target.helperId,status:target.status,managerName:target.managerName||''};
      copyScheduleFields(target,template);
      target.weekKey=weekKey;
      target.listTemplateId=listTemplateId;
      // 担当決定済みの予定を、未割当に戻さないようにします。
      if(assignment.helperId||assignment.status==='manager')Object.assign(target,assignment);
      else{
        target.helperId=template.helperId||'';
        target.status=template.status||'unassigned';
        target.managerName=template.managerName||'';
      }
      updated++;return;
    }

    const copy=JSON.parse(JSON.stringify(template));
    copy.id=id('s');copy.weekKey=weekKey;copy.listTemplateId=listTemplateId;
    state.services.push(copy);added++;
  });
  save();
  alert(linked?`${weekText(weekKey)}へ反映し、重複していた${linked}件を担当予定とリンクしました`:
    added||updated?`${weekText(weekKey)}へ${added}件を追加、${updated}件を更新しました`:'この週には反映済みです');
  return true;
};

reflectHelperDefaultToWeek=function(weekKey,helperId){
  const templates=(state.helperDefaultServices||[]).filter(service=>service.helperId===helperId);
  const conflicts=[];
  templates.forEach(template=>{
    const helperTemplateId=template.templateId||template.id;
    state.services.filter(service=>service.weekKey===weekKey&&active(service)&&
      service.helperId===helperId&&service.day===template.day&&overlap(template,service)&&
      service.helperTemplateId!==helperTemplateId&&service.templateId!==helperTemplateId&&
      !sameWeekService(service,template,weekKey)).forEach(service=>conflicts.push({template,service}));
  });
  if(conflicts.length){
    const details=conflicts.map(item=>`・${item.template.clientName} ${item.template.startTime}〜${item.template.endTime} ↔ ${item.service.clientName} ${item.service.startTime}〜${item.service.endTime}`).join('\n');
    if(!confirm(`${hname(helperId)}さんのデフォルト反映で、以下の予定が重複します。\n\n${details}\n\n重複した予定をそのまま反映しますか？`))return false;
  }

  let linkedCount=0;
  templates.forEach(template=>{
    const helperTemplateId=template.templateId||template.id;
    const helperLinked=state.services.find(service=>service.weekKey===weekKey&&
      (service.helperTemplateId===helperTemplateId||service.templateId===helperTemplateId));
    const unassignedMatch=state.services.find(service=>sameWeekService(service,template,weekKey)&&
      !service.helperId&&(service.status==='unassigned'||service.status==='changed'));
    let target=unassignedMatch||helperLinked;

    // 既に別々に存在する場合は、週間画面側の予定を残してヘルパー予定を統合します。
    if(unassignedMatch&&helperLinked&&unassignedMatch.id!==helperLinked.id){
      unassignedMatch.listTemplateId=unassignedMatch.listTemplateId||helperLinked.listTemplateId;
      removeMergedService(helperLinked.id);
      target=unassignedMatch;
    }

    if(!target){
      target=JSON.parse(JSON.stringify(template));
      target.id=id('s');target.weekKey=weekKey;
      state.services.push(target);
    }else copyScheduleFields(target,template);

    target.weekKey=weekKey;
    target.helperId=helperId;
    target.status='assigned';
    target.managerName='';
    target.helperTemplateId=helperTemplateId;
    if(unassignedMatch)linkedCount++;
  });
  save();
  if(linkedCount)alert(`${hname(helperId)}さんを${linkedCount}件の未割当予定にリンクしました`);
  return true;
};

// ヘルパー週別画面の詳細から外す場合も、サービスは削除せず未割当に戻します。
const modalBeforeHelperWeekUnassign=modal;
modal=function(...args){
  modalBeforeHelperWeekUnassign(...args);
  if(!document.querySelector('#view-helpers.active')||helperMode!=='week')return;
  const deleteButton=document.querySelector('#serviceModalBody [data-delete-service]');
  if(deleteButton)deleteButton.textContent='このヘルパーの担当を解除';
};
document.addEventListener('click',e=>{
  const deleteButton=e.target.closest('[data-delete-service]');
  if(!deleteButton||!document.querySelector('#view-helpers.active')||helperMode!=='week')return;
  e.preventDefault();e.stopImmediatePropagation();
  const service=state.services.find(item=>item.id===openId);
  if(!service)return;
  if(!confirm('このヘルパーの担当を解除し、週間スケジュールの未割当に戻しますか？'))return;
  service.helperId='';service.status='unassigned';service.managerName='';
  save();close();render();
},true);

// 同じヘルパーの時間が重なっても担当を外さず、カードの重複表示（紫）で知らせます。
assign=function(helperId){
  const service=state.services.find(item=>item.id===openId);
  if(!service)return;
  if(conflict(service,helperId)&&!confirm('同じ時間帯に別の予定があります。重複予定として割り当てますか？'))return;
  service.helperId=helperId;
  service.status='assigned';
  service.managerName='';
  save();close();render();
};

const quickAddBeforeOverlapSupport=quickAddModal;
quickAddModal=function(helperId='',targetWeek=currentWeekKey()){
  quickAddBeforeOverlapSupport(helperId,targetWeek);
  const saveButton=document.querySelector('#saveQuickService');
  if(!saveButton)return;
  saveButton.onclick=()=>{
    const client=document.querySelector('#quickClient').value.trim();
    const startTime=document.querySelector('#quickStart').value;
    const endTime=document.querySelector('#quickEnd').value;
    const message=timeRangeMessage(startTime,endTime);
    if(!client||message){if(message)alert(message);return}
    const selectedHelper=document.querySelector('#quickHelper').value;
    const service={
      id:id('s'),weekKey:targetWeek,day:Number(document.querySelector('#quickDay').value),
      startTime,endTime,clientName:client,
      helperId:selectedHelper==='manager'?'':selectedHelper,
      memo:document.querySelector('#quickMemo').value,
      status:selectedHelper==='manager'?'manager':selectedHelper?'assigned':'unassigned',
      managerName:selectedHelper==='manager'?'サ責対応':''
    };
    state.services.push(service);save();close();render();
  };
};

quickTimeEdit=function(serviceId){
  const service=findService(serviceId,'week');
  if(!service)return;
  openId=serviceId;openSource='week';
  document.querySelector('#serviceModalTitle').textContent=`時間変更：${service.clientName}`;
  document.querySelector('#serviceModalBody').innerHTML=`<div class="detail"><div class="detail-box"><p class="history">5分刻みで選択できます。重複した場合は紫色で表示されます。</p><div class="form-grid"><label>開始時間<select id="cardEditStart">${timeOptions(service.startTime)}</select></label><label>終了時間<select id="cardEditEnd">${timeOptions(service.endTime)}</select></label></div><div class="form-actions"><button class="button button-primary" id="saveCardTimeKeepOverlap">保存</button><button class="button button-light" data-close-card-time>キャンセル</button></div></div></div>`;
  document.querySelector('#serviceModalBackdrop').classList.remove('hidden');
  document.querySelector('[data-close-card-time]').onclick=close;
  document.querySelector('#saveCardTimeKeepOverlap').onclick=()=>{
    const startTime=document.querySelector('#cardEditStart').value;
    const endTime=document.querySelector('#cardEditEnd').value;
    const message=timeRangeMessage(startTime,endTime);
    if(message){alert(message);return}
    service.startTime=startTime;service.endTime=endTime;
    save();close();render();
  };
};

changeTime=function(){
  const service=state.services.find(item=>item.id===openId);
  const box=document.querySelector('#serviceModalBody .detail');
  if(!service||!box)return;
  box.insertAdjacentHTML('beforeend',`<div class="detail-box"><h3>時間変更</h3><p class="history">5分刻みで選択できます。担当ヘルパーの予定と重複した場合は紫色で表示されます。</p><div class="form-grid"><label>開始時間<select id="editStartTime">${timeOptions(service.startTime)}</select></label><label>終了時間<select id="editEndTime">${timeOptions(service.endTime)}</select></label></div><div class="form-actions"><button class="button button-primary" id="saveChangedTimeKeepOverlap">変更を保存</button></div></div>`);
  document.querySelector('#saveChangedTimeKeepOverlap').onclick=()=>{
    const startTime=document.querySelector('#editStartTime').value;
    const endTime=document.querySelector('#editEndTime').value;
    const message=timeRangeMessage(startTime,endTime);
    if(message){alert(message);return}
    service.originalStartTime=service.originalStartTime||service.startTime;
    service.originalEndTime=service.originalEndTime||service.endTime;
    service.startTime=startTime;service.endTime=endTime;
    service.status=service.helperId?'assigned':'changed';
    save();close();render();modal(service.id);
  };
};

// 各画面の週別予定追加ボタンは使用しないため表示しません。
function removeWeeklyAddButtons(){
  document.querySelectorAll('[data-open-register]').forEach(button=>button.remove());
}
const renderWithoutWeeklyAddButtons=render;
render=function(){
  renderWithoutWeeklyAddButtons();
  removeWeeklyAddButtons();
};

// 未定は空文字で保存します。開始未定は表示範囲の先頭、両方未定は終日として扱います。
function timeToMinutes(value){
  if(!value)return NaN;
  const [hours,minutes]=value.split(':').map(Number);
  return hours*60+minutes;
}
function effectiveStartMinutes(service){
  return service.startTime?timeToMinutes(service.startTime):420;
}
function effectiveEndMinutes(service){
  const start=effectiveStartMinutes(service);
  return service.endTime?timeToMinutes(service.endTime):service.startTime?start+180:1320;
}
overlap=function(first,second){
  const firstStart=effectiveStartMinutes(first),secondStart=effectiveStartMinutes(second);
  return firstStart<effectiveEndMinutes(second)&&secondStart<effectiveEndMinutes(first);
};
timeRangeMessage=function(startTime,endTime){
  if(startTime&&!validServiceTime(startTime))return'開始時間は07:00〜19:00の範囲で、5分刻みで入力してください。';
  if(!endTime)return'';
  if(!validServiceTime(endTime))return'終了時間は07:00〜19:00の範囲で、5分刻みで入力してください。';
  if(startTime&&startTime>=endTime)return'終了時間は開始時間より後にしてください';
  return'';
};
function endTimeOptions(startTime,selected=''){
  const startMinutes=timeToMinutes(startTime);
  let html=`<option value="" ${selected===''?'selected':''}>未定</option>`;
  for(let total=420;total<=1140;total+=5){
    if(total<=startMinutes)continue;
    const value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
    html+=`<option value="${value}" ${value===selected?'selected':''}>${displayClockTime(value)}</option>`;
  }
  return html;
}
const timePairSelectors=[
  ['#serviceForm [name="startTime"]','#serviceForm [name="endTime"]'],
  ['#quickStart','#quickEnd'],['#defaultAddStart','#defaultAddEnd'],
  ['#defaultEditStart','#defaultEditEnd'],['#cardEditStart','#cardEditEnd'],
  ['#editStartTime','#editEndTime'],['#defaultCardStart','#defaultCardEnd']
];
function refreshEndTimeSelects(changedStart=null){
  timePairSelectors.forEach(([startSelector,endSelector])=>{
    const start=document.querySelector(startSelector),end=document.querySelector(endSelector);
    if(!start||!end||(changedStart&&start!==changedStart))return;
    const selected=end.value||'';
    start.required=false;
    end.required=false;
    end.innerHTML=endTimeOptions(start.value,selected);
  });
}
document.addEventListener('change',e=>{
  if(timePairSelectors.some(([startSelector])=>e.target.matches(startSelector)))refreshEndTimeSelects(e.target);
});

const defaultModalBeforeEndOptions=defaultModal;
defaultModal=function(...args){const result=defaultModalBeforeEndOptions(...args);refreshEndTimeSelects();return result};
const defaultQuickTimeBeforeEndOptions=defaultQuickTimeEdit;
defaultQuickTimeEdit=function(...args){const result=defaultQuickTimeBeforeEndOptions(...args);refreshEndTimeSelects();return result};
const defaultAddBeforeEndOptions=defaultAddModal;
defaultAddModal=function(...args){const result=defaultAddBeforeEndOptions(...args);refreshEndTimeSelects();return result};
const quickAddBeforeEndOptions=quickAddModal;
quickAddModal=function(...args){const result=quickAddBeforeEndOptions(...args);refreshEndTimeSelects();return result};
const quickTimeBeforeEndOptions=quickTimeEdit;
quickTimeEdit=function(...args){const result=quickTimeBeforeEndOptions(...args);refreshEndTimeSelects();return result};
const changeTimeBeforeEndOptions=changeTime;
changeTime=function(...args){const result=changeTimeBeforeEndOptions(...args);refreshEndTimeSelects();return result};

const renderWithEndTimeOptions=render;
render=function(){renderWithEndTimeOptions();refreshEndTimeSelects()};

// 中止予定を追加した後も開始時間順に並べ、元の表示位置を維持します。
const addCancelledHelperCardsBeforeSort=addCancelledHelperCards;
addCancelledHelperCards=function(){
  addCancelledHelperCardsBeforeSort();
  if(helper==='all'||helperMode!=='week')return;
  document.querySelectorAll('#view-helpers .cards').forEach(cards=>{
    const serviceCards=[...cards.querySelectorAll('.service-card')];
    if(!serviceCards.length)return;
    cards.querySelectorAll('.empty').forEach(empty=>empty.remove());
    serviceCards.sort((first,second)=>{
      const firstService=state.services.find(service=>service.id===(first.dataset.id||first.dataset.helperCard));
      const secondService=state.services.find(service=>service.id===(second.dataset.id||second.dataset.helperCard));
      return (firstService?.startTime||'').localeCompare(secondService?.startTime||'');
    }).forEach(cardNode=>cards.appendChild(cardNode));
  });
};

// 休み設定で未割当になった予定は、ヘルパー週別画面に参照用カードとして残します。
function addDayOffReferenceCards(){
  if(helper==='all'||helperMode!=='week')return;
  const selectedWeek=helperWeekKey||currentWeekKey();
  DAYS.forEach((name,index)=>{
    const dayOffKey=`${selectedWeek}:${helper}:${index}`;
    if(!state.helperDaysOff[dayOffKey])return;
    const cards=document.querySelectorAll('#view-helpers .day-column')[index]?.querySelector('.cards');
    if(!cards)return;
    const backups=state.helperDaysOffBackups?.[dayOffKey]||[];
    backups.forEach(saved=>{
      const service=state.services.find(item=>item.id===saved.id);
      if(!service||cards.querySelector(`.day-off-service[data-id="${service.id}"]`))return;
      const reference={...service,helperId:saved.helperId||helper,status:saved.status||'assigned',managerName:saved.managerName||''};
      const html=card(reference)
        .replace('class="service-card ','class="service-card day-off-service ')
        .replace('tabindex="0"','tabindex="-1"')
        .replace('</article>','<div class="day-off-service-label">休みのため未割当</div></article>');
      cards.insertAdjacentHTML('beforeend',html);
    });
    const serviceCards=[...cards.querySelectorAll('.service-card')];
    if(serviceCards.length){
      cards.querySelectorAll('.empty').forEach(empty=>empty.remove());
      serviceCards.sort((first,second)=>{
        const firstService=state.services.find(service=>service.id===(first.dataset.id||first.dataset.helperCard));
        const secondService=state.services.find(service=>service.id===(second.dataset.id||second.dataset.helperCard));
        return (firstService?.startTime||'').localeCompare(secondService?.startTime||'');
      }).forEach(cardNode=>cards.appendChild(cardNode));
    }
  });
}
const renderWithDayOffReferences=render;
render=function(){renderWithDayOffReferences();addDayOffReferenceCards()};

// 「全員」タブは、縦軸を時間、横軸をヘルパーにした日別タイムラインで表示します。
function allHelperScheduleCard(item,columnIndex,columnCount){
  const {service,isDayOffReference}=item;
  const start=Math.max(420,effectiveStartMinutes(service));
  const end=Math.min(1320,effectiveEndMinutes(service));
  const top=Math.max(0,start-420),height=Math.max(24,end-start);
  const statusClass=isDayOffReference?' day-off-reference':service.status==='cancelled'?' cancelled':'';
  const overlapClass=columnCount>1&&!isDayOffReference?' overlap':'';
  const left=`calc(${columnIndex} * (100% / ${columnCount}) + 3px)`;
  const width=`calc(100% / ${columnCount} - 6px)`;
  const endText=service.endTime?displayClockTime(service.endTime):'未定';
  return`<div class="all-helper-card${statusClass}${overlapClass}" style="top:${top}px;height:${height}px;left:${left};width:${width}"><div class="all-helper-time">${displayClockTime(service.startTime)}～${endText}</div><div class="all-helper-client">${esc(service.clientName)}</div>${service.memo?`<div class="all-helper-memo">${esc(service.memo)}</div>`:''}${isDayOffReference?'<div class="all-helper-state">休みのため未割当</div>':service.status==='cancelled'?'<div class="all-helper-state">サービス中止</div>':''}</div>`;
}
function allHelperDayItems(helperId,dayIndex,weekKey){
  const normal=state.services.filter(service=>service.weekKey===weekKey&&service.helperId===helperId&&service.day===dayIndex);
  const dayOffKey=`${weekKey}:${helperId}:${dayIndex}`;
  const references=(state.helperDaysOffBackups?.[dayOffKey]||[]).map(saved=>state.services.find(service=>service.id===saved.id)).filter(Boolean);
  const normalIds=new Set(normal.map(service=>service.id));
  return[
    ...normal.map(service=>({service,isDayOffReference:false})),
    ...references.filter(service=>!normalIds.has(service.id)).map(service=>({service,isDayOffReference:true}))
  ].sort((first,second)=>first.service.startTime.localeCompare(second.service.startTime));
}
function layoutAllHelperItems(items){
  const columnEnds=[];
  const laidOut=items.map(item=>{
    const start=effectiveStartMinutes(item.service);
    const end=effectiveEndMinutes(item.service);
    let columnIndex=columnEnds.findIndex(columnEnd=>start>=columnEnd);
    if(columnIndex<0)columnIndex=columnEnds.length;
    columnEnds[columnIndex]=end;
    return{...item,columnIndex};
  });
  const columnCount=Math.max(1,columnEnds.length);
  return laidOut.map(item=>({...item,columnCount}));
}
function allHelperTimeAxis(scale=1){
  let html='';
  for(let total=420;total<=1320;total+=60){
    const label=String(Math.floor(total/60))+':00';
    html+=`<div class="all-helper-hour" style="top:${(total-420)*scale}px">${label}</div>`;
  }
  return html;
}
function renderAllHelpersOverview(){
  const root=document.querySelector('#view-helpers');
  if(!root)return;
  const selectedWeek=helperWeekKey||currentWeekKey();
  helperMode='week';helperWeekKey=selectedWeek;
  const dayButtons=DAYS.map((name,index)=>`<button type="button" class="button button-small ${day===index?'button-primary':'button-light'}" data-all-helper-day="${index}">${listWeekDateLabel(selectedWeek,index)}（${name.charAt(0)}）</button>`).join('');
  const helperHeaders=state.helpers.map(helperItem=>`<div class="all-helper-head">${esc(helperItem.name)}</div>`).join('');
  const lanes=state.helpers.map(helperItem=>{
    const dayOffKey=`${selectedWeek}:${helperItem.id}:${day}`;
    const isDayOff=!!state.helperDaysOff[dayOffKey];
    const items=layoutAllHelperItems(allHelperDayItems(helperItem.id,day,selectedWeek));
    return`<div class="all-helper-lane ${isDayOff?'is-day-off':''}">${isDayOff?'<div class="all-helper-day-off">休み</div>':''}${items.map(item=>allHelperScheduleCard(item,item.columnIndex,item.columnCount)).join('')}</div>`;
  }).join('');
  const legend='<div class="all-helper-legend"><span class="legend-free">空き時間</span><span class="legend-scheduled">予定あり</span><span class="legend-overlap">重複</span><span class="legend-day-off">休み</span><span class="legend-cancelled">中止</span></div>';
  root.innerHTML=`<div class="toolbar"><div><h2>全ヘルパー予定・空き時間</h2><div class="history">${weekText(selectedWeek)}</div></div><div class="week-controls"><button class="button button-light button-small" data-all-helper-week-move="-1">＜ 前週</button><button class="button button-light button-small" data-all-helper-week-move="1">次週 ＞</button></div><label class="helper-picker">ヘルパー<select id="helperIndependentSelect">${state.helpers.map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('')}<option value="all" selected>全員</option></select></label></div><div class="all-helper-day-buttons">${dayButtons}</div>${legend}<div class="all-helper-wrap"><div class="all-helper-grid" style="--helper-count:${Math.max(1,state.helpers.length)};min-width:${70+Math.max(1,state.helpers.length)*180}px"><div class="all-helper-corner">時間</div>${helperHeaders}<div class="all-helper-time-axis">${allHelperTimeAxis()}</div>${lanes||'<div class="all-helper-empty all-helper-no-staff">ヘルパーが登録されていません</div>'}</div></div>`;
  root.querySelector('[data-all-helper-week-move="-1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)-1);render()};
  root.querySelector('[data-all-helper-week-move="1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)+1);render()};
  root.querySelectorAll('[data-all-helper-day]').forEach(button=>button.onclick=()=>{day=Number(button.dataset.allHelperDay);render()});
}
const renderIndependentHelpersBeforeAllOverview=renderIndependentHelpers;
renderIndependentHelpers=function(){
  if(helper==='all')return renderAllHelpersOverview();
  return renderIndependentHelpersBeforeAllOverview();
};

// カード単位の削除ボタンは廃止し、複数選択からの削除に統一します。
addCardDeleteButtons=function(){
  document.querySelectorAll('[data-card-delete]').forEach(button=>button.remove());
};
document.querySelectorAll('[data-card-delete]').forEach(button=>button.remove());

// 週間スケジュールを表示したまま、全ヘルパーの空き時間を確認するフローティングパネル。
let availabilityPopupDay=0;
function availabilityTimeLabel(total){
  return`${String(Math.floor(total/60))}:${String(total%60).padStart(2,'0')}`;
}
function helperBusyIntervals(helperId,dayIndex,weekKey){
  return state.services.filter(service=>service.weekKey===weekKey&&service.day===dayIndex&&service.helperId===helperId&&active(service)).map(service=>({
    start:Math.max(420,effectiveStartMinutes(service)),
    end:Math.min(1320,effectiveEndMinutes(service)),service
  })).filter(interval=>interval.end>interval.start).sort((first,second)=>first.start-second.start);
}
function mergeBusyIntervals(intervals){
  const merged=[];
  intervals.forEach(interval=>{
    const last=merged[merged.length-1];
    if(last&&interval.start<=last.end)last.end=Math.max(last.end,interval.end);
    else merged.push({start:interval.start,end:interval.end});
  });
  return merged;
}
function freeIntervalsFromBusy(intervals){
  const free=[];
  let cursor=420;
  mergeBusyIntervals(intervals).forEach(interval=>{
    if(interval.start>cursor)free.push({start:cursor,end:interval.start});
    cursor=Math.max(cursor,interval.end);
  });
  if(cursor<1320)free.push({start:cursor,end:1320});
  return free;
}
function ensureAvailabilityPopup(){
  let popup=document.querySelector('#availabilityPopup');
  if(popup)return popup;
  popup=document.createElement('aside');
  popup.id='availabilityPopup';popup.className='availability-popup';
  document.body.appendChild(popup);
  return popup;
}
function renderAvailabilityPopup(){
  const popup=ensureAvailabilityPopup();
  if(!popup.classList.contains('is-open'))return;
  const weekKey=currentWeekKey();
  const dayButtons=DAYS.map((name,index)=>`<button type="button" class="button button-small ${availabilityPopupDay===index?'button-primary':'button-light'}" data-availability-day="${index}">${dateLabel(index)}（${name.charAt(0)}）</button>`).join('');
  const rows=state.helpers.map(helperItem=>{
    const dayOffKey=`${weekKey}:${helperItem.id}:${availabilityPopupDay}`;
    const isDayOff=!!state.helperDaysOff[dayOffKey];
    const busy=helperBusyIntervals(helperItem.id,availabilityPopupDay,weekKey);
    const free=isDayOff?[]:freeIntervalsFromBusy(busy);
    const blocks=busy.map(interval=>{
      const left=(interval.start-420)/900*100,width=(interval.end-interval.start)/900*100;
      const overlapClass=hasDisplayOverlap(interval.service)?' is-overlap':'';
      return`<span class="availability-busy${overlapClass}" style="left:${left}%;width:${width}%" title="${esc(interval.service.clientName)} ${displayClockTime(interval.service.startTime)}～${displayClockTime(interval.service.endTime)}"></span>`;
    }).join('');
    const freeText=isDayOff?'<span class="availability-off-text">休み</span>':free.map(interval=>`<span class="availability-free-chip">${availabilityTimeLabel(interval.start)}～${availabilityTimeLabel(interval.end)}</span>`).join('')||'<span class="availability-none">空きなし</span>';
    return`<div class="availability-row"><div class="availability-helper-name">${esc(helperItem.name)}</div><div class="availability-row-body"><div class="availability-bar ${isDayOff?'is-day-off':''}">${blocks}</div><div class="availability-free-list">${freeText}</div></div></div>`;
  }).join('')||'<div class="empty">ヘルパーが登録されていません</div>';
  popup.innerHTML=`<div class="availability-popup-header"><div><strong>ヘルパー空き時間</strong><small>${weekText(weekKey)}</small></div><button type="button" class="icon-button" data-close-availability aria-label="閉じる">×</button></div><div class="availability-day-buttons">${dayButtons}</div><div class="availability-axis"><span>7:00</span><span>10:00</span><span>13:00</span><span>16:00</span><span>19:00</span><span>22:00</span></div><div class="availability-rows">${rows}</div><div class="availability-popup-legend"><span class="free">空き</span><span class="busy">予定あり</span><span class="overlap">重複</span><span class="off">休み</span></div>`;
  popup.querySelector('[data-close-availability]').onclick=()=>popup.classList.remove('is-open');
  popup.querySelectorAll('[data-availability-day]').forEach(button=>button.onclick=()=>{availabilityPopupDay=Number(button.dataset.availabilityDay);renderAvailabilityPopup()});
}
function openAvailabilityPopup(){
  availabilityPopupDay=day;
  const popup=ensureAvailabilityPopup();
  popup.classList.add('is-open');
  renderAvailabilityPopup();
}
function addAvailabilityPopupButton(){
  const popup=ensureAvailabilityPopup();
  if(view!=='unassigned'){
    popup.classList.remove('is-open');return;
  }
  const toolbar=document.querySelector('#view-unassigned .toolbar');
  if(toolbar&&!toolbar.querySelector('[data-open-availability]')){
    const button=document.createElement('button');
    button.type='button';button.className='button button-primary';
    button.dataset.openAvailability='';button.textContent='ヘルパー空き時間';
    button.onclick=openAvailabilityPopup;toolbar.appendChild(button);
  }
  renderAvailabilityPopup();
}
const renderWithAvailabilityPopup=render;
render=function(){renderWithAvailabilityPopup();addAvailabilityPopupButton()};

// 利用者情報は、名前に加えて読み仮名・住所・電話番号を保持します。
let clientDetailsMigrated=false;
state.clients.forEach(client=>{
  if(typeof client.reading!=='string'){client.reading='';clientDetailsMigrated=true}
  if(typeof client.address!=='string'){client.address='';clientDetailsMigrated=true}
  if(typeof client.phone!=='string'){client.phone='';clientDetailsMigrated=true}
});
if(clientDetailsMigrated)save();

function normalizeClientReading(value){
  return String(value||'').trim().replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
}
function isKanaReading(value){return /^[ぁ-ゖァ-ヶー\s]+$/.test(String(value||'').trim())}
function knownClientReading(name){
  const readings={山田:'やまだ',佐々木:'ささき',高橋:'たかはし',佐藤:'さとう',鈴木:'すずき',田中:'たなか',伊藤:'いとう',渡辺:'わたなべ',中村:'なかむら',小林:'こばやし',加藤:'かとう',吉田:'よしだ',松本:'まつもと',井上:'いのうえ',木村:'きむら',林:'はやし',清水:'しみず',山口:'やまぐち',阿部:'あべ',池田:'いけだ',橋本:'はしもと',石川:'いしかわ',前田:'まえだ',藤田:'ふじた',後藤:'ごとう',岡田:'おかだ',長谷川:'はせがわ',村上:'むらかみ',近藤:'こんどう',石井:'いしい',斎藤:'さいとう',坂本:'さかもと',遠藤:'えんどう',青木:'あおき',藤井:'ふじい',西村:'にしむら',福田:'ふくだ',太田:'おおた',三浦:'みうら',藤原:'ふじわら',岡本:'おかもと',松田:'まつだ',中川:'なかがわ',中野:'なかの',原田:'はらだ',小川:'おがわ',竹内:'たけうち',金子:'かねこ',和田:'わだ',中島:'なかじま'};
  let value=String(name||'').trim(),suffix='';
  if(value.endsWith('様')){value=value.slice(0,-1);suffix='さま'}
  else if(value.endsWith('さん')){value=value.slice(0,-2);suffix='さん'}
  if(isKanaReading(value))return normalizeClientReading(value)+suffix;
  return readings[value]?readings[value]+suffix:'';
}

function renderClients(){
  const root=document.querySelector('#view-clients');
  if(!root)return;
  const sortedClients=[...state.clients].sort((a,b)=>(a.reading||a.name).localeCompare(b.reading||b.name,'ja',{sensitivity:'base',numeric:true})||a.name.localeCompare(b.name,'ja',{sensitivity:'base',numeric:true}));
  const cards=sortedClients.map(client=>`<article class="client-card"><div class="client-card-info"><strong>${esc(client.name)}</strong><dl><div><dt>読み仮名</dt><dd>${client.reading?esc(client.reading):'<span class="client-empty-value">未登録（名前順で表示）</span>'}</dd></div><div><dt>住所</dt><dd>${client.address?esc(client.address):'<span class="client-empty-value">未登録</span>'}</dd></div><div><dt>電話番号</dt><dd>${client.phone?esc(client.phone):'<span class="client-empty-value">未登録</span>'}</dd></div></dl></div><div class="client-card-actions"><button type="button" class="button button-light button-small" data-client-edit="${client.id}">編集</button><button type="button" class="button button-danger button-small" data-client-del="${client.id}">削除</button></div></article>`).join('');
  root.innerHTML=`<div class="toolbar"><h2>利用者一覧</h2><span class="notice">読み仮名のあいうえお順で表示します。</span></div><form id="clientForm" class="client-form"><input type="hidden" id="clientId"><div class="client-form-grid"><label>利用者名<input id="clientName" required placeholder="例：山田様"></label><label>読み仮名<input id="clientReading" placeholder="例：やまださま"></label><label>住所<input id="clientAddress" placeholder="例：東京都○○区1-2-3"></label><label>電話番号<input id="clientPhone" type="tel" inputmode="tel" placeholder="例：090-1234-5678"></label></div><div class="form-actions"><button class="button button-primary">追加・保存</button><button type="button" class="button button-light hidden" id="clientCancelEdit">キャンセル</button></div></form><div class="client-card-list">${cards||'<div class="empty">利用者が登録されていません</div>'}</div>`;
  const form=root.querySelector('#clientForm');
  const idInput=root.querySelector('#clientId');
  const nameInput=root.querySelector('#clientName');
  const readingInput=root.querySelector('#clientReading');
  const addressInput=root.querySelector('#clientAddress');
  const phoneInput=root.querySelector('#clientPhone');
  const cancel=root.querySelector('#clientCancelEdit');
  let readingWasEdited=false,imeReadingParts=[],pendingImeReading='';
  const setAutomaticReading=value=>{if(!readingWasEdited&&value)readingInput.value=normalizeClientReading(value)};
  nameInput.addEventListener('compositionstart',()=>{pendingImeReading=''});
  nameInput.addEventListener('compositionupdate',event=>{if(isKanaReading(event.data))pendingImeReading=normalizeClientReading(event.data)});
  nameInput.addEventListener('compositionend',event=>{
    const part=pendingImeReading||(isKanaReading(event.data)?normalizeClientReading(event.data):'');
    if(part&&!readingWasEdited){imeReadingParts.push(part);setAutomaticReading(imeReadingParts.join(''))}
    pendingImeReading='';
  });
  nameInput.addEventListener('input',event=>{
    if(!nameInput.value){imeReadingParts=[];if(!readingWasEdited)readingInput.value='';return}
    if(event.isComposing)return;
    const guessed=knownClientReading(nameInput.value);
    if(guessed)setAutomaticReading(guessed);
  });
  readingInput.addEventListener('input',()=>{readingWasEdited=true});
  root.querySelectorAll('[data-client-edit]').forEach(button=>button.onclick=()=>{
    const client=state.clients.find(item=>item.id===button.dataset.clientEdit);
    if(!client)return;
    idInput.value=client.id;nameInput.value=client.name;readingInput.value=client.reading||'';
    addressInput.value=client.address||'';phoneInput.value=client.phone||'';
    readingWasEdited=!!client.reading;imeReadingParts=[];
    cancel.classList.remove('hidden');nameInput.focus();
  });
  cancel.onclick=()=>{form.reset();idInput.value='';readingWasEdited=false;imeReadingParts=[];cancel.classList.add('hidden')};
  form.onsubmit=e=>{
    e.preventDefault();
    const name=nameInput.value.trim(),reading=readingInput.value.trim(),address=addressInput.value.trim(),phone=phoneInput.value.trim(),existingId=idInput.value;
    if(!name)return;
    if(state.clients.some(client=>client.name===name&&client.id!==existingId))return alert('同じ名前の利用者がすでに登録されています');
    if(existingId){
      const client=state.clients.find(item=>item.id===existingId);
      if(client){
        const oldName=client.name;
        state.services.forEach(service=>{if(service.clientName===oldName)service.clientName=name});
        state.defaultServices.forEach(service=>{if(service.clientName===oldName)service.clientName=name});
        state.helperDefaultServices.forEach(service=>{if(service.clientName===oldName)service.clientName=name});
        Object.assign(client,{name,reading,address,phone});
      }
    }else state.clients.push({id:id('c'),name,reading,address,phone});
    save();
  };
  root.querySelectorAll('[data-client-del]').forEach(button=>button.onclick=()=>{
    const client=state.clients.find(item=>item.id===button.dataset.clientDel);
    if(!client)return;
    const isUsed=state.services.some(service=>service.clientName===client.name)||state.defaultServices.some(service=>service.clientName===client.name)||state.helperDefaultServices.some(service=>service.clientName===client.name);
    if(isUsed)return alert('予定で使用中の利用者は削除できません');
    if(confirm('この利用者を削除しますか？')){state.clients=state.clients.filter(item=>item.id!==client.id);save();render()}
  });
}

// 個別ヘルパーにも、週別データと共通のタイムライン表示を追加します。
function renderIndividualHelperTimeline(){
  const root=document.querySelector('#view-helpers');
  if(!root||helper==='all')return;
  const selectedWeek=helperWeekKey||currentWeekKey();
  helperWeekKey=selectedWeek;
  const dayHeaders=DAYS.map((name,index)=>`<div class="all-helper-head">${listWeekDateLabel(selectedWeek,index)}（${name.charAt(0)}）</div>`).join('');
  const lanes=DAYS.map((name,index)=>{
    const dayOffKey=`${selectedWeek}:${helper}:${index}`;
    const isDayOff=!!state.helperDaysOff[dayOffKey];
    const items=layoutAllHelperItems(allHelperDayItems(helper,index,selectedWeek));
    const cards=items.map(item=>{
      const html=allHelperScheduleCard(item,item.columnIndex,item.columnCount);
      if(item.isDayOffReference)return html;
      return html.replace('<div class="all-helper-card',`<div data-individual-timeline-id="${item.service.id}" class="all-helper-card timeline-clickable`);
    }).join('');
    return`<div class="all-helper-lane ${isDayOff?'is-day-off':''}">${isDayOff?'<div class="all-helper-day-off">休み</div>':''}${cards}</div>`;
  }).join('');
  root.innerHTML=`<div class="toolbar"><div><h2>${esc(hname(helper))}さんの週間タイムライン</h2><div class="history">${weekText(selectedWeek)}</div></div><label class="helper-picker">ヘルパー<select id="helperIndependentSelect">${state.helpers.map(item=>`<option value="${item.id}" ${item.id===helper?'selected':''}>${esc(item.name)}</option>`).join('')}<option value="all">全員</option></select></label><div class="week-controls"><button class="button button-light button-small" data-individual-timeline-week="-1">＜ 前週</button><button class="button button-light button-small" data-individual-timeline-week="1">次週 ＞</button></div></div><div class="list-tabs"><button class="button button-small button-light" data-helper-default>デフォルト</button><button class="button button-small button-light" data-helper-week>週別</button><button class="button button-small button-primary" data-helper-timeline>タイムライン</button></div><div class="all-helper-legend"><span class="legend-free">空き時間</span><span class="legend-scheduled">予定あり</span><span class="legend-overlap">重複</span><span class="legend-day-off">休み</span><span class="legend-cancelled">中止</span></div><div class="all-helper-wrap individual-timeline-wrap"><div class="all-helper-grid individual-timeline-grid" style="--helper-count:7;min-width:1190px"><div class="all-helper-corner">時間</div>${dayHeaders}<div class="all-helper-time-axis">${allHelperTimeAxis()}</div>${lanes}</div></div>`;
  root.querySelector('[data-helper-default]').onclick=()=>{helperMode='default';helperWeekKey='';render()};
  root.querySelector('[data-helper-week]').onclick=()=>{helperMode='week';helperWeekKey=selectedWeek;render()};
  root.querySelector('[data-helper-timeline]').onclick=()=>{};
  root.querySelector('[data-individual-timeline-week="-1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)-1);render()};
  root.querySelector('[data-individual-timeline-week="1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)+1);render()};

  root.querySelectorAll('[data-individual-timeline-id]').forEach(cardNode=>cardNode.onclick=()=>modal(cardNode.dataset.individualTimelineId));
}
const renderIndependentHelpersBeforeTimeline=renderIndependentHelpers;
renderIndependentHelpers=function(){
  if(helper!=='all'&&helperMode==='timeline')return renderIndividualHelperTimeline();
  const result=renderIndependentHelpersBeforeTimeline();
  if(helper==='all')return result;
  const tabs=document.querySelector('#view-helpers .list-tabs');
  if(tabs&&!tabs.querySelector('[data-helper-timeline]')){
    const button=document.createElement('button');
    button.type='button';button.className='button button-small button-light';
    button.dataset.helperTimeline='';button.textContent='タイムライン';
    button.onclick=()=>{helperMode='timeline';helperWeekKey=helperWeekKey||currentWeekKey();render()};
    tabs.appendChild(button);
  }
  return result;
};

// サ責の追加・編集・削除を管理し、予定の担当候補へ反映します。
function renderManagers(){
  const list=document.querySelector('#managerList');
  if(!list)return;
  const managers=[...state.managers].sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  list.innerHTML=managers.map(manager=>`<div class="helper-row"><span>${esc(manager.name)}</span><div><button type="button" class="button button-light button-small" data-manager-edit="${manager.id}">編集</button><button type="button" class="button button-danger button-small" data-manager-delete="${manager.id}">削除</button></div></div>`).join('')||'<div class="empty">サ責が登録されていません</div>';
  list.querySelectorAll('[data-manager-edit]').forEach(button=>button.onclick=()=>{
    const manager=state.managers.find(item=>item.id===button.dataset.managerEdit);
    if(!manager)return;
    document.querySelector('#managerId').value=manager.id;
    document.querySelector('#managerName').value=manager.name;
    document.querySelector('#managerName').focus();
  });
  list.querySelectorAll('[data-manager-delete]').forEach(button=>button.onclick=()=>{
    const manager=state.managers.find(item=>item.id===button.dataset.managerDelete);
    if(!manager)return;
    const inUse=[state.services,state.defaultServices,state.helperDefaultServices].some(items=>items.some(service=>service.status==='manager'&&managerDisplayName(service.managerName)===manager.name));
    if(inUse)return alert('担当中の予定があるため削除できません');
    if(confirm(`${manager.name}さんを削除しますか？`)){state.managers=state.managers.filter(item=>item.id!==manager.id);save();renderManagers();render()}
  });
}
const openManagerManagerButton=document.querySelector('#openManagerManager');
if(openManagerManagerButton)openManagerManagerButton.onclick=()=>{
  document.querySelector('#managerForm').reset();document.querySelector('#managerId').value='';
  document.querySelector('#managerModalBackdrop').classList.remove('hidden');renderManagers();document.querySelector('#managerName').focus();
};
const managerForm=document.querySelector('#managerForm');
if(managerForm)managerForm.onsubmit=event=>{
  event.preventDefault();
  const managerId=document.querySelector('#managerId').value;
  const managerName=managerDisplayName(document.querySelector('#managerName').value.trim());
  if(!managerName||managerName==='サ責対応')return alert('サ責の名前を入力してください');
  if(state.managers.some(manager=>manager.name===managerName&&manager.id!==managerId))return alert('同じ名前のサ責がすでに登録されています');
  if(managerId){
    const manager=state.managers.find(item=>item.id===managerId);
    if(manager){
      const oldName=manager.name;manager.name=managerName;
      [state.services,state.defaultServices,state.helperDefaultServices].forEach(items=>items.forEach(service=>{if(service.status==='manager'&&managerDisplayName(service.managerName)===oldName)service.managerName=managerName}));
      if(weeklyManagerFilter===oldName)weeklyManagerFilter=managerName;
    }
  }else state.managers.push({id:id('m'),name:managerName});
  save();managerForm.reset();document.querySelector('#managerId').value='';renderManagers();
};

// 詳細画面の時間変更ボタンは廃止し、カードの時間クリックへ操作を統一します。
const modalWithoutTimeChangeButton=modal;
modal=function(...args){
  const result=modalWithoutTimeChangeButton(...args);
  document.querySelector('#serviceModalBody [data-change]')?.remove();
  return result;
};

// 利用者名がカード幅を超える場合だけ、収まるまで文字サイズを縮小します。
function fitServiceCardClientNames(){
  document.querySelectorAll('.view.active .service-card-main .client').forEach(client=>{
    client.style.fontSize='14px';
    let size=14;
    while(client.scrollWidth>client.clientWidth&&size>9){size-=0.5;client.style.fontSize=`${size}px`}
  });
}
function fitComparisonCardTimes(){
  document.querySelectorAll('.view.active .multi-helper-sheet .service-card>.time,.view.active .multi-helper-sheet .service-card>.default-time,.view.active .multi-helper-sheet .service-card>.compare-default-time').forEach(time=>{
    time.style.fontSize='12px';
    let size=12;
    while(time.scrollWidth>time.clientWidth&&size>8){size-=0.5;time.style.fontSize=`${size}px`}
  });
}
const renderWithFittedClientNames=render;
render=function(){
  const result=renderWithFittedClientNames();
  requestAnimationFrame(fitServiceCardClientNames);
  return result;
};
window.addEventListener('resize',()=>{fitServiceCardClientNames();fitComparisonCardTimes()});

// 印刷時は、表示中の週間スケジュールだけを出力します。
function addWeeklyPrintTools(){
  const root=document.querySelector('#view-unassigned');
  if(!root)return;
  const toolbar=root.querySelector('.toolbar');
  if(toolbar&&!toolbar.querySelector('[data-print-week]')){
    const button=document.createElement('button');
    button.type='button';button.className='button button-primary button-small';button.dataset.printWeek='';button.textContent='印刷';
    button.onclick=()=>{document.body.classList.remove('print-helper-schedule');window.print()};toolbar.appendChild(button);
  }
  let heading=root.querySelector('.print-week-heading');
  if(!heading){heading=document.createElement('div');heading.className='print-week-heading';root.prepend(heading)}
  heading.innerHTML=`<h1>週間スケジュール</h1><p>${weekLabel()}</p>`;
}
const renderWithWeeklyPrintTools=render;
render=function(){const result=renderWithWeeklyPrintTools();addWeeklyPrintTools();return result};
window.addEventListener('beforeprint',()=>{addWeeklyPrintTools();fitServiceCardClientNames()});

// 個別ヘルパーの週別予定も、予定部分だけを印刷します。
function addHelperPrintTools(){
  const root=document.querySelector('#view-helpers');
  if(!root||helper==='all'||helperMode!=='week')return;
  const toolbar=root.querySelector('.toolbar');
  if(toolbar&&!toolbar.querySelector('[data-print-helper-week]')){
    const button=document.createElement('button');
    button.type='button';button.className='button button-primary button-small';button.dataset.printHelperWeek='';button.textContent='印刷';
    button.onclick=()=>{document.body.classList.add('print-helper-schedule');window.print()};toolbar.appendChild(button);
  }
  let heading=root.querySelector('.print-helper-heading');
  if(!heading){heading=document.createElement('div');heading.className='print-helper-heading';root.prepend(heading)}
  const selectedWeek=helperWeekKey||currentWeekKey();
  heading.innerHTML=`<h1>${esc(hname(helper))}さんの週間スケジュール</h1><p>${weekText(selectedWeek)}</p>`;
}
const renderWithHelperPrintTools=render;
render=function(){const result=renderWithHelperPrintTools();addHelperPrintTools();return result};
window.addEventListener('beforeprint',addHelperPrintTools);
window.addEventListener('afterprint',()=>document.body.classList.remove('print-helper-schedule'));

// 選択した複数ヘルパーの週別予定を、1行最大2名で比較表示します。
let comparedHelperIds=[],comparisonSelectionInitialized=false;
function multiHelperWeekSheet(helperItem,weekKey){
  const days=DAYS.map((dayName,dayIndex)=>{
    const isDayOff=!!state.helperDaysOff[`${weekKey}:${helperItem.id}:${dayIndex}`];
    const services=state.services.filter(service=>service.weekKey===weekKey&&service.helperId===helperItem.id&&service.day===dayIndex).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    return`<div class="day-column multi-helper-day ${isDayOff?'compare-day-off':''}"><div class="day-title">${dayName.replace('曜日','')}<small>${listWeekDateLabel(weekKey,dayIndex)}</small></div>${isDayOff?'<div class="multi-helper-off-label">休み</div>':''}<div class="cards">${services.map(service=>card(service)).join('')||'<div class="empty">予定なし</div>'}</div></div>`;
  }).join('');
  return`<section class="multi-helper-sheet"><h2>${esc(helperItem.name)}さん</h2><div class="week-grid multi-helper-inner-week">${days}</div></section>`;
}
function renderMultiHelperWeeks(){
  const root=document.querySelector('#view-helpers');
  if(!root)return;
  comparedHelperIds=comparedHelperIds.filter(helperId=>state.helpers.some(item=>item.id===helperId));
  if(!comparisonSelectionInitialized){comparedHelperIds=state.helpers.slice(0,Math.min(2,state.helpers.length)).map(item=>item.id);comparisonSelectionInitialized=true}
  const selectedWeek=helperWeekKey||currentWeekKey();helperWeekKey=selectedWeek;
  const selectors=state.helpers.map(item=>`<label><input type="checkbox" data-compare-helper="${item.id}" ${comparedHelperIds.includes(item.id)?'checked':''}> ${esc(item.name)}</label>`).join('');
  const sheets=comparedHelperIds.map(helperId=>state.helpers.find(item=>item.id===helperId)).filter(Boolean).map(item=>multiHelperWeekSheet(item,selectedWeek)).join('');
  root.innerHTML=`<div class="print-helper-comparison-heading"><h1>ヘルパー週間スケジュール</h1><p>${weekText(selectedWeek)}</p></div><div class="toolbar multi-helper-toolbar"><div><h2>複数ヘルパー週別表示</h2><div class="history">${weekText(selectedWeek)}・表示するヘルパーを選択</div></div><div class="week-controls"><button class="button button-light button-small" data-compare-week="-1">＜ 前週</button><button class="button button-light button-small" data-compare-week="1">次週 ＞</button></div><button class="button button-primary button-small" data-print-helper-comparison ${comparedHelperIds.length?'':'disabled'}>印刷</button><button class="button button-light button-small" data-close-helper-comparison>通常表示に戻る</button></div><div class="multi-helper-selectors">${selectors||'<span class="history">ヘルパーが登録されていません</span>'}</div><div class="multi-helper-week-grid">${sheets||'<div class="empty">表示するヘルパーを選択してください</div>'}</div>`;
  root.querySelectorAll('[data-compare-helper]').forEach(checkbox=>checkbox.onchange=()=>{
    if(checkbox.checked){if(!comparedHelperIds.includes(checkbox.dataset.compareHelper))comparedHelperIds.push(checkbox.dataset.compareHelper)}
    else comparedHelperIds=comparedHelperIds.filter(helperId=>helperId!==checkbox.dataset.compareHelper);
    render();
  });
  root.querySelector('[data-compare-week="-1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)-1);render()};
  root.querySelector('[data-compare-week="1"]').onclick=()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)+1);render()};
  root.querySelector('[data-close-helper-comparison]').onclick=()=>{helper='all';helperMode='week';render()};
  const printButton=root.querySelector('[data-print-helper-comparison]');
  if(printButton)printButton.onclick=()=>{document.body.classList.remove('print-helper-schedule');document.body.classList.add('print-helper-comparison');window.print()};
  root.querySelectorAll('.multi-helper-sheet .service-card').forEach(cardNode=>cardNode.onclick=()=>modal(cardNode.dataset.id));
}
const renderIndependentHelpersBeforeComparison=renderIndependentHelpers;
renderIndependentHelpers=function(){
  if(helperMode==='compare')return renderMultiHelperWeeks();
  const result=renderIndependentHelpersBeforeComparison();
  const toolbar=document.querySelector('#view-helpers .toolbar');
  if(toolbar&&!toolbar.querySelector('[data-open-helper-comparison]')){
    const button=document.createElement('button');button.type='button';button.className='button button-primary button-small';button.dataset.openHelperComparison='';button.textContent='複数ヘルパー表示';
    button.onclick=()=>{if(helper!=='all'){if(!comparedHelperIds.includes(helper))comparedHelperIds=[helper,...comparedHelperIds];comparisonSelectionInitialized=true}helper='all';helperMode='compare';helperWeekKey=helperWeekKey||currentWeekKey();render()};toolbar.appendChild(button);
  }
  return result;
};
const renderWithHelperComparison=render;
render=function(){
  const result=renderWithHelperComparison();
  if(helperMode==='compare'){
    document.querySelectorAll('#view-helpers .card-select').forEach(node=>node.remove());
    document.querySelector('#view-helpers [data-delete-selected]')?.remove();
    requestAnimationFrame(()=>{fitServiceCardClientNames();fitComparisonCardTimes()});
  }
  return result;
};
window.addEventListener('afterprint',()=>document.body.classList.remove('print-helper-comparison'));

// 複数表示では、デフォルト・週別・タイムラインを同じヘルパー選択で切り替えます。
let helperComparisonView='week';
function multiHelperDefaultSheet(helperItem){
  const days=DAYS.map((dayName,dayIndex)=>{
    const services=state.helperDefaultServices.filter(service=>service.helperId===helperItem.id&&service.day===dayIndex).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    const cards=services.map(service=>card(service).replace('class="time"','class="compare-default-time"').replace('<article class="','<article data-compare-default="true" class="')).join('');
    return`<div class="day-column multi-helper-day"><div class="day-title">${dayName.replace('曜日','')}<small>デフォルト</small></div><div class="cards">${cards||'<div class="empty">予定なし</div>'}</div></div>`;
  }).join('');
  return`<section class="multi-helper-sheet"><h2>${esc(helperItem.name)}さん</h2><div class="week-grid multi-helper-inner-week">${days}</div></section>`;
}
function multiHelperTimelineCard(item,columnIndex,columnCount){
  const {service,isDayOffReference}=item,scale=.6;
  const start=Math.max(420,effectiveStartMinutes(service)),end=Math.min(1320,effectiveEndMinutes(service));
  const top=Math.max(0,(start-420)*scale),height=Math.max(18,(end-start)*scale);
  const statusClass=isDayOffReference?' day-off-reference':service.status==='cancelled'?' cancelled':'';
  const overlapClass=columnCount>1&&!isDayOffReference?' overlap':'';
  const left=`calc(${columnIndex} * (100% / ${columnCount}) + 2px)`,width=`calc(100% / ${columnCount} - 4px)`;
  const endText=service.endTime?displayClockTime(service.endTime):'未定';
  return`<div data-compare-timeline-id="${service.id}" class="all-helper-card compare-timeline-card${statusClass}${overlapClass}" style="top:${top}px;height:${height}px;left:${left};width:${width}"><div class="all-helper-time">${displayClockTime(service.startTime)}～${endText}</div><div class="all-helper-client">${esc(service.clientName)}</div>${isDayOffReference?'<div class="all-helper-state">休み</div>':service.status==='cancelled'?'<div class="all-helper-state">中止</div>':''}</div>`;
}
function multiHelperTimelineSheet(helperItem,weekKey){
  const headers=DAYS.map((dayName,dayIndex)=>`<div class="all-helper-head">${dayName.charAt(0)}<small>${listWeekDateLabel(weekKey,dayIndex)}</small></div>`).join('');
  const lanes=DAYS.map((dayName,dayIndex)=>{
    const isDayOff=!!state.helperDaysOff[`${weekKey}:${helperItem.id}:${dayIndex}`];
    const items=layoutAllHelperItems(allHelperDayItems(helperItem.id,dayIndex,weekKey));
    return`<div class="all-helper-lane ${isDayOff?'is-day-off':''}">${isDayOff?'<div class="all-helper-day-off">休み</div>':''}${items.map(item=>multiHelperTimelineCard(item,item.columnIndex,item.columnCount)).join('')}</div>`;
  }).join('');
  return`<section class="multi-helper-sheet multi-helper-timeline-sheet"><h2>${esc(helperItem.name)}さん</h2><div class="all-helper-grid multi-helper-timeline-grid"><div class="all-helper-corner">時間</div>${headers}<div class="all-helper-time-axis">${allHelperTimeAxis(.6)}</div>${lanes}</div></section>`;
}
renderMultiHelperWeeks=function(){
  const root=document.querySelector('#view-helpers');if(!root)return;
  comparedHelperIds=comparedHelperIds.filter(helperId=>state.helpers.some(item=>item.id===helperId));
  if(!comparisonSelectionInitialized){comparedHelperIds=state.helpers.slice(0,Math.min(2,state.helpers.length)).map(item=>item.id);comparisonSelectionInitialized=true}
  const selectedWeek=helperWeekKey||currentWeekKey();helperWeekKey=selectedWeek;
  const selectedHelpers=comparedHelperIds.map(helperId=>state.helpers.find(item=>item.id===helperId)).filter(Boolean);
  const selectors=state.helpers.map(item=>`<label><input type="checkbox" data-compare-helper="${item.id}" ${comparedHelperIds.includes(item.id)?'checked':''}> ${esc(item.name)}</label>`).join('');
  const sheetRenderer=helperComparisonView==='default'?item=>multiHelperDefaultSheet(item):helperComparisonView==='timeline'?item=>multiHelperTimelineSheet(item,selectedWeek):item=>multiHelperWeekSheet(item,selectedWeek);
  const sheets=selectedHelpers.map(sheetRenderer).join('');
  const viewTitle=helperComparisonView==='default'?'デフォルト':helperComparisonView==='timeline'?'タイムライン':'週別';
  const periodText=helperComparisonView==='default'?'毎週のひな形':weekText(selectedWeek);
  const weekControls=helperComparisonView==='default'?'':`<div class="week-controls"><button class="button button-light button-small" data-compare-week="-1">＜ 前週</button><button class="button button-light button-small" data-compare-week="1">次週 ＞</button></div>`;
  root.innerHTML=`<div class="print-helper-comparison-heading"><h1>ヘルパー ${viewTitle}</h1><p>${periodText}</p></div><div class="toolbar multi-helper-toolbar"><div><h2>複数ヘルパー表示</h2><div class="history">${viewTitle}・表示するヘルパーを選択</div></div>${weekControls}<button class="button button-primary button-small" data-print-helper-comparison ${comparedHelperIds.length?'':'disabled'}>印刷</button><button class="button button-light button-small" data-close-helper-comparison>通常表示に戻る</button></div><div class="list-tabs multi-helper-view-tabs"><button class="button button-small ${helperComparisonView==='default'?'button-primary':'button-light'}" data-comparison-view="default">デフォルト</button><button class="button button-small ${helperComparisonView==='week'?'button-primary':'button-light'}" data-comparison-view="week">週別</button><button class="button button-small ${helperComparisonView==='timeline'?'button-primary':'button-light'}" data-comparison-view="timeline">タイムライン</button></div><div class="multi-helper-selectors">${selectors||'<span class="history">ヘルパーが登録されていません</span>'}</div><div class="multi-helper-week-grid ${helperComparisonView==='timeline'?'is-timeline':''}">${sheets||'<div class="empty">表示するヘルパーを選択してください</div>'}</div>`;
  root.querySelectorAll('[data-comparison-view]').forEach(button=>button.onclick=()=>{helperComparisonView=button.dataset.comparisonView;render()});
  root.querySelectorAll('[data-compare-helper]').forEach(checkbox=>checkbox.onchange=()=>{if(checkbox.checked){if(!comparedHelperIds.includes(checkbox.dataset.compareHelper))comparedHelperIds.push(checkbox.dataset.compareHelper)}else comparedHelperIds=comparedHelperIds.filter(helperId=>helperId!==checkbox.dataset.compareHelper);render()});
  root.querySelector('[data-compare-week="-1"]')?.addEventListener('click',()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)-1);render()});
  root.querySelector('[data-compare-week="1"]')?.addEventListener('click',()=>{helperWeekKey=weekKeyFromOffset(weekKeyOffset(selectedWeek)+1);render()});
  root.querySelector('[data-close-helper-comparison]').onclick=()=>{helper='all';helperMode='week';render()};
  root.querySelector('[data-print-helper-comparison]').onclick=()=>{document.body.classList.remove('print-helper-schedule');document.body.classList.add('print-helper-comparison');window.print()};
  root.querySelectorAll('[data-compare-default]').forEach(cardNode=>cardNode.onclick=()=>withHelperDefaults(()=>defaultModal(cardNode.dataset.id)));
  root.querySelectorAll('.multi-helper-sheet .service-card:not([data-compare-default])').forEach(cardNode=>cardNode.onclick=()=>modal(cardNode.dataset.id));
  root.querySelectorAll('[data-compare-timeline-id]').forEach(cardNode=>cardNode.onclick=()=>modal(cardNode.dataset.compareTimelineId));
};

// ヘルパー別タブは初回に先頭、以降は最後に開いた個別ヘルパーを週別で表示します。
function rememberLastOpenedHelper(helperId){
  if(!state.helpers.some(item=>item.id===helperId))return;
  if(state.lastOpenedHelperId===helperId)return;
  state.lastOpenedHelperId=helperId;save();
}
document.addEventListener('click',event=>{
  const tab=event.target.closest('.tab[data-view="helpers"]');
  if(!tab)return;
  const remembered=state.helpers.find(item=>item.id===state.lastOpenedHelperId);
  const targetHelper=remembered||state.helpers[0];
  helper=targetHelper?.id||'all';
  if(targetHelper)rememberLastOpenedHelper(targetHelper.id);
  helperMode='week';helperWeekKey=currentWeekKey();
},true);

// お休みの日は、週間スケジュールから担当へ割り当てられないようにします。
function isHelperDayOff(helperId,dayIndex,weekKey=currentWeekKey()){
  return !!state.helperDaysOff?.[`${weekKey}:${helperId}:${dayIndex}`];
}

// どの登録経路から保存しても、休みのヘルパーへ予定が残らないようにする最終防止処理です。
const saveBeforeDayOffGuard=save;
save=function(){
  state.services.forEach(service=>{
    if(service.helperId&&active(service)&&isHelperDayOff(service.helperId,service.day,service.weekKey)){
      service.helperId='';service.status='unassigned';service.managerName='';
    }
  });
  return saveBeforeDayOffGuard();
};

// 予定詳細の「対応可能ヘルパー」には、休みの人も状態が分かる形で表示します。
const modalBeforeDayOffGuard=modal;
modal=function(...args){
  const result=modalBeforeDayOffGuard(...args);
  const service=state.services.find(item=>item.id===openId);
  if(!service)return result;
  const headings=[...document.querySelectorAll('#serviceModalBody h3')];
  const availableHeading=headings.find(node=>node.textContent.trim()==='対応可能ヘルパー');
  const availableList=availableHeading?.nextElementSibling;
  if(!availableList)return result;
  state.helpers.filter(item=>isHelperDayOff(item.id,service.day,service.weekKey)).forEach(item=>{
    document.querySelector(`#serviceModalBody [data-assign="${item.id}"]`)?.remove();
    document.querySelector(`#serviceModalBody [data-busy="${item.id}"]`)?.remove();
    const button=document.createElement('button');
    button.type='button';button.className='button button-light helper-day-off-choice';button.disabled=true;
    button.innerHTML=`× ${esc(item.name)}<span class="busy">休み</span>`;
    availableList.appendChild(button);
  });
  return result;
};

// 表示だけでなく、割当処理そのものでも休みを拒否します。
const assignBeforeDayOffGuard=assign;
assign=function(helperId){
  const service=state.services.find(item=>item.id===openId);
  if(service&&isHelperDayOff(helperId,service.day,service.weekKey)){
    alert(`${hname(helperId)}さんは${DAYS[service.day]}がお休みのため割り当てできません`);
    return;
  }
  return assignBeforeDayOffGuard(helperId);
};

function applyDayOffOptions(select,dayIndex,weekKey){
  if(!select)return;
  [...select.options].forEach(option=>{
    const helperItem=state.helpers.find(item=>item.id===option.value);
    if(!helperItem)return;
    const isOff=isHelperDayOff(helperItem.id,dayIndex,weekKey);
    option.disabled=isOff;
    option.textContent=isOff?`${helperItem.name}（休み）`:helperItem.name;
  });
  const selected=state.helpers.find(item=>item.id===select.value);
  if(selected&&isHelperDayOff(selected.id,dayIndex,weekKey))select.value='';
}

// 予定追加画面でも、曜日を選ぶと休みのヘルパーを選択不可にします。
const quickAddBeforeDayOffGuard=quickAddModal;
quickAddModal=function(helperId='',targetWeek=currentWeekKey()){
  const result=quickAddBeforeDayOffGuard(helperId,targetWeek);
  const daySelect=document.querySelector('#quickDay');
  const helperSelect=document.querySelector('#quickHelper');
  const refresh=()=>applyDayOffOptions(helperSelect,Number(daySelect?.value||0),targetWeek);
  refresh();
  if(daySelect)daySelect.onchange=refresh;
  const saveButton=document.querySelector('#saveQuickService');
  if(saveButton)saveButton.addEventListener('click',event=>{
    const selectedHelper=helperSelect?.value;
    const selectedDay=Number(daySelect?.value||0);
    if(selectedHelper&&selectedHelper!=='manager'&&isHelperDayOff(selectedHelper,selectedDay,targetWeek)){
      event.preventDefault();event.stopImmediatePropagation();
      alert(`${hname(selectedHelper)}さんは${DAYS[selectedDay]}がお休みのため登録できません`);
    }
  },true);
  return result;
};

function applyServiceFormDayOffOptions(){
  const form=document.querySelector('#serviceForm');
  if(!form)return;
  const daySelect=form.elements.day;
  const helperSelect=form.elements.helperId;
  const refresh=()=>applyDayOffOptions(helperSelect,Number(daySelect.value),form.dataset.targetWeek||currentWeekKey());
  refresh();
  daySelect.onchange=refresh;
}
const openServiceRegisterBeforeDayOffOptions=openServiceRegister;
openServiceRegister=function(...args){
  const result=openServiceRegisterBeforeDayOffOptions(...args);
  applyServiceFormDayOffOptions();
  return result;
};
// 週間スケジュールにも、表示中の週・曜日ごとに休みのヘルパーを表示します。
function addWeeklyHelperDaysOff(){
  const weekKey=currentWeekKey();
  document.querySelectorAll('#view-unassigned .day-column').forEach((column,dayIndex)=>{
    column.querySelector('.weekly-helper-days-off')?.remove();
    const helpersOff=state.helpers.filter(item=>isHelperDayOff(item.id,dayIndex,weekKey));
    const title=column.querySelector('.day-title');
    if(!title||!helpersOff.length)return;
    const notice=document.createElement('div');
    notice.className='weekly-helper-days-off';
    notice.innerHTML=`<span class="weekly-helper-days-off-label">お休み</span><span>${helpersOff.map(item=>esc(item.name)).join('、')}</span>`;
    title.insertAdjacentElement('afterend',notice);
  });
}
function layoutWeeklyCardMemos(){
  document.querySelectorAll('#view-unassigned .service-card, #view-helpers .service-card').forEach(cardNode=>{
    const memo=cardNode.querySelector('.service-card-main > .memo');
    const helperNode=cardNode.querySelector('.helper');
    if(memo&&helperNode)helperNode.insertAdjacentElement('afterend',memo);
  });
}
const renderBeforeDayOffOptions=render;
render=function(){
  const result=renderBeforeDayOffOptions();
  applyServiceFormDayOffOptions();
  addWeeklyHelperDaysOff();
  layoutWeeklyCardMemos();
  document.querySelectorAll('.tabs .tab').forEach(button=>{
    if(button.classList.contains('active'))button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.list-tabs .button,.helper-choice-buttons .button,.helper-day-buttons .button,.all-helper-day-buttons .button').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.classList.contains('button-primary')));
  });
  return result;
};

// 初期描画は、すべての画面処理とイベント登録を準備してから1回だけ行います。
await persistence.idle();
render();
})().catch(error=>window.schedulePersistence.fail(error));
