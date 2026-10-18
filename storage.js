// Supabase接続時は adapter の load / save / subscribe を置き換えます。
// save(data, revision) はDB側でリビジョン照合と更新を一体で行う契約です。
(function (root) {
  'use strict';
  const KEY = 'care-schedule-v1';
  function validate(data) {
    if (!data || !Array.isArray(data.helpers) || !Array.isArray(data.services)) throw new Error('保存データの形式が正しくありません。元データは変更していません。');
    return data;
  }
  function createLocalAdapter(storage, locks, events) {
    function read() {
      const raw = storage.getItem(KEY);
      if (raw === null) return { data: null, revision: null };
      const value = JSON.parse(raw);
      const data = value?.format === 'care-schedule-store-v1' ? value.data : value;
      return { data: validate(data), revision: raw };
    }
    return {
      async load() { return read(); },
      async save(data, revision) {
        if (!locks?.request) throw new Error('安全な保存には対応ブラウザーが必要です。HTTPSのGitHub PagesまたはLive Serverで開いてください。');
        return locks.request(KEY, () => {
          if (read().revision !== revision) throw new Error('別の画面でデータが更新されました。上書きを防ぐため保存を停止しました。');
          const raw = JSON.stringify({ format: 'care-schedule-store-v1', data: validate(data), version: root.crypto.randomUUID(), updatedAt: new Date().toISOString() });
          storage.setItem(KEY, raw);
          return { revision: raw };
        });
      },
      subscribe(callback) {
        const handler = event => { if (event.key === KEY || event.key === null) callback(); };
        events.addEventListener('storage', handler);
        return () => events.removeEventListener('storage', handler);
      },
    };
  }
  function createStore(adapter, notify = () => {}) {
    let revision, ready = false, blocked = false, pending = 0;
    let tail = Promise.resolve(true);
    return {
      async load() {
        notify('loading');
        try {
          const result = await adapter.load();
          if (result.data !== null) validate(result.data);
          revision = result.revision; ready = true;
          notify('ready');
          return result.data;
        } catch (error) { blocked = true; notify('error', error); throw error; }
      },
      save(data) {
        if (!ready || blocked) return Promise.resolve(false);
        let snapshot;
        try { snapshot = JSON.parse(JSON.stringify(validate(data))); }
        catch (error) { blocked = true; notify('error', error); return Promise.resolve(false); }
        pending++; notify('saving');
        tail = tail.then(async () => {
          if (blocked) { pending--; return false; }
          try {
            const result = await adapter.save(snapshot, revision);
            revision = result.revision;
            pending--;
            if (!pending) notify('saved');
            return true;
          } catch (error) { pending--; blocked = true; notify('error', error); return false; }
        });
        return tail;
      },
      idle() { return tail; },
      get unsaved() { return pending > 0 || blocked; },
      subscribe(callback) { return adapter.subscribe?.(callback) || (() => {}); },
    };
  }
  root.ScheduleStorage = { createLocalAdapter, createStore };
})(globalThis);
