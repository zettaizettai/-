(function () {
  const status = document.querySelector('#storageStatus');
  const recovery = document.querySelector('#storageRecovery');
  const panel = document.querySelector('#authPanel');
  const authMessage = document.querySelector('#authMessage');
  const config = window.SCHEDULE_CLOUD;
  const isCloud = !!config?.enabled;
  let currentState = () => null, replaceState = null, store, adapter, client;
  let activeUser = null, booted = false, finished = false, polling = false, signedOut = false;
  let allowUnload = false, halted = false;
  const dirtyInputs = new Set();
  function lock(locked) {
    document.querySelectorAll('.app-header,main,.modal-backdrop').forEach(node => { node.inert = locked; });
  }
  function notify(kind, error) {
    const labels = { loading: 'データを読み込み中…', ready: isCloud ? '共有データを読み込みました' : 'このブラウザーに保存します', saving: '保存中…', saved: isCloud ? '共有先に保存済み' : 'このブラウザーに保存済み', updated: '別の職員の変更を反映しました' };
    status.textContent = labels[kind] || `保存・読み込みに失敗しました。${error?.message || ''} 作業中の内容はバックアップできます。`;
    if (kind === 'loading' || kind === 'error') lock(true);
    if (kind === 'ready') lock(false);
    if (kind === 'error') { recovery.hidden = false; halted = true; }
    if (kind === 'saved') {
      // 予定へ直接保存された曜日メモだけは入力保護を解除。未保存のフォームは残します。
      dirtyInputs.forEach(node => { if (!node.isConnected || node.classList.contains('day-note')) dirtyInputs.delete(node); });
    }
  }
  function download(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'care-schedule-backup', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function isEditing() {
    dirtyInputs.forEach(node => { if (!node.isConnected) dirtyInputs.delete(node); });
    return dirtyInputs.size > 0 || !!document.querySelector('.modal-backdrop:not(.hidden)')
      || !!document.activeElement?.closest('main input,main textarea,main select')
      || !!document.querySelector('.schedule-dragging');
  }
  document.addEventListener('input', event => { if (event.target.closest('main,.modal-backdrop')) dirtyInputs.add(event.target); });
  document.addEventListener('reset', event => { dirtyInputs.forEach(node => { if (event.target.contains(node)) dirtyInputs.delete(node); }); });
  function warnUpdate() {
    status.textContent = '別の職員が更新しました。入力途中の内容を確認して、最新データを開いてください。';
    recovery.hidden = false;
  }
  async function poll() {
    if (!finished || polling || signedOut || halted || document.hidden || store.unsaved) return;
    polling = true;
    try {
      const baseline = store.revision;
      const next = await adapter.version();
      if (store.unsaved || baseline !== store.revision || signedOut) return;
      if (next !== baseline) {
        if (isEditing()) { warnUpdate(); return; }
        const data = await store.refresh(() => !isEditing() && !signedOut);
        if (data) { replaceState(data); recovery.hidden = true; }
      }
    } catch (error) {
      // 権限変更・ログイン切れも含め、接続確認に失敗したら編集を止めます。
      notify('error', error);
    } finally { polling = false; }
  }
  function expired() {
    signedOut = true;
    document.documentElement.classList.add('auth-pending');
    panel.hidden = false;
    authMessage.textContent = 'ログイン状態が変わりました。再ログインしてください。作業中の内容は画面下のバックアップで保存できます。';
    recovery.hidden = false;
    lock(true);
  }
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  window.schedulePersistence = {
    ready, isCloud,
    get store() { return store; },
    bind(readState, applyState) { currentState = readState; replaceState = applyState; },
    fail(error) { notify('error', error); },
    started() { finished = true; if (isCloud) setInterval(poll, 10000); },
  };
  function activate(session) {
    if (booted) { allowUnload = true; location.reload(); return; }
    activeUser = session?.user?.id || null;
    adapter = isCloud ? ScheduleCloud.createSupabaseAdapter(client) : ScheduleStorage.createLocalAdapter(
      { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, navigator.locks, window);
    store = ScheduleStorage.createStore(adapter, notify);
    if (!isCloud) store.subscribe(warnUpdate);
    panel.hidden = true;
    document.documentElement.classList.remove('auth-pending');
    document.querySelector('#accountBar').hidden = !isCloud;
    document.querySelector('#accountEmail').textContent = session?.user?.email || '';
    booted = true;
    readyResolve();
  }
  lock(true);
  document.querySelector('#storageReload').onclick = () => {
    if (confirm('入力途中・未保存の内容は失われます。必要なら先にバックアップしてください。最新データを開きますか？')) { allowUnload = true; location.reload(); }
  };
  document.querySelector('#storageBackup').onclick = () => {
    const data = currentState();
    if (!data) { alert('データを読み込めていないため、バックアップできません。'); return; }
    download(data, 'スケジュール_作業中バックアップ.json');
  };
  document.querySelector('#signOut').onclick = async () => {
    if (store?.unsaved || isEditing()) {
      if (!confirm('入力途中・未保存の内容があります。必要なバックアップを保存してからログアウトしてください。続けますか？')) return;
    }
    const button = document.querySelector('#signOut'); button.disabled = true;
    lock(true);
    await store.idle();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) { button.disabled = false; notify('error', new Error('ログアウトできませんでした。接続を確認してください。')); return; }
    allowUnload = true; location.reload();
  };
  document.querySelector('#loginForm').onsubmit = async event => {
    event.preventDefault();
    if (!client) return;
    const button = document.querySelector('#loginSubmit'); button.disabled = true;
    authMessage.textContent = 'ログイン中…';
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: document.querySelector('#loginEmail').value.trim(), password: document.querySelector('#loginPassword').value });
      document.querySelector('#loginPassword').value = '';
      if (error || !data.session) { authMessage.textContent = 'ログインできません。メールアドレス・パスワードと接続状態を確認してください。'; return; }
      if (booted && !confirm('再ログインして最新データを開きます。未保存の内容は失われます。続けますか？')) { expired(); return; }
      activate(data.session);
    } catch { authMessage.textContent = '接続できませんでした。通信状態を確認してください。'; }
    finally { button.disabled = false; }
  };
  addEventListener('beforeunload', event => { if (!allowUnload && store?.unsaved) { event.preventDefault(); event.returnValue = ''; } });
  addEventListener('focus', () => { if (isCloud) poll(); });
  (async () => {
    try {
      if (!isCloud) { activate(null); return; }
      if (!window.supabase?.createClient) throw new Error('ログイン用の部品を読み込めませんでした。通信状態を確認して再読み込みしてください。');
      client = window.supabase.createClient(config.url, config.publishableKey);
      client.auth.onAuthStateChange((event, session) => {
        if (booted && (event === 'SIGNED_OUT' || (session && session.user.id !== activeUser))) expired();
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) activate(data.session);
      else { authMessage.textContent = ''; status.textContent = 'ログインしてください'; }
    } catch (error) { authMessage.textContent = error.message; readyReject(error); }
  })();
})();
