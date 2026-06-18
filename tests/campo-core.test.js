const test=require("node:test");
const assert=require("node:assert/strict");
const core=require("../campo-core.js");

test("calcula tratamento líquido por parcela e garrafa",()=>{
  const result=core.calculateTreatment({
    doseHa:"1",doseUnit:"L/ha",sprayVolume:"150",
    plotLength:"5",plotWidth:"3",numPlots:"4",numBottles:"4",
    deadVolumeMl:"300",bottleCapacity:"1,9"
  });
  assert.equal(result.plotAreaM2,15);
  assert.equal(result.sprayPerPlotMl,225);
  assert.equal(result.productPerPlot,1.5);
  assert.equal(result.sprayTotalMl,1200);
  assert.equal(result.productTotal,8);
  assert.equal(result.productPerBottle,2);
  assert.equal(result.waterPerBottleMl,298);
  assert.equal(result.minBottles,1);
});

test("calcula produto sólido sem subtrair massa do volume de água",()=>{
  const result=core.calculateTreatment({
    doseHa:"500",doseUnit:"g/ha",sprayVolume:"100",
    plotLength:"10",plotWidth:"2",numPlots:"2",numBottles:"2",
    deadVolumeMl:"0",bottleCapacity:"1"
  });
  assert.equal(result.productTotal,2);
  assert.equal(result.sprayPerBottleMl,200);
  assert.equal(result.waterPerBottleMl,200);
  assert.equal(result.productUnit,"g");
});

test("aceita vírgula decimal",()=>{
  assert.equal(core.parseNum("1,9"),1.9);
  assert.equal(core.parseNum(" 0,50 "),0.5);
});

test("calcula vazão, CV, velocidade e tempo de passada",()=>{
  const result=core.calculateCalibration({
    measuredNozzles:4,totalNozzles:4,nozzleSpacing:"0,5",
    sprayVolume:150,plotLength:5,
    readings:[[250,250,250],[250,250,250],[250,250,250],[250,250,250]]
  });
  assert.equal(result.generalAverageMl30s,250);
  assert.equal(result.generalAverageLmin,0.5);
  assert.equal(result.coefficientVariationPct,0);
  assert.equal(result.estimatedTotalFlowLmin,2);
  assert.equal(result.boomWidthM,2);
  assert.equal(result.speedKmh,4);
  assert.equal(result.passTimeSeconds,4.5);
});

test("CV permanece indisponível com menos de dois bicos válidos",()=>{
  const result=core.calculateCalibration({
    measuredNozzles:2,totalNozzles:2,nozzleSpacing:0.5,
    sprayVolume:150,plotLength:5,readings:[[200,200,200],["","",""]]
  });
  assert.equal(result.validNozzles,1);
  assert.equal(result.coefficientVariationPct,null);
});

test("rejeita parâmetros operacionais inválidos",()=>{
  assert.throws(()=>core.calculateTreatment({
    doseHa:0,doseUnit:"L/ha",sprayVolume:150,plotLength:5,plotWidth:3
  }),/dose/i);
});

test("serialização estável independe da ordem das chaves",()=>{
  assert.equal(
    core.stableStringify({b:2,a:{d:4,c:3}}),
    core.stableStringify({a:{c:3,d:4},b:2})
  );
});
