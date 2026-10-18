(function () {
  const status = document.querySelector('#storageStatus');
  const recovery = document.querySelector('#storageRecovery');
  let currentState = () => null;
  function lock(locked) {
    document.querySelectorAll('.app-header,main,.modal-backdrop').forEach(node => { node.inert = locked; });
  }
  function notify(kind, error) {
    const labels = { loading: 'データを読み込み中…', ready: 'このブラウザーに保存します', saving: '保存中…', saved: 'このブラウザーに保存済み' };
    status.textContent = labels[kind] || `保存・読み込みに失敗しました。${error?.message || ''} 未保存の内容はバックアップできます。`;
    if (kind === 'loading' || kind === 'error') lock(true);
    if (kind === 'ready') lock(false);
    if (kind === 'error') recovery.hidden = false;
  }
  // 将来はこの1か所でSupabase用アダプターを指定します。
  const storage = { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) };
  const adapter = ScheduleStorage.createLocalAdapter(storage, navigator.locks, window);
  const store = ScheduleStorage.createStore(adapter, notify);
  window.schedulePersistence = { store, bind(readState) { currentState = readState; }, fail(error) { notify('error', error); } };
  store.subscribe(() => {
    status.textContent = '別の画面で更新されました。入力途中の内容を確認してから最新データを開いてください。';
    recovery.hidden = false;
  });
  document.querySelector('#storageReload').onclick = () => {
    if (confirm('入力途中・未保存の内容は失われます。必要なら先にバックアップしてください。最新データを開きますか？')) location.reload();
  };
  document.querySelector('#storageBackup').onclick = () => {
    const data = currentState();
    if (!data) { alert('データを読み込めていないため、バックアップできません。'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'care-schedule-backup', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'スケジュール_作業中バックアップ.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  addEventListener('beforeunload', event => { if (store.unsaved) { event.preventDefault(); event.returnValue = ''; } });
})();
