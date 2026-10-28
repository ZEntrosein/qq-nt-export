/** Explicit export evidence. Missing files or an absent flag alone do not prove a download failed. */
export interface MediaExportState {
    version: 1;
    status: 'failed' | 'skipped';
    stage: 'download' | 'export';
    code: 'download-failed' | 'download-skipped' | 'source-missing' | 'copy-failed';
}

export function mediaExportState(info:any):MediaExportState|undefined {
    if(info?.status==='skipped')return {version:1,status:'skipped',stage:'download',code:'download-skipped'};
    if(info?.status==='failed')return {version:1,status:'failed',stage:'download',code:'download-failed'};
    const value=info?.exportState;
    if(value?.version===1&&((value.status==='skipped'&&value.stage==='download'&&value.code==='download-skipped')
        ||(value.status==='failed'&&((value.stage==='download'&&value.code==='download-failed')
            ||(value.stage==='export'&&['source-missing','copy-failed'].includes(value.code))))))
        return {version:1,status:value.status,stage:value.stage,code:value.code};
    return undefined;
}

export function applyMediaExportState(data:any, info:any):void {
    const declared=String(data?.md5||data?.fileMd5||'').toLowerCase(),actual=String(info?.md5||'').toLowerCase();
    if(declared&&actual&&declared!==actual)return;
    const state=mediaExportState(info);
    if(state){
        data.exportState=state;
        if(info.md5)data.md5=String(info.md5);
    }else if(info?.status==='downloaded'||[true,1,'1'].includes(info?.accessible))delete data.exportState;
}

export function mediaStateLabel(info:any):string {
    const state=mediaExportState(info);
    return !state?'':state.status==='skipped'?'[已跳过下载]':state.stage==='export'?'[媒体导出失败]':'[媒体获取失败]';
}

export function mediaExportKey(type:string,data:any):string {
    const name=String(data?.localPath||data?.filename||data?.fileName||'').replace(/\\/g,'/').split('/').pop()||'';
    return name?`${type}:${name}`:'';
}

export function renderMediaState(info:any,type:string,escape:(text:string)=>string):string {
    const state=mediaExportState(info);if(!state)return '';
    const name=String(info?.filename||info?.fileName||'');
    const labels:Record<string,string>={image:'图片',video:'视频',audio:'语音',file:'附件'},label=labels[type]||'媒体';
    const skipped=state.status==='skipped';
    const title=skipped?'已主动跳过下载':state.stage==='download'?'媒体获取失败':'媒体导出失败';
    return `<span class="export-media-issue ${skipped?'export-media-skipped':'export-media-failure'}" role="note"><strong>${skipped?'—':'⚠'} ${title} · ${label}</strong><span>${escape(name||label)}</span><span>${skipped?'本次导出选择不下载此类资源。':'此处原有媒体未成功保存；可重试失败媒体或从其他备份补齐。'}</span></span>`;
}

export function decorateMediaHtml(html:string,type:string,data:any,escape:(text:string)=>string):string {
    if(!data?.localPath&&!data?.exportState)return html;
    const key=mediaExportKey(type,data),end=html.indexOf('>');
    return key&&end>=0?html.slice(0,end)+` data-media-export-key="${escape(key)}"`+html.slice(end):html;
}
