(function(){
  "use strict";

  var core=window.BioCalculoCampo;
  var DB_NAME="BioCalculoBPL";
  var DB_VERSION=1;
  var STORE_APPLICATIONS="applications";
  var STORE_PHOTOS="photos";
  var STORE_EVENTS="events";
  var BACKUP_FORMAT="BPLBackupV1";
  var MAX_PHOTOS=6;
  var currentRecord=null;
  var currentStep=1;
  var db=null;
  var saveTimer=null;
  var reasonResolver=null;
  var photoObjectUrls=[];

  var $=function(selector){return document.querySelector(selector);};
  var $$=function(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));};
  var form=$("#applicationForm");

  function uuid(){
    if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
    return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(char){
      var random=Math.random()*16|0;
      return(char==="x"?random:(random&3|8)).toString(16);
    });
  }

  function nowIso(){return new Date().toISOString();}

  function localDateTimeValue(date){
    var value=date instanceof Date?date:new Date(date||Date.now());
    var shifted=new Date(value.getTime()-value.getTimezoneOffset()*60000);
    return shifted.toISOString().slice(0,16);
  }

  function formatDateTime(value){
    if(!value)return"-";
    var date=new Date(value);
    if(Number.isNaN(date.getTime()))return String(value);
    return date.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
  }

  function formatDate(value){
    if(!value)return"-";
    var date=new Date(value+"T12:00:00");
    if(Number.isNaN(date.getTime()))return String(value);
    return date.toLocaleDateString("pt-BR");
  }

  function escapeHtml(value){
    return String(value===undefined||value===null?"":value)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function showToast(message){
    var toast=$("#toast");
    toast.textContent=message;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer=setTimeout(function(){toast.classList.remove("show");},2600);
  }

  function setSaveState(state,text){
    var element=$("#saveState");
    element.className="save-state "+state;
    $("#saveStateText").textContent=text;
  }

  function requestToPromise(request){
    return new Promise(function(resolve,reject){
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error);};
    });
  }

  function transactionDone(transaction){
    return new Promise(function(resolve,reject){
      transaction.oncomplete=function(){resolve();};
      transaction.onerror=function(){reject(transaction.error);};
      transaction.onabort=function(){reject(transaction.error||new Error("Transação cancelada."));};
    });
  }

  function openDatabase(){
    return new Promise(function(resolve,reject){
      var request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=function(){
        var database=request.result;
        if(!database.objectStoreNames.contains(STORE_APPLICATIONS)){
          var applications=database.createObjectStore(STORE_APPLICATIONS,{keyPath:"id"});
          applications.createIndex("updatedAt","updatedAt");
          applications.createIndex("status","status");
        }
        if(!database.objectStoreNames.contains(STORE_PHOTOS)){
          var photos=database.createObjectStore(STORE_PHOTOS,{keyPath:"id"});
          photos.createIndex("applicationId","applicationId");
        }
        if(!database.objectStoreNames.contains(STORE_EVENTS)){
          var events=database.createObjectStore(STORE_EVENTS,{keyPath:"id"});
          events.createIndex("applicationId","applicationId");
          events.createIndex("at","at");
        }
      };
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error);};
    });
  }

  async function getAll(storeName,indexName,key){
    var transaction=db.transaction(storeName,"readonly");
    var source=indexName?transaction.objectStore(storeName).index(indexName):transaction.objectStore(storeName);
    var result=await requestToPromise(key===undefined?source.getAll():source.getAll(key));
    await transactionDone(transaction);
    return result;
  }

  async function getOne(storeName,id){
    var transaction=db.transaction(storeName,"readonly");
    var result=await requestToPromise(transaction.objectStore(storeName).get(id));
    await transactionDone(transaction);
    return result;
  }

  async function putOne(storeName,value){
    var transaction=db.transaction(storeName,"readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async function addEvent(applicationId,type,details){
    return putOne(STORE_EVENTS,{
      id:uuid(),
      applicationId:applicationId,
      type:type,
      at:nowIso(),
      details:details||{}
    });
  }

  function newRecord(){
    var now=nowIso();
    return{
      schemaVersion:1,
      id:uuid(),
      status:"draft",
      revision:1,
      parentId:null,
      revisesId:null,
      revisionReason:null,
      supersededBy:null,
      importedFromId:null,
      createdAt:now,
      updatedAt:now,
      finalizedAt:null,
      archivedAt:null,
      hash:null,
      study:{
        protocolCode:"",studyTitle:"",testFacility:"",siteName:"",fieldArea:"",
        crop:"",target:"",methodReference:"",responsibleName:"",responsibleRole:"",
        plannedDate:new Date().toISOString().slice(0,10),
        latitude:"",longitude:"",gpsAccuracy:"",gpsCapturedAt:null
      },
      environment:{
        applicationStartedAt:localDateTimeValue(),
        applicationEndedAt:"",
        temperatureStart:"",humidityStart:"",windStart:"",
        temperatureEnd:"",humidityEnd:"",windEnd:"",weatherNotes:""
      },
      equipment:{
        equipmentId:"",equipmentModel:"",calibrationDate:new Date().toISOString().slice(0,10),
        nozzleType:"",workingPressure:"",calibrationOperator:""
      },
      calibration:{
        measuredNozzles:"4",totalNozzles:"4",nozzleSpacing:"0,5",
        sprayVolume:"150",plotLength:"5",
        readings:Array.from({length:6},function(){return["","",""];}),
        results:null
      },
      treatments:[],
      generalNotes:"",
      deviations:[],
      evidence:[]
    };
  }

  function byId(id){return document.getElementById(id);}

  function fieldValue(id){return byId(id)?byId(id).value:"";}

  function setField(id,value){
    var element=byId(id);
    if(element)element.value=value===undefined||value===null?"":value;
  }

  function collectFormIntoRecord(){
    if(!currentRecord||currentRecord.status!=="draft")return currentRecord;
    currentRecord.study={
      protocolCode:fieldValue("protocolCode").trim(),
      studyTitle:fieldValue("studyTitle").trim(),
      testFacility:fieldValue("testFacility").trim(),
      siteName:fieldValue("siteName").trim(),
      fieldArea:fieldValue("fieldArea").trim(),
      crop:fieldValue("crop").trim(),
      target:fieldValue("target").trim(),
      methodReference:fieldValue("methodReference").trim(),
      responsibleName:fieldValue("responsibleName").trim(),
      responsibleRole:fieldValue("responsibleRole").trim(),
      plannedDate:fieldValue("plannedDate"),
      latitude:fieldValue("latitude").trim(),
      longitude:fieldValue("longitude").trim(),
      gpsAccuracy:fieldValue("gpsAccuracy").trim(),
      gpsCapturedAt:currentRecord.study.gpsCapturedAt||null
    };
    currentRecord.environment={
      applicationStartedAt:fieldValue("applicationStartedAt"),
      applicationEndedAt:fieldValue("applicationEndedAt"),
      temperatureStart:fieldValue("temperatureStart"),
      humidityStart:fieldValue("humidityStart"),
      windStart:fieldValue("windStart"),
      temperatureEnd:fieldValue("temperatureEnd"),
      humidityEnd:fieldValue("humidityEnd"),
      windEnd:fieldValue("windEnd"),
      weatherNotes:fieldValue("weatherNotes").trim()
    };
    currentRecord.equipment={
      equipmentId:fieldValue("equipmentId").trim(),
      equipmentModel:fieldValue("equipmentModel").trim(),
      calibrationDate:fieldValue("calibrationDate"),
      nozzleType:fieldValue("nozzleType").trim(),
      workingPressure:fieldValue("workingPressure").trim(),
      calibrationOperator:fieldValue("calibrationOperator").trim()
    };
    var readings=[];
    for(var nozzle=1;nozzle<=6;nozzle++){
      readings.push([1,2,3].map(function(reading){return fieldValue("nozzle"+nozzle+"r"+reading);}));
    }
    currentRecord.calibration={
      measuredNozzles:fieldValue("measuredNozzles"),
      totalNozzles:fieldValue("totalNozzles"),
      nozzleSpacing:fieldValue("nozzleSpacing"),
      sprayVolume:fieldValue("calibrationSprayVolume"),
      plotLength:fieldValue("calibrationPlotLength"),
      readings:readings,
      results:calculateCalibration(false)
    };
    currentRecord.generalNotes=fieldValue("generalNotes").trim();
    currentRecord.updatedAt=nowIso();
    return currentRecord;
  }

  function populateRecord(record){
    var study=record.study||{};
    Object.keys(study).forEach(function(key){if(byId(key))setField(key,study[key]);});
    var environment=record.environment||{};
    Object.keys(environment).forEach(function(key){if(byId(key))setField(key,environment[key]);});
    var equipment=record.equipment||{};
    Object.keys(equipment).forEach(function(key){if(byId(key))setField(key,equipment[key]);});
    var calibration=record.calibration||{};
    setField("measuredNozzles",calibration.measuredNozzles||"4");
    setField("totalNozzles",calibration.totalNozzles||"4");
    setField("nozzleSpacing",calibration.nozzleSpacing||"0,5");
    setField("calibrationSprayVolume",calibration.sprayVolume||"150");
    setField("calibrationPlotLength",calibration.plotLength||"5");
    var readings=calibration.readings||[];
    for(var nozzle=1;nozzle<=6;nozzle++){
      for(var reading=1;reading<=3;reading++){
        setField("nozzle"+nozzle+"r"+reading,(readings[nozzle-1]||[])[reading-1]||"");
      }
    }
    setField("generalNotes",record.generalNotes||"");
  }

  async function saveCurrent(options){
    options=options||{};
    if(!currentRecord||currentRecord.status!=="draft")return;
    collectFormIntoRecord();
    setSaveState("saving","Salvando...");
    try{
      await putOne(STORE_APPLICATIONS,currentRecord);
      if(options.event)await addEvent(currentRecord.id,options.event,options.details);
      setSaveState("saved","Salvo neste aparelho");
      updateWorkspaceHeader();
      if(options.renderList)await renderRecordList();
    }catch(error){
      console.error(error);
      setSaveState("error","Falha ao salvar");
      showToast("Não foi possível salvar. Exporte um backup assim que possível.");
    }
  }

  function scheduleSave(){
    if(!currentRecord||currentRecord.status!=="draft")return;
    setSaveState("saving","Alterações pendentes");
    clearTimeout(saveTimer);
    saveTimer=setTimeout(function(){saveCurrent();},500);
  }

  function buildNozzleInputs(){
    var container=$("#nozzleGrid");
    container.innerHTML="";
    for(var nozzle=1;nozzle<=6;nozzle++){
      var card=document.createElement("div");
      card.className="nozzle-card";
      card.id="nozzleCard"+nozzle;
      card.innerHTML=
        "<h4>Bico "+nozzle+" <small>— mL em 30 s</small></h4>"+
        '<div class="reading-row">'+
        [1,2,3].map(function(reading){
          return'<input id="nozzle'+nozzle+"r"+reading+'" type="text" inputmode="decimal" aria-label="Bico '+nozzle+", leitura "+reading+'" placeholder="L'+reading+'">';
        }).join("")+
        '</div><div class="nozzle-average" id="nozzleAverage'+nozzle+'">Média: -</div>';
      container.appendChild(card);
    }
  }

  function updateNozzleVisibility(){
    var measured=Math.max(1,Math.min(6,Math.round(core.parseNum(fieldValue("measuredNozzles")))||1));
    for(var nozzle=1;nozzle<=6;nozzle++){
      byId("nozzleCard"+nozzle).classList.toggle("hidden",nozzle>measured);
    }
  }

  function calculateCalibration(updateRecord){
    var readings=[];
    for(var nozzle=1;nozzle<=6;nozzle++){
      readings.push([1,2,3].map(function(reading){return fieldValue("nozzle"+nozzle+"r"+reading);}));
    }
    var result=core.calculateCalibration({
      measuredNozzles:fieldValue("measuredNozzles"),
      totalNozzles:fieldValue("totalNozzles"),
      nozzleSpacing:fieldValue("nozzleSpacing"),
      sprayVolume:fieldValue("calibrationSprayVolume"),
      plotLength:fieldValue("calibrationPlotLength"),
      readings:readings
    });
    result.perNozzle.forEach(function(item){
      var element=byId("nozzleAverage"+item.nozzle);
      if(element)element.textContent=item.averageMl30s>0?
        "Média: "+core.formatBR(item.averageMl30s,2)+" mL/30 s ("+core.formatBR(item.averageLmin,3)+" L/min)":"Média: -";
    });
    $("#outNozzleAverage").textContent=result.generalAverageMl30s>0?
      core.formatBR(result.generalAverageMl30s,2)+" mL/30 s":"-";
    $("#outCv").textContent=result.coefficientVariationPct===null?"-":core.formatBR(result.coefficientVariationPct,1)+"%";
    $("#outTotalFlow").textContent=result.estimatedTotalFlowLmin>0?core.formatBR(result.estimatedTotalFlowLmin,3)+" L/min":"-";
    $("#outBoomWidth").textContent=result.boomWidthM>0?core.formatBR(result.boomWidthM,2)+" m":"-";
    $("#outSpeed").textContent=result.speedKmh>0?core.formatBR(result.speedKmh,2)+" km/h":"-";
    $("#outPassTime").textContent=result.passTimeSeconds>0?core.formatBR(result.passTimeSeconds,2)+" s":"-";
    var alert=$("#cvAlert");
    if(result.coefficientVariationPct===null){
      alert.className="operational-alert neutral";
      alert.textContent="O CV será calculado quando ao menos dois bicos tiverem leituras válidas. A interpretação deve seguir o POP adotado pelo estudo.";
    }else{
      alert.className="operational-alert "+(result.coefficientVariationPct<=10?"neutral":"warning");
      alert.textContent="CV calculado: "+core.formatBR(result.coefficientVariationPct,1)+"%. Este valor é um dado de conferência; a aceitação ou ação corretiva deve seguir o POP do estudo.";
    }
    if(updateRecord&&currentRecord&&currentRecord.status==="draft"){
      currentRecord.calibration.results=result;
    }
    return result;
  }

  function treatmentInput(){
    return{
      treatmentName:fieldValue("treatmentName").trim(),
      productName:fieldValue("productName").trim(),
      productLot:fieldValue("productLot").trim(),
      productDescription:fieldValue("productDescription").trim(),
      doseHa:fieldValue("doseHa"),
      doseUnit:fieldValue("doseUnit"),
      sprayVolume:fieldValue("sprayVolume"),
      plotLength:fieldValue("plotLength"),
      plotWidth:fieldValue("plotWidth"),
      numPlots:fieldValue("numPlots"),
      numBottles:fieldValue("numBottles"),
      deadVolumeMl:fieldValue("deadVolumeMl"),
      bottleCapacity:fieldValue("bottleCapacity"),
      plotIdentifiers:fieldValue("plotIdentifiers").trim(),
      notes:fieldValue("treatmentNotes").trim()
    };
  }

  function calculateTreatmentPreview(){
    var input=treatmentInput();
    try{
      var result=core.calculateTreatment(input);
      $("#outPlotArea").textContent=core.formatBR(result.plotAreaM2,2)+" m² ("+core.formatBR(result.plotAreaHa,4)+" ha)";
      $("#outConcentration").textContent=core.formatBR(result.concentration,2)+" "+result.concentrationUnit;
      $("#outSprayPerPlot").textContent=core.formatBR(result.sprayPerPlotMl,2)+" mL";
      $("#outProductPerPlot").textContent=core.formatBR(result.productPerPlot,2)+" "+result.productUnit;
      $("#outSprayTotal").textContent=core.formatBR(result.sprayTotalMl,2)+" mL";
      $("#outProductTotal").textContent=core.formatBR(result.productTotal,2)+" "+result.productUnit;
      $("#outSprayPerBottle").textContent=core.formatBR(result.sprayPerBottleMl,2)+" mL";
      $("#outProductPerBottle").textContent=core.formatBR(result.productPerBottle,2)+" "+result.productUnit;
      $("#outWaterPerBottle").textContent=core.formatBR(result.waterPerBottleMl,2)+" mL"+(result.liquid?"":" aprox.");
      $("#outBottleNotice").textContent=result.bottleCapacityOk?
        result.requestedBottles+" garrafa(s); mínimo pela capacidade: "+result.minBottles:
        "Capacidade insuficiente. Mínimo: "+result.minBottles+" garrafa(s).";
      return result;
    }catch(error){
      ["outPlotArea","outConcentration","outSprayPerPlot","outProductPerPlot","outSprayTotal",
        "outProductTotal","outSprayPerBottle","outProductPerBottle","outWaterPerBottle","outBottleNotice"
      ].forEach(function(id){byId(id).textContent="-";});
      return null;
    }
  }

  function resetTreatmentEditor(){
    setField("treatmentName","");
    setField("productName","");
    setField("productLot","");
    setField("productDescription","");
    setField("plotIdentifiers","");
    setField("treatmentNotes","");
    setField("doseHa","1");
    setField("doseUnit","L/ha");
    setField("sprayVolume",fieldValue("calibrationSprayVolume")||"150");
    setField("plotLength",fieldValue("calibrationPlotLength")||"5");
    setField("plotWidth","3");
    setField("numPlots","4");
    setField("numBottles","4");
    setField("deadVolumeMl","300");
    setField("bottleCapacity","1,9");
    calculateTreatmentPreview();
  }

  function treatmentSummary(item){
    var input=item.input;
    var result=item.results;
    return[
      "Dose: "+input.doseHa+" "+input.doseUnit+" | Calda: "+input.sprayVolume+" L/ha",
      "Parcela: "+input.plotLength+" × "+input.plotWidth+" m | Quantidade: "+input.numPlots,
      "Produto total: "+core.formatBR(result.productTotal,2)+" "+result.productUnit,
      "Volume total: "+core.formatBR(result.sprayTotalMl,2)+" mL",
      "Por garrafa: "+core.formatBR(result.productPerBottle,2)+" "+result.productUnit+
        " em "+core.formatBR(result.sprayPerBottleMl,2)+" mL de calda"
    ].join("\n");
  }

  function renderTreatments(){
    var list=$("#treatmentList");
    var active=(currentRecord&&currentRecord.treatments||[]).filter(function(item){return!item.voidedAt;});
    $("#treatmentCount").textContent=active.length+" tratamento"+(active.length===1?"":"s")+" ativo"+(active.length===1?"":"s");
    $("#treatmentEmpty").classList.toggle("hidden",!!(currentRecord&&currentRecord.treatments.length));
    list.innerHTML="";
    (currentRecord&&currentRecord.treatments||[]).forEach(function(item,index){
      var element=document.createElement("article");
      element.className="treatment-item"+(item.voidedAt?" voided":"");
      element.innerHTML=
        '<div class="item-heading"><div><strong>'+escapeHtml(item.input.treatmentName)+'</strong>'+
        (item.voidedAt?'<div class="void-label">Anulado em '+escapeHtml(formatDateTime(item.voidedAt))+"</div>":"")+
        '</div>'+(currentRecord.status==="draft"&&!item.voidedAt?'<button class="btn danger btn-void-treatment" data-index="'+index+'" type="button">Anular</button>':"")+
        '</div><div class="item-meta"><span>Produto: '+escapeHtml(item.input.productName)+'</span><span>Lote: '+escapeHtml(item.input.productLot)+'</span><span>Incluído: '+escapeHtml(formatDateTime(item.createdAt))+
        '</span></div><div class="item-summary">'+escapeHtml(treatmentSummary(item))+"</div>"+
        (item.voidReason?'<div class="item-summary"><strong>Justificativa:</strong> '+escapeHtml(item.voidReason)+"</div>":"");
      list.appendChild(element);
    });
  }

  function renderDeviations(){
    var list=$("#deviationList");
    var active=(currentRecord&&currentRecord.deviations||[]).filter(function(item){return!item.voidedAt;});
    $("#deviationCount").textContent=active.length+" desvio"+(active.length===1?"":"s");
    $("#deviationEmpty").classList.toggle("hidden",!!(currentRecord&&currentRecord.deviations.length));
    list.innerHTML="";
    (currentRecord&&currentRecord.deviations||[]).forEach(function(item,index){
      var element=document.createElement("article");
      element.className="deviation-item"+(item.voidedAt?" voided":"");
      element.innerHTML=
        '<div class="item-heading"><strong>Desvio de '+escapeHtml(formatDateTime(item.createdAt))+"</strong>"+
        (currentRecord.status==="draft"&&!item.voidedAt?'<button class="btn danger btn-void-deviation" data-index="'+index+'" type="button">Anular</button>':"")+
        '</div><div class="item-summary"><strong>Descrição:</strong> '+escapeHtml(item.description)+"\n<strong>Ação:</strong> "+escapeHtml(item.action||"Não informada")+"</div>"+
        (item.voidReason?'<div class="item-summary"><strong>Justificativa da anulação:</strong> '+escapeHtml(item.voidReason)+"</div>":"");
      list.appendChild(element);
    });
  }

  function releasePhotoUrls(){
    photoObjectUrls.forEach(function(url){URL.revokeObjectURL(url);});
    photoObjectUrls=[];
  }

  async function renderPhotos(){
    releasePhotoUrls();
    var list=$("#photoGrid");
    list.innerHTML="";
    var photos=currentRecord?await getAll(STORE_PHOTOS,"applicationId",currentRecord.id):[];
    var metadata=new Map((currentRecord&&currentRecord.evidence||[]).map(function(item){return[item.id,item];}));
    $("#photoEmpty").classList.toggle("hidden",photos.length>0);
    photos.sort(function(a,b){return String(a.createdAt).localeCompare(String(b.createdAt));});
    photos.forEach(function(photo){
      var meta=metadata.get(photo.id)||photo;
      var url=URL.createObjectURL(photo.blob);
      photoObjectUrls.push(url);
      var card=document.createElement("article");
      card.className="photo-card"+(meta.voidedAt?" voided":"");
      card.innerHTML='<img src="'+url+'" alt="'+escapeHtml(meta.name||"Evidência fotográfica")+'">'+
        '<div class="photo-meta">'+escapeHtml(meta.name||"Foto")+"<br>"+escapeHtml(formatDateTime(meta.createdAt))+
        (meta.voidedAt?"<br><strong>Anulada:</strong> "+escapeHtml(meta.voidReason||"Sem motivo"):"")+
        (currentRecord.status==="draft"&&!meta.voidedAt?'<br><button class="btn danger btn-void-photo" data-photo-id="'+escapeHtml(meta.id)+'" type="button">Anular evidência</button>':"")+
        "</div>";
      list.appendChild(card);
    });
  }

  function reviewPair(label,value){
    return"<p><strong>"+escapeHtml(label)+":</strong> "+escapeHtml(value||"-")+"</p>";
  }

  function renderReview(){
    if(!currentRecord)return;
    if(currentRecord.status==="draft")collectFormIntoRecord();
    var study=currentRecord.study||{};
    var environment=currentRecord.environment||{};
    var equipment=currentRecord.equipment||{};
    var calibration=currentRecord.calibration&&currentRecord.calibration.results;
    var activeTreatments=(currentRecord.treatments||[]).filter(function(item){return!item.voidedAt;});
    var activeDeviations=(currentRecord.deviations||[]).filter(function(item){return!item.voidedAt;});
    var activeEvidence=(currentRecord.evidence||[]).filter(function(item){return!item.voidedAt;});
    $("#reviewSummary").innerHTML=
      '<div class="review-grid">'+
      '<div class="review-block"><h4>Ensaio</h4>'+
      reviewPair("Protocolo",study.protocolCode)+reviewPair("Título",study.studyTitle)+
      reviewPair("Local",[study.testFacility,study.siteName,study.fieldArea].filter(Boolean).join(" — "))+reviewPair("Cultura / alvo",[study.crop,study.target].filter(Boolean).join(" / "))+
      reviewPair("Responsável",[study.responsibleName,study.responsibleRole].filter(Boolean).join(" — "))+"</div>"+
      '<div class="review-block"><h4>Aplicação</h4>'+
      reviewPair("Período",[formatDateTime(environment.applicationStartedAt),formatDateTime(environment.applicationEndedAt)].join(" até "))+reviewPair("Equipamento",[equipment.equipmentId,equipment.equipmentModel].filter(Boolean).join(" — "))+
      reviewPair("Bicos / pressão",[equipment.nozzleType,equipment.workingPressure].filter(Boolean).join(" — "))+reviewPair("CV",calibration&&calibration.coefficientVariationPct!==null?core.formatBR(calibration.coefficientVariationPct,1)+"%":"Não calculado")+"</div>"+
      '<div class="review-block"><h4>Conteúdo</h4>'+
      reviewPair("Tratamentos ativos",String(activeTreatments.length))+reviewPair("Desvios ativos",String(activeDeviations.length))+
      reviewPair("Fotos ativas",String(activeEvidence.length))+reviewPair("Observações",currentRecord.generalNotes||"Nenhuma")+"</div>"+
      '<div class="review-block"><h4>Integridade</h4>'+
      reviewPair("Estado",statusLabel(currentRecord.status))+reviewPair("Revisão",String(currentRecord.revision||1))+
      reviewPair("Atualizado",formatDateTime(currentRecord.updatedAt))+reviewPair("Hash SHA-256",currentRecord.hash||"Gerado na finalização")+"</div>"+
      "</div>";
  }

  function statusLabel(status){
    return{draft:"Rascunho",finalized:"Finalizado",archived:"Arquivado",superseded:"Substituído por revisão"}[status]||status;
  }

  function updateWorkspaceHeader(){
    if(!currentRecord)return;
    var title=currentRecord.study&&currentRecord.study.studyTitle||
      currentRecord.study&&currentRecord.study.protocolCode||"Nova aplicação";
    $("#workspaceTitle").textContent=title;
    $("#recordIdentifier").textContent="ID "+currentRecord.id;
    $("#recordRevision").textContent="Revisão "+(currentRecord.revision||1);
    var status=$("#recordStatus");
    status.textContent=statusLabel(currentRecord.status);
    status.className="status "+currentRecord.status;
    $("#btnArchiveRecord").classList.toggle("hidden",currentRecord.status!=="finalized");
    $("#btnCreateRevision").classList.toggle("hidden",!(currentRecord.status==="finalized"||currentRecord.status==="archived"));
  }

  function setLockedState(){
    var locked=!currentRecord||currentRecord.status!=="draft";
    $$("#applicationForm input, #applicationForm select, #applicationForm textarea").forEach(function(element){
      if(["backupFile"].includes(element.id))return;
      element.disabled=locked;
    });
    ["btnCaptureGps","btnAddTreatment","btnAddDeviation"].forEach(function(id){
      if(byId(id))byId(id).disabled=locked;
    });
    $("#photoFiles").disabled=locked;
    $("#btnFinalize").classList.toggle("hidden",locked);
    $(".step-actions").classList.toggle("hidden",false);
    var old=$(".locked-message");
    if(old)old.remove();
    if(locked){
      var message=document.createElement("div");
      message.className="locked-message";
      message.textContent="Este registro está protegido contra edição. Para corrigir dados, crie uma nova revisão justificada.";
      form.insertBefore(message,form.firstChild);
    }
  }

  async function renderRecordList(){
    var records=await getAll(STORE_APPLICATIONS);
    records.sort(function(a,b){return String(b.updatedAt).localeCompare(String(a.updatedAt));});
    var list=$("#recordList");
    list.innerHTML="";
    $("#recordEmpty").classList.toggle("hidden",records.length>0);
    records.forEach(function(record){
      var item=document.createElement("article");
      item.className="record-item";
      var title=record.study&&record.study.studyTitle||record.study&&record.study.protocolCode||"Aplicação sem título";
      item.innerHTML=
        '<div class="record-main"><strong>'+escapeHtml(title)+'</strong><div class="record-meta">'+
        "<span>"+escapeHtml(statusLabel(record.status))+"</span><span>Rev. "+escapeHtml(record.revision||1)+"</span>"+
        "<span>"+escapeHtml(formatDateTime(record.updatedAt))+"</span><span>"+(record.treatments||[]).filter(function(entry){return!entry.voidedAt;}).length+" tratamento(s)</span>"+
        '</div></div><div class="record-actions"><button class="btn secondary btn-open-record" data-id="'+escapeHtml(record.id)+'" type="button">Abrir</button>'+
        (record.status!=="archived"?'<button class="btn secondary btn-export-record" data-id="'+escapeHtml(record.id)+'" type="button">JSON</button>':"")+
        "</div>";
      list.appendChild(item);
    });
  }

  async function openRecord(id){
    clearTimeout(saveTimer);
    var record=await getOne(STORE_APPLICATIONS,id);
    if(!record){showToast("Registro não encontrado.");return;}
    currentRecord=record;
    populateRecord(record);
    resetTreatmentEditor();
    updateNozzleVisibility();
    calculateCalibration(false);
    renderTreatments();
    renderDeviations();
    await renderPhotos();
    renderReview();
    updateWorkspaceHeader();
    setLockedState();
    $("#workspace").classList.remove("hidden");
    $(".dashboard").classList.add("hidden");
    goToStep(1);
    setSaveState("saved",record.status==="draft"?"Salvo neste aparelho":"Registro protegido");
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function createRecord(){
    currentRecord=newRecord();
    await putOne(STORE_APPLICATIONS,currentRecord);
    await addEvent(currentRecord.id,"created",{revision:1});
    await openRecord(currentRecord.id);
  }

  function closeRecord(){
    clearTimeout(saveTimer);
    var finish=async function(){
      currentRecord=null;
      releasePhotoUrls();
      $("#workspace").classList.add("hidden");
      $(".dashboard").classList.remove("hidden");
      await renderRecordList();
      window.scrollTo({top:0,behavior:"smooth"});
    };
    if(currentRecord&&currentRecord.status==="draft"){
      saveCurrent({renderList:false}).then(finish);
    }else finish();
  }

  function goToStep(step){
    currentStep=Math.max(1,Math.min(4,Number(step)||1));
    $$(".step-panel").forEach(function(panel){panel.classList.toggle("hidden",Number(panel.dataset.panel)!==currentStep);});
    $$(".step-button").forEach(function(button){button.classList.toggle("active",Number(button.dataset.step)===currentStep);});
    $("#btnPreviousStep").disabled=currentStep===1;
    $("#btnNextStep").classList.toggle("hidden",currentStep===4);
    if(currentStep===4)renderReview();
    if(currentStep===2)calculateCalibration(false);
    window.scrollTo({top:$("#workspace").offsetTop-12,behavior:"smooth"});
  }

  function validateFinalization(){
    collectFormIntoRecord();
    var missing=[];
    if(!currentRecord.study.protocolCode)missing.push("protocolo/código do estudo");
    if(!currentRecord.study.studyTitle)missing.push("título do ensaio");
    if(!currentRecord.study.responsibleName)missing.push("responsável pela aplicação");
    if(!(currentRecord.treatments||[]).some(function(item){return!item.voidedAt;}))missing.push("ao menos um tratamento ativo");
    return missing;
  }

  async function sha256Record(record){
    var clone=JSON.parse(JSON.stringify(record));
    clone.hash=null;
    delete clone.status;
    delete clone.updatedAt;
    delete clone.archivedAt;
    delete clone.supersededBy;
    var text=core.stableStringify(clone);
    if(window.crypto&&crypto.subtle&&window.TextEncoder){
      var digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest)).map(function(byte){return byte.toString(16).padStart(2,"0");}).join("");
    }
    var hash=2166136261;
    for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return"fallback-"+(hash>>>0).toString(16).padStart(8,"0");
  }

  function blobToDataUrl(blob){
    return new Promise(function(resolve,reject){
      var reader=new FileReader();
      reader.onload=function(){resolve(reader.result);};
      reader.onerror=function(){reject(reader.error);};
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl){
    var parts=dataUrl.split(",");
    var mime=(parts[0].match(/:(.*?);/)||[])[1]||"application/octet-stream";
    var binary=atob(parts[1]);
    var bytes=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:mime});
  }

  async function buildBackup(applicationIds){
    var allRecords=await getAll(STORE_APPLICATIONS);
    var allowed=new Set(applicationIds||allRecords.map(function(item){return item.id;}));
    var records=allRecords.filter(function(item){return allowed.has(item.id);});
    var allPhotos=await getAll(STORE_PHOTOS);
    var allEvents=await getAll(STORE_EVENTS);
    var photos=[];
    for(var photo of allPhotos.filter(function(item){return allowed.has(item.applicationId);})){
      photos.push({
        id:photo.id,
        applicationId:photo.applicationId,
        name:photo.name,
        type:photo.type,
        size:photo.size,
        width:photo.width,
        height:photo.height,
        createdAt:photo.createdAt,
        dataUrl:await blobToDataUrl(photo.blob)
      });
    }
    return{
      format:BACKUP_FORMAT,
      version:1,
      exportedAt:nowIso(),
      generator:"BioCalculo Campo",
      records:records,
      events:allEvents.filter(function(item){return allowed.has(item.applicationId);}),
      photos:photos
    };
  }

  function safeFilePart(value){
    return String(value||"aplicacao").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70)||"aplicacao";
  }

  function downloadBlob(blob,filename){
    var url=URL.createObjectURL(blob);
    var anchor=document.createElement("a");
    anchor.href=url;
    anchor.download=filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1500);
  }

  async function exportApplications(ids,filename){
    var backup=await buildBackup(ids);
    downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}),filename);
  }

  async function lineageIds(record){
    if(!record)return[];
    var rootId=record.parentId||record.id;
    var all=await getAll(STORE_APPLICATIONS);
    return all.filter(function(item){
      return item.id===rootId||item.parentId===rootId;
    }).map(function(item){return item.id;});
  }

  async function importBackup(file){
    var text=await file.text();
    var backup=JSON.parse(text);
    if(!backup||backup.format!==BACKUP_FORMAT||!Array.isArray(backup.records)){
      throw new Error("Arquivo não reconhecido como backup BPL do BioCalculo.");
    }
    var existing=await getAll(STORE_APPLICATIONS);
    var existingById=new Map(existing.map(function(item){return[item.id,item];}));
    var appMap=new Map();
    var imported=0;
    var ignored=0;
    for(var source of backup.records){
      var record=JSON.parse(JSON.stringify(source));
      var previous=existingById.get(record.id);
      if(previous&&core.stableStringify(previous)===core.stableStringify(record)){
        appMap.set(source.id,record.id);
        ignored++;
        continue;
      }
      if(previous){
        var oldId=record.id;
        record.id=uuid();
        record.importedFromId=oldId;
      }
      appMap.set(source.id,record.id);
      await putOne(STORE_APPLICATIONS,record);
      await addEvent(record.id,"imported",{sourceId:source.id,exportedAt:backup.exportedAt||null});
      imported++;
    }
    var photoIdMap=new Map();
    for(var sourcePhoto of backup.photos||[]){
      var targetApplicationId=appMap.get(sourcePhoto.applicationId);
      if(!targetApplicationId)continue;
      var targetPhotoId=sourcePhoto.id;
      if(targetApplicationId!==sourcePhoto.applicationId||await getOne(STORE_PHOTOS,targetPhotoId)){
        targetPhotoId=uuid();
      }
      photoIdMap.set(sourcePhoto.id,targetPhotoId);
      await putOne(STORE_PHOTOS,{
        id:targetPhotoId,
        applicationId:targetApplicationId,
        name:sourcePhoto.name,
        type:sourcePhoto.type,
        size:sourcePhoto.size,
        width:sourcePhoto.width,
        height:sourcePhoto.height,
        createdAt:sourcePhoto.createdAt,
        blob:dataUrlToBlob(sourcePhoto.dataUrl)
      });
    }
    for(var sourceRecord of backup.records){
      var targetId=appMap.get(sourceRecord.id);
      if(!targetId||targetId===sourceRecord.id)continue;
      var target=await getOne(STORE_APPLICATIONS,targetId);
      target.evidence=(target.evidence||[]).map(function(meta){
        var copy=Object.assign({},meta);
        copy.id=photoIdMap.get(meta.id)||meta.id;
        return copy;
      });
      await putOne(STORE_APPLICATIONS,target);
    }
    for(var event of backup.events||[]){
      var mappedId=appMap.get(event.applicationId);
      if(!mappedId)continue;
      await putOne(STORE_EVENTS,Object.assign({},event,{id:uuid(),applicationId:mappedId,importedAt:nowIso()}));
    }
    await renderRecordList();
    showToast(imported+" registro(s) restaurado(s); "+ignored+" já existente(s).");
  }

  function loadImage(file){
    return new Promise(function(resolve,reject){
      var image=new Image();
      var url=URL.createObjectURL(file);
      image.onload=function(){URL.revokeObjectURL(url);resolve(image);};
      image.onerror=function(){URL.revokeObjectURL(url);reject(new Error("Não foi possível ler "+file.name));};
      image.src=url;
    });
  }

  async function compressPhoto(file){
    var image=await loadImage(file);
    var scale=Math.min(1,1600/Math.max(image.width,image.height));
    var width=Math.max(1,Math.round(image.width*scale));
    var height=Math.max(1,Math.round(image.height*scale));
    var canvas=document.createElement("canvas");
    canvas.width=width;
    canvas.height=height;
    canvas.getContext("2d").drawImage(image,0,0,width,height);
    var blob=await new Promise(function(resolve){canvas.toBlob(resolve,"image/jpeg",.8);});
    if(!blob)throw new Error("Falha ao comprimir "+file.name);
    return{blob:blob,width:width,height:height};
  }

  async function addPhotos(files){
    if(!currentRecord||currentRecord.status!=="draft")return;
    var active=(currentRecord.evidence||[]).filter(function(item){return!item.voidedAt;}).length;
    var selected=Array.from(files).slice(0,Math.max(0,MAX_PHOTOS-active));
    if(!selected.length){showToast("O limite é de 6 fotos ativas por aplicação.");return;}
    setSaveState("saving","Processando fotos...");
    for(var file of selected){
      var compressed=await compressPhoto(file);
      var id=uuid();
      var createdAt=nowIso();
      await putOne(STORE_PHOTOS,{
        id:id,applicationId:currentRecord.id,name:file.name,type:"image/jpeg",
        size:compressed.blob.size,width:compressed.width,height:compressed.height,
        createdAt:createdAt,blob:compressed.blob
      });
      currentRecord.evidence.push({
        id:id,name:file.name,type:"image/jpeg",size:compressed.blob.size,
        width:compressed.width,height:compressed.height,createdAt:createdAt,
        voidedAt:null,voidReason:null
      });
      await addEvent(currentRecord.id,"photo_added",{photoId:id,name:file.name});
    }
    await saveCurrent();
    await renderPhotos();
    renderReview();
    showToast(selected.length+" foto(s) adicionada(s).");
  }

  function askReason(title,help){
    $("#reasonTitle").textContent=title;
    $("#reasonHelp").textContent=help;
    $("#reasonText").value="";
    $("#reasonDialog").showModal();
    return new Promise(function(resolve){reasonResolver=resolve;});
  }

  function finishReasonDialog(value){
    if(reasonResolver){reasonResolver(value);reasonResolver=null;}
  }

  async function createRevision(){
    var reason=await askReason("Criar nova revisão","O registro original permanecerá preservado. Descreva por que uma correção é necessária.");
    if(!reason)return;
    var original=currentRecord;
    var revision=JSON.parse(JSON.stringify(original));
    revision.id=uuid();
    revision.status="draft";
    revision.revision=(original.revision||1)+1;
    revision.parentId=original.parentId||original.id;
    revision.revisesId=original.id;
    revision.revisionReason=reason;
    revision.supersededBy=null;
    revision.createdAt=nowIso();
    revision.updatedAt=revision.createdAt;
    revision.finalizedAt=null;
    revision.archivedAt=null;
    revision.hash=null;
    var photos=await getAll(STORE_PHOTOS,"applicationId",original.id);
    var photoMap=new Map();
    for(var photo of photos){
      var newPhotoId=uuid();
      photoMap.set(photo.id,newPhotoId);
      await putOne(STORE_PHOTOS,Object.assign({},photo,{id:newPhotoId,applicationId:revision.id}));
    }
    revision.evidence=(revision.evidence||[]).map(function(meta){
      return Object.assign({},meta,{id:photoMap.get(meta.id)||meta.id});
    });
    original.status="superseded";
    original.supersededBy=revision.id;
    original.updatedAt=nowIso();
    await putOne(STORE_APPLICATIONS,original);
    await putOne(STORE_APPLICATIONS,revision);
    await addEvent(original.id,"superseded",{revisionId:revision.id,reason:reason});
    await addEvent(revision.id,"revision_created",{sourceId:original.id,reason:reason});
    await openRecord(revision.id);
    showToast("Nova revisão criada. O original foi preservado.");
  }

  async function archiveRecord(){
    if(!currentRecord||currentRecord.status!=="finalized")return;
    currentRecord.status="archived";
    currentRecord.archivedAt=nowIso();
    currentRecord.updatedAt=currentRecord.archivedAt;
    await putOne(STORE_APPLICATIONS,currentRecord);
    await addEvent(currentRecord.id,"archived",{});
    updateWorkspaceHeader();
    setLockedState();
    renderReview();
    showToast("Registro arquivado sem exclusão.");
  }

  function reportLines(record){
    var study=record.study||{};
    var env=record.environment||{};
    var equipment=record.equipment||{};
    var calibration=record.calibration&&record.calibration.results;
    var lines=[
      "BIOCALCULO CAMPO — REGISTRO DE APLICACAO",
      "Apoio documental BPL — não constitui certificação de conformidade",
      "",
      "IDENTIFICACAO",
      "ID: "+record.id,
      "Estado: "+statusLabel(record.status)+" | Revisao: "+(record.revision||1),
      "Protocolo: "+(study.protocolCode||"-"),
      "Titulo: "+(study.studyTitle||"-"),
      "Instalacao: "+(study.testFacility||"-"),
      "Local: "+([study.siteName,study.fieldArea].filter(Boolean).join(" — ")||"-"),
      "Coordenadas: "+([study.latitude,study.longitude].filter(Boolean).join(", ")||"-"),
      "Cultura / alvo: "+([study.crop,study.target].filter(Boolean).join(" / ")||"-"),
      "Metodo / POP: "+(study.methodReference||"-"),
      "Responsavel: "+([study.responsibleName,study.responsibleRole].filter(Boolean).join(" — ")||"-"),
      "",
      "APLICACAO E EQUIPAMENTO",
      "Inicio: "+formatDateTime(env.applicationStartedAt)+" | Fim: "+formatDateTime(env.applicationEndedAt),
      "Clima inicial: "+(env.temperatureStart||"-")+" C; "+(env.humidityStart||"-")+"% UR; "+(env.windStart||"-")+" km/h vento",
      "Clima final: "+(env.temperatureEnd||"-")+" C; "+(env.humidityEnd||"-")+"% UR; "+(env.windEnd||"-")+" km/h vento",
      "Condicoes adicionais: "+(env.weatherNotes||"-"),
      "Equipamento: "+([equipment.equipmentId,equipment.equipmentModel].filter(Boolean).join(" — ")||"-"),
      "Bico / pressao: "+([equipment.nozzleType,equipment.workingPressure].filter(Boolean).join(" — ")||"-"),
      "Data / operador da calibracao: "+formatDate(equipment.calibrationDate)+" / "+(equipment.calibrationOperator||"-"),
      ""
    ];
    if(calibration){
      lines.push("CALIBRACAO");
      lines.push("Bicos validos: "+calibration.validNozzles+" | Media: "+core.formatBR(calibration.generalAverageMl30s,2)+" mL/30 s");
      lines.push("CV: "+(calibration.coefficientVariationPct===null?"Nao calculado":core.formatBR(calibration.coefficientVariationPct,1)+"%"));
      lines.push("Vazao total: "+core.formatBR(calibration.estimatedTotalFlowLmin,3)+" L/min");
      lines.push("Velocidade: "+core.formatBR(calibration.speedKmh,2)+" km/h | Tempo de passada: "+core.formatBR(calibration.passTimeSeconds,2)+" s");
      calibration.perNozzle.forEach(function(nozzle){
        lines.push("Bico "+nozzle.nozzle+": leituras "+nozzle.readings.join(", ")+"; media "+core.formatBR(nozzle.averageMl30s,2)+" mL/30 s");
      });
      lines.push("");
    }
    lines.push("TRATAMENTOS");
    (record.treatments||[]).forEach(function(item,index){
      lines.push((index+1)+". "+item.input.treatmentName+(item.voidedAt?" [ANULADO]":""));
      lines.push("Produto: "+item.input.productName+" | Lote: "+item.input.productLot+" | "+(item.input.productDescription||"-"));
      lines.push(treatmentSummary(item).replace(/\n/g," | "));
      if(item.input.plotIdentifiers)lines.push("Parcelas: "+item.input.plotIdentifiers);
      if(item.input.notes)lines.push("Observacoes: "+item.input.notes);
      if(item.voidReason)lines.push("Justificativa da anulacao: "+item.voidReason);
    });
    lines.push("");
    lines.push("DESVIOS");
    var deviations=(record.deviations||[]).filter(function(item){return!item.voidedAt;});
    if(!deviations.length)lines.push("Nenhum desvio registrado.");
    deviations.forEach(function(item,index){
      lines.push((index+1)+". "+item.description+" | Acao: "+(item.action||"-"));
    });
    lines.push("");
    lines.push("OBSERVACOES GERAIS");
    lines.push(record.generalNotes||"Nenhuma.");
    lines.push("");
    lines.push("EVIDENCIAS");
    var evidence=(record.evidence||[]).filter(function(item){return!item.voidedAt;});
    lines.push(evidence.length+" foto(s) ativa(s) preservada(s) no backup JSON.");
    evidence.forEach(function(item){lines.push("- "+item.name+" ("+formatDateTime(item.createdAt)+")");});
    lines.push("");
    lines.push("INTEGRIDADE");
    lines.push("Criado: "+formatDateTime(record.createdAt));
    lines.push("Finalizado: "+formatDateTime(record.finalizedAt));
    lines.push("Hash SHA-256: "+(record.hash||"Ainda não finalizado"));
    if(record.revisionReason)lines.push("Motivo da revisao: "+record.revisionReason);
    return lines;
  }

  async function generatePdf(){
    if(!currentRecord)return;
    if(currentRecord.status==="draft")collectFormIntoRecord();
    var jsPDF=window.jspdf&&window.jspdf.jsPDF;
    if(!jsPDF){showToast("Gerador de PDF indisponível.");return;}
    var documentPdf=new jsPDF({unit:"pt",format:"a4"});
    var margin=42;
    var width=documentPdf.internal.pageSize.getWidth()-margin*2;
    var pageHeight=documentPdf.internal.pageSize.getHeight();
    var y=margin;
    documentPdf.setFont("helvetica","normal");
    documentPdf.setFontSize(9);
    reportLines(currentRecord).forEach(function(line,index){
      var wrapped=documentPdf.splitTextToSize(line||" ",width);
      wrapped.forEach(function(piece){
        if(y>pageHeight-margin){documentPdf.addPage();y=margin;}
        if(index===0){documentPdf.setFont("helvetica","bold");documentPdf.setFontSize(13);}
        documentPdf.text(piece,margin,y);
        if(index===0){documentPdf.setFont("helvetica","normal");documentPdf.setFontSize(9);}
        y+=13;
      });
    });
    var activeEvidence=new Set((currentRecord.evidence||[]).filter(function(item){
      return!item.voidedAt;
    }).map(function(item){return item.id;}));
    var photos=(await getAll(STORE_PHOTOS,"applicationId",currentRecord.id)).filter(function(photo){
      return activeEvidence.has(photo.id);
    });
    for(var photoIndex=0;photoIndex<photos.length;photoIndex++){
      var photo=photos[photoIndex];
      try{
        var dataUrl=await blobToDataUrl(photo.blob);
        documentPdf.addPage();
        documentPdf.setFont("helvetica","bold");
        documentPdf.setFontSize(12);
        documentPdf.text("Evidencia fotografica "+(photoIndex+1),margin,margin);
        documentPdf.setFont("helvetica","normal");
        documentPdf.setFontSize(9);
        documentPdf.text(photo.name||"Foto",margin,margin+16);
        var availableWidth=documentPdf.internal.pageSize.getWidth()-margin*2;
        var availableHeight=documentPdf.internal.pageSize.getHeight()-margin*2-42;
        var ratio=Math.min(availableWidth/photo.width,availableHeight/photo.height);
        var imageWidth=photo.width*ratio;
        var imageHeight=photo.height*ratio;
        documentPdf.addImage(dataUrl,"JPEG",margin,margin+30,imageWidth,imageHeight);
      }catch(error){
        console.warn("Foto não incluída no PDF:",error);
      }
    }
    var name=safeFilePart(currentRecord.study.protocolCode||currentRecord.study.studyTitle);
    documentPdf.save("BioCalculo-Campo-"+name+"-rev"+currentRecord.revision+".pdf");
  }

  async function finalizeRecord(){
    if(!currentRecord||currentRecord.status!=="draft")return;
    var missing=validateFinalization();
    if(missing.length){
      showToast("Falta preencher: "+missing.join(", ")+".");
      if(missing[0].includes("tratamento"))goToStep(3);else goToStep(1);
      return;
    }
    currentRecord.calibration.results=calculateCalibration(false);
    currentRecord.status="finalized";
    currentRecord.finalizedAt=nowIso();
    currentRecord.updatedAt=currentRecord.finalizedAt;
    currentRecord.hash=await sha256Record(currentRecord);
    await putOne(STORE_APPLICATIONS,currentRecord);
    await addEvent(currentRecord.id,"finalized",{hash:currentRecord.hash});
    updateWorkspaceHeader();
    setLockedState();
    renderTreatments();
    renderDeviations();
    await renderPhotos();
    renderReview();
    var filename="BioCalculo-Campo-"+safeFilePart(currentRecord.study.protocolCode||currentRecord.study.studyTitle)+"-rev"+currentRecord.revision+".json";
    await exportApplications(await lineageIds(currentRecord),filename);
    setSaveState("saved","Finalizado e protegido");
    showToast("Registro finalizado. O backup JSON foi baixado.");
  }

  function registerEvents(){
    form.addEventListener("input",function(event){
      if(!currentRecord||currentRecord.status!=="draft")return;
      if(event.target.closest(".treatment-editor"))calculateTreatmentPreview();
      if(event.target.closest("#nozzleGrid")||[
        "measuredNozzles","totalNozzles","nozzleSpacing","calibrationSprayVolume","calibrationPlotLength"
      ].includes(event.target.id)){
        updateNozzleVisibility();
        calculateCalibration(true);
      }
      scheduleSave();
    });
    form.addEventListener("change",function(event){
      if(event.target.closest(".treatment-editor"))calculateTreatmentPreview();
      updateNozzleVisibility();
      calculateCalibration(true);
      scheduleSave();
    });

    $("#btnNewApplication").addEventListener("click",createRecord);
    $("#btnCloseRecord").addEventListener("click",closeRecord);
    $("#btnPreviousStep").addEventListener("click",function(){goToStep(currentStep-1);});
    $("#btnNextStep").addEventListener("click",function(){goToStep(currentStep+1);});
    $$(".step-button").forEach(function(button){
      button.addEventListener("click",function(){goToStep(button.dataset.step);});
    });

    $("#recordList").addEventListener("click",async function(event){
      var open=event.target.closest(".btn-open-record");
      var exportButton=event.target.closest(".btn-export-record");
      if(open)await openRecord(open.dataset.id);
      if(exportButton){
        var record=await getOne(STORE_APPLICATIONS,exportButton.dataset.id);
        await exportApplications(await lineageIds(record),"BioCalculo-Campo-"+safeFilePart(record.study&&record.study.protocolCode||record.id)+".json");
      }
    });

    $("#btnAddTreatment").addEventListener("click",async function(){
      if(!currentRecord||currentRecord.status!=="draft")return;
      var input=treatmentInput();
      if(!input.treatmentName||!input.productName||!input.productLot){
        showToast("Informe nome do tratamento, produto e lote.");
        return;
      }
      try{
        var results=core.calculateTreatment(input);
        currentRecord.treatments.push({
          id:uuid(),createdAt:nowIso(),input:input,results:results,voidedAt:null,voidReason:null
        });
        await saveCurrent({event:"treatment_added",details:{name:input.treatmentName}});
        renderTreatments();
        renderReview();
        resetTreatmentEditor();
        showToast("Tratamento adicionado ao registro.");
      }catch(error){showToast(error.message);}
    });

    $("#treatmentList").addEventListener("click",async function(event){
      var button=event.target.closest(".btn-void-treatment");
      if(!button)return;
      var item=currentRecord.treatments[Number(button.dataset.index)];
      var reason=await askReason("Anular tratamento","O tratamento continuará no registro, marcado como anulado.");
      if(!reason)return;
      item.voidedAt=nowIso();
      item.voidReason=reason;
      await saveCurrent({event:"treatment_voided",details:{treatmentId:item.id,reason:reason}});
      renderTreatments();
      renderReview();
    });

    $("#btnAddDeviation").addEventListener("click",async function(){
      if(!currentRecord||currentRecord.status!=="draft")return;
      var description=fieldValue("deviationDescription").trim();
      var action=fieldValue("deviationAction").trim();
      if(!description){showToast("Descreva o desvio antes de adicionar.");return;}
      currentRecord.deviations.push({
        id:uuid(),createdAt:nowIso(),description:description,action:action,voidedAt:null,voidReason:null
      });
      setField("deviationDescription","");
      setField("deviationAction","");
      await saveCurrent({event:"deviation_added",details:{description:description}});
      renderDeviations();
      renderReview();
    });

    $("#deviationList").addEventListener("click",async function(event){
      var button=event.target.closest(".btn-void-deviation");
      if(!button)return;
      var item=currentRecord.deviations[Number(button.dataset.index)];
      var reason=await askReason("Anular desvio","O lançamento continuará visível e receberá a justificativa.");
      if(!reason)return;
      item.voidedAt=nowIso();
      item.voidReason=reason;
      await saveCurrent({event:"deviation_voided",details:{deviationId:item.id,reason:reason}});
      renderDeviations();
      renderReview();
    });

    $("#photoFiles").addEventListener("change",async function(event){
      try{await addPhotos(event.target.files);}catch(error){console.error(error);showToast(error.message);}
      event.target.value="";
    });

    $("#photoGrid").addEventListener("click",async function(event){
      var button=event.target.closest(".btn-void-photo");
      if(!button)return;
      var meta=currentRecord.evidence.find(function(item){return item.id===button.dataset.photoId;});
      if(!meta)return;
      var reason=await askReason("Anular evidência","A imagem continuará armazenada no registro e no backup.");
      if(!reason)return;
      meta.voidedAt=nowIso();
      meta.voidReason=reason;
      await saveCurrent({event:"photo_voided",details:{photoId:meta.id,reason:reason}});
      await renderPhotos();
      renderReview();
    });

    $("#btnCaptureGps").addEventListener("click",function(){
      if(!navigator.geolocation){showToast("Geolocalização não disponível neste aparelho.");return;}
      setSaveState("saving","Obtendo localização...");
      navigator.geolocation.getCurrentPosition(function(position){
        setField("latitude",position.coords.latitude.toFixed(7).replace(".",","));
        setField("longitude",position.coords.longitude.toFixed(7).replace(".",","));
        setField("gpsAccuracy",position.coords.accuracy.toFixed(1).replace(".",","));
        currentRecord.study.gpsCapturedAt=nowIso();
        saveCurrent({event:"gps_captured",details:{accuracy:position.coords.accuracy}});
        showToast("Localização registrada.");
      },function(){
        setSaveState("saved","Preenchimento manual disponível");
        showToast("Não foi possível obter o GPS. Preencha as coordenadas manualmente.");
      },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
    });

    $("#btnFinalize").addEventListener("click",finalizeRecord);
    $("#btnPdf").addEventListener("click",function(){
      generatePdf().catch(function(error){console.error(error);showToast("Não foi possível gerar o PDF.");});
    });
    $("#btnExportCurrent").addEventListener("click",async function(){
      if(!currentRecord)return;
      if(currentRecord.status==="draft")await saveCurrent();
      await exportApplications(await lineageIds(currentRecord),"BioCalculo-Campo-"+safeFilePart(currentRecord.study.protocolCode||currentRecord.id)+".json");
    });
    $("#btnExportAll").addEventListener("click",async function(){
      await exportApplications(null,"BioCalculo-Campo-backup-completo-"+new Date().toISOString().slice(0,10)+".json");
    });
    $("#backupFile").addEventListener("change",async function(event){
      var file=event.target.files[0];
      if(!file)return;
      try{await importBackup(file);}catch(error){console.error(error);showToast(error.message);}
      event.target.value="";
    });
    $("#btnCreateRevision").addEventListener("click",createRevision);
    $("#btnArchiveRecord").addEventListener("click",archiveRecord);

    $("#reasonDialog").addEventListener("close",function(){
      var value=$("#reasonDialog").returnValue;
      var reason=$("#reasonText").value.trim();
      finishReasonDialog(value==="default"&&reason?reason:null);
    });
    $("#btnConfirmReason").addEventListener("click",function(event){
      if(!$("#reasonText").value.trim()){
        event.preventDefault();
        showToast("A justificativa é obrigatória.");
      }
    });
  }

  async function init(){
    if(!window.indexedDB){
      setSaveState("error","Armazenamento indisponível");
      showToast("Este navegador não oferece o armazenamento necessário.");
      return;
    }
    buildNozzleInputs();
    db=await openDatabase();
    if(navigator.storage&&navigator.storage.persist){
      navigator.storage.persist().catch(function(){});
    }
    registerEvents();
    resetTreatmentEditor();
    updateNozzleVisibility();
    calculateCalibration(false);
    await renderRecordList();
    setSaveState("saved","Pronto para uso offline");
    if("serviceWorker"in navigator){
      navigator.serviceWorker.register("sw.js").catch(function(error){console.warn("Service worker:",error);});
    }
  }

  init().catch(function(error){
    console.error(error);
    setSaveState("error","Falha ao iniciar");
    showToast("Não foi possível abrir o banco local.");
  });
})();
