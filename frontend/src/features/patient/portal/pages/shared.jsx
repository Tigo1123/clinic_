import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { ErrorState, Skeleton } from '../../../../components/feedback/States';

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
export function State({loading,error,onRetry,children}){if(loading)return <div className="patient-card"><Skeleton/></div>;if(error)return <ErrorState message={error} onRetry={onRetry}/>;return children}
export function Empty({children}){return <div className="patient-card patient-empty">{children}</div>}
export const doctorName=(doctor,lang)=>
  lang==='ar'
    ? (doctor?.fullNameAr || doctor?.fullNameEn)
    : (doctor?.fullNameEn || doctor?.fullNameAr);

export function Collection({path,titleKey,render}){const{t}=useTranslation();const{data,error,loading,reload}=useApi(path);return <State loading={loading} error={error} onRetry={reload}><h1>{t(titleKey)}</h1>{!data?.length?<Empty>{t('noRecords')}</Empty>:data.map(item=><article className="patient-card" key={item.id}>{render(item)}</article>)}</State>}
