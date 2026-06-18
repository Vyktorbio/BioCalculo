(function(root,factory){
  var api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.BioCalculoCampo=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function parseNum(value){
    if(value===null||value===undefined||value==="")return 0;
    var cleaned=String(value).trim().replace(/\s+/g,"").replace(",",".");
    var number=Number.parseFloat(cleaned);
    return Number.isFinite(number)?number:0;
  }

  function round(value,places){
    var factor=Math.pow(10,places===undefined?8:places);
    return Math.round((value+Number.EPSILON)*factor)/factor;
  }

  function doseConfig(dose,unit){
    var numeric=parseNum(dose);
    if(unit==="L/ha")return{perHa:numeric*1000,productUnit:"mL",concentrationUnit:"mL/L",liquid:true};
    if(unit==="mL/ha")return{perHa:numeric,productUnit:"mL",concentrationUnit:"mL/L",liquid:true};
    if(unit==="kg/ha")return{perHa:numeric*1000,productUnit:"g",concentrationUnit:"g/L",liquid:false};
    return{perHa:numeric,productUnit:"g",concentrationUnit:"g/L",liquid:false};
  }

  function calculateTreatment(input){
    input=input||{};
    var cfg=doseConfig(input.doseHa,input.doseUnit||"L/ha");
    var sprayVolume=parseNum(input.sprayVolume);
    var plotLength=parseNum(input.plotLength);
    var plotWidth=parseNum(input.plotWidth);
    var numPlots=Math.max(1,Math.round(parseNum(input.numPlots))||1);
    var numBottles=Math.max(1,Math.round(parseNum(input.numBottles))||1);
    var deadVolumeMl=Math.max(0,parseNum(input.deadVolumeMl));
    var bottleCapacity=Math.max(0,parseNum(input.bottleCapacity));

    if(cfg.perHa<=0)throw new Error("A dose deve ser maior que zero.");
    if(sprayVolume<=0)throw new Error("O volume de calda deve ser maior que zero.");
    if(plotLength<=0||plotWidth<=0)throw new Error("As dimensões da parcela devem ser maiores que zero.");

    var plotAreaM2=plotLength*plotWidth;
    var plotAreaHa=plotAreaM2/10000;
    var concentration=cfg.perHa/sprayVolume;
    var sprayPerPlotMl=sprayVolume*plotAreaHa*1000;
    var productPerPlot=cfg.perHa*plotAreaHa;
    var sprayPlotsOnlyMl=sprayPerPlotMl*numPlots;
    var productPlotsOnly=productPerPlot*numPlots;
    var deadProduct=concentration*(deadVolumeMl/1000);
    var sprayTotalMl=sprayPlotsOnlyMl+deadVolumeMl;
    var productTotal=productPlotsOnly+deadProduct;
    var sprayPerBottleMl=sprayTotalMl/numBottles;
    var productPerBottle=productTotal/numBottles;
    var waterPerBottleMl=cfg.liquid?Math.max(sprayPerBottleMl-productPerBottle,0):sprayPerBottleMl;
    var minBottles=bottleCapacity>0?Math.ceil(sprayTotalMl/(bottleCapacity*1000)):0;

    return{
      plotAreaM2:round(plotAreaM2),
      plotAreaHa:round(plotAreaHa),
      concentration:round(concentration),
      sprayPerPlotMl:round(sprayPerPlotMl),
      productPerPlot:round(productPerPlot),
      sprayPlotsOnlyMl:round(sprayPlotsOnlyMl),
      productPlotsOnly:round(productPlotsOnly),
      deadVolumeMl:round(deadVolumeMl),
      deadProduct:round(deadProduct),
      sprayTotalMl:round(sprayTotalMl),
      productTotal:round(productTotal),
      sprayPerBottleMl:round(sprayPerBottleMl),
      productPerBottle:round(productPerBottle),
      waterPerBottleMl:round(waterPerBottleMl),
      minBottles:minBottles,
      requestedBottles:numBottles,
      bottleCapacityL:round(bottleCapacity),
      productUnit:cfg.productUnit,
      concentrationUnit:cfg.concentrationUnit,
      liquid:cfg.liquid,
      bottleCapacityOk:minBottles===0||numBottles>=minBottles
    };
  }

  function calculateCalibration(input){
    input=input||{};
    var measured=Math.max(1,Math.min(6,Math.round(parseNum(input.measuredNozzles))||1));
    var totalNozzles=Math.max(1,Math.round(parseNum(input.totalNozzles))||1);
    var spacing=parseNum(input.nozzleSpacing);
    var sprayVolume=parseNum(input.sprayVolume);
    var plotLength=parseNum(input.plotLength);
    var readings=Array.isArray(input.readings)?input.readings:[];
    var perNozzle=[];

    for(var i=0;i<measured;i++){
      var row=Array.isArray(readings[i])?readings[i]:[];
      var valid=row.map(parseNum).filter(function(value){return value>0;});
      var average30=valid.length?valid.reduce(function(sum,value){return sum+value;},0)/valid.length:0;
      perNozzle.push({
        nozzle:i+1,
        readings:row.map(parseNum),
        validReadings:valid.length,
        averageMl30s:round(average30),
        averageLmin:round(average30*2/1000)
      });
    }

    var validNozzles=perNozzle.filter(function(item){return item.averageMl30s>0;});
    var generalAverageMl30s=validNozzles.length?
      validNozzles.reduce(function(sum,item){return sum+item.averageMl30s;},0)/validNozzles.length:0;
    var generalAverageLmin=generalAverageMl30s*2/1000;
    var cv=null;
    if(validNozzles.length>=2){
      var variance=validNozzles.reduce(function(sum,item){
        return sum+Math.pow(item.averageMl30s-generalAverageMl30s,2);
      },0)/validNozzles.length;
      cv=generalAverageMl30s>0?(Math.sqrt(variance)/generalAverageMl30s)*100:null;
    }
    var totalFlow=generalAverageLmin*totalNozzles;
    var boomWidth=totalNozzles*spacing;
    var speedKmh=sprayVolume>0&&spacing>0?(600*generalAverageLmin)/(sprayVolume*spacing):0;
    var speedMs=speedKmh/3.6;
    var passTimeSeconds=speedMs>0&&plotLength>0?plotLength/speedMs:0;

    return{
      measuredNozzles:measured,
      totalNozzles:totalNozzles,
      perNozzle:perNozzle,
      validNozzles:validNozzles.length,
      generalAverageMl30s:round(generalAverageMl30s),
      generalAverageLmin:round(generalAverageLmin),
      coefficientVariationPct:cv===null?null:round(cv),
      estimatedTotalFlowLmin:round(totalFlow),
      boomWidthM:round(boomWidth),
      speedKmh:round(speedKmh),
      speedMs:round(speedMs),
      passTimeSeconds:round(passTimeSeconds)
    };
  }

  function stableStringify(value){
    if(value===null||typeof value!=="object")return JSON.stringify(value);
    if(Array.isArray(value))return"["+value.map(stableStringify).join(",")+"]";
    return"{"+Object.keys(value).sort().map(function(key){
      return JSON.stringify(key)+":"+stableStringify(value[key]);
    }).join(",")+"}";
  }

  function formatBR(value,places){
    if(value===null||value===undefined||!Number.isFinite(Number(value)))return"-";
    return Number(value).toLocaleString("pt-BR",{
      minimumFractionDigits:places,
      maximumFractionDigits:places
    });
  }

  return{
    parseNum:parseNum,
    calculateTreatment:calculateTreatment,
    calculateCalibration:calculateCalibration,
    stableStringify:stableStringify,
    formatBR:formatBR
  };
});
