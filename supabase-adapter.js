(function (root) {
  function normalize(data) {
    if (!data || !Array.isArray(data.helpers) || !Array.isArray(data.services)) throw new Error('共有データの形式が正しくありません。');
    const copy = JSON.parse(JSON.stringify(data));
    const monday = new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
    const week = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
    copy.services.forEach(s => { s.weekKey ||= week; s.status ||= s.helperId ? 'assigned' : 'unassigned'; });
    if (!Array.isArray(copy.defaultServices)) copy.defaultServices=copy.services.map(s=>({...s,templateId:s.templateId||s.id}));
    if (!Array.isArray(copy.helperDefaultServices)) {
      copy.helperDefaultServices=copy.defaultServices.filter(s=>s.helperId);
      copy.defaultServices=copy.defaultServices.filter(s=>!s.helperId);
    }
    [copy.defaultServices,copy.helperDefaultServices].forEach(items=>items.forEach(s=>{s.status ||= s.helperId?'assigned':'unassigned'}));
    if (!Array.isArray(copy.clients)) copy.clients=[...new Set(copy.services.map(s=>s.clientName).filter(Boolean))].map((name,i)=>({id:`c_migrated_${i}`,name}));
    if (!Array.isArray(copy.managers)) copy.managers=[];
    copy.helperDaysOff ||= {}; copy.weekNotes ||= {};
    return copy;
  }
  function explain(error) {
    const text = error?.message || '';
    if (text.includes('SCHEDULE_CONFLICT')) return new Error('別の職員が更新しました。作業中の内容をバックアップし、最新データを開いてください。');
    if (text.includes('SCHEDULE_FORBIDDEN')) return new Error('このアカウントは共有メンバーに登録されていません。管理者に登録を依頼してください。');
    if (error?.code === 'PGRST202' || text.includes('schema cache')) return new Error('Supabaseの初期設定が未完了です。設定用SQLを実行してください。');
    if (error?.code === 'PGRST301' || error?.status === 401) return new Error('ログインの有効期限が切れました。再ログインしてください。');
    if (text.includes('SCHEDULE_INVALID')) return new Error('共有データの形式または容量を確認してください（上限5MB）。');
    return new Error('共有先に接続・保存できませんでした。接続状態を確認してください。');
  }
  function createSupabaseAdapter(client) {
    let userId = null;
    async function rpc(name, args) {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const currentId = sessionData?.session?.user?.id;
      if (sessionError || !currentId || (userId && userId !== currentId)) throw new Error('ログイン状態が変わりました。最新データを開いてください。');
      userId = currentId;
      const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(20000));
      if (error) throw explain(error);
      return data;
    }
    return {
      async load() {
        const result = await rpc('care_load_schedule');
        if (!result || !Number.isSafeInteger(result.revision)) throw new Error('共有データを読み込めませんでした。');
        return { ...result, data: normalize(result.data) };
      },
      async save(data, revision) {
        const result = await rpc('care_save_schedule', { p_data: normalize(data), p_revision: revision });
        if (!Number.isSafeInteger(result?.revision)) throw new Error('保存結果を確認できません。最新データを開いて確認してください。');
        return result;
      },
      async version() { return rpc('care_schedule_revision'); },
    };
  }
  root.ScheduleCloud = { createSupabaseAdapter };
})(globalThis);
