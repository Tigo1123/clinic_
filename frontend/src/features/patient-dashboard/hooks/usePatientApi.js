import { useCallback, useEffect, useState } from 'react';
import { patientApiRequest } from '../../../services/apiClient';

/** Shared patient data loader with explicit retries and optional conditional polling. */
export function usePatientApi(path,{pollWhen=null,pollInterval=45000}={}){
  const [result,setResult]=useState({path:null,data:null,error:null,loading:true});
  const [reloadToken,setReloadToken]=useState(0);
  const reload=useCallback(()=>{setResult(current=>({...current,error:null,loading:true}));setReloadToken(token=>token+1)},[]);
  useEffect(()=>{
    let current=true;
    let pollTimer;
    setResult((currentResult)=>currentResult.path===path?currentResult:{path,data:null,error:null,loading:true});
    patientApiRequest(path)
      .then(data=>{if(current){setResult({path,data,error:null,loading:false});if(pollWhen?.(data))pollTimer=setTimeout(()=>setReloadToken(token=>token+1),pollInterval)}})
      .catch(error=>{if(current)setResult({path,data:null,error,loading:false})});
    return()=>{current=false;clearTimeout(pollTimer)};
  },[path,reloadToken,pollWhen,pollInterval]);
  const isCurrent=result.path===path;
  return{data:isCurrent?result.data:null,error:isCurrent?result.error?.message||'':'',errorCode:isCurrent?result.error?.code:null,errorStatus:isCurrent?result.error?.status:null,loading:!isCurrent||result.loading,reload};
}
