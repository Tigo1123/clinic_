import { useCallback, useEffect, useState } from 'react';
import { patientApiRequest as apiRequest, apiFetch, localizedApiErrorMessage } from '../../../services/apiClient.js';

const patientApiFetch = (path) => apiFetch(path, {}, 'patient');

export function useApi(path,{pollWhen=null,pollInterval=45000}={}){
  const [result,setResult]=useState({path:null,data:null,error:null,loading:true});
  const [reloadToken,setReloadToken]=useState(0);
  const reload=useCallback(()=>{setResult(current=>({...current,error:null,loading:true}));setReloadToken(token=>token+1)},[]);
  useEffect(()=>{
    let current=true;
    let pollTimer;
    setResult((currentResult)=>currentResult.path===path?currentResult:{path,data:null,error:null,loading:true});
    apiRequest(path)
      .then(data=>{if(current){setResult({path,data,error:null,loading:false});if(pollWhen?.(data))pollTimer=setTimeout(()=>setReloadToken(token=>token+1),pollInterval)}})
      .catch(error=>{if(current)setResult({path,data:null,error,loading:false})});
    return()=>{current=false;clearTimeout(pollTimer)};
  },[path,reloadToken,pollWhen,pollInterval]);
  const isCurrent=result.path===path;
  return{data:isCurrent?result.data:null,error:isCurrent?result.error?.message||'':'',errorCode:isCurrent?result.error?.code:null,errorStatus:isCurrent?result.error?.status:null,loading:!isCurrent||result.loading,reload};
}
export function usePagedList(path, { pageSize = 25, pollWhen = null, pollInterval = 45000 } = {}) {
  const [result, setResult] = useState({ data: null, error: null, loading: true, loadingMore: false, hasMore: false, page: 1 });
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let pollTimer;
    setResult({ data: null, error: null, loading: true, loadingMore: false, hasMore: false, page: 1 });
    const url = `${path}${path.includes('?') ? '&' : '?'}page=1&pageSize=${pageSize}`;
    patientApiFetch(url).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(localizedApiErrorMessage({ code: body?.code || body?.error?.code, status: response.status }, 'Unable to load this list.'));
      if (!active) return;
      const data = Array.isArray(body) ? body : [];
      setResult({ data, error: null, loading: false, loadingMore: false, hasMore: response.headers.get('X-Has-More') === 'true', page: 1 });
      if (pollWhen?.(data)) pollTimer = setTimeout(() => setReloadToken((value) => value + 1), pollInterval);
    }).catch((error) => { if (active) setResult({ data: null, error: error.message, loading: false, loadingMore: false, hasMore: false, page: 1 }); });
    return () => { active = false; clearTimeout(pollTimer); };
  }, [path, pageSize, reloadToken, pollWhen, pollInterval]);
  const loadMore = useCallback(async () => {
    if (result.loadingMore || !result.hasMore) return;
    const nextPage = result.page + 1;
    setResult((current) => ({ ...current, loadingMore: true, error: null }));
    try {
      const url = `${path}${path.includes('?') ? '&' : '?'}page=${nextPage}&pageSize=${pageSize}`;
      const response = await patientApiFetch(url);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(localizedApiErrorMessage({ code: body?.code || body?.error?.code, status: response.status }, 'Unable to load more records.'));
      setResult((current) => ({ ...current, data: [...(current.data || []), ...(Array.isArray(body) ? body : [])], loadingMore: false, hasMore: response.headers.get('X-Has-More') === 'true', page: nextPage }));
    } catch (error) {
      setResult((current) => ({ ...current, loadingMore: false, error: error.message }));
    }
  }, [path, pageSize, result.loadingMore, result.hasMore, result.page]);
  return { ...result, reload, loadMore };
}
